const inquirer = require("inquirer");
const puppeteer = require("puppeteer");

const isEmail = require("./utilities/isEmail");
const isInputs = require("./utilities/isInputs");
const isStringOfNotEmpty = require("./utilities/isStringOfNotEmpty");

const askInputs = require("./modules/askInputs");
const getEmojiAdminList = require("./modules/getEmojiAdminList");
const getTargetDecomojiList = require("./modules/getTargetDecomojiList");
const importer = require("./modules/importer");

// オプションをパースする
const options = {};
((argv) => {
  argv.forEach((v, i) => {
    const opt = v.split("=");
    const key = opt[0].replace("--", "");
    options[key] = opt.length > 1 ? opt[1] : true;
  });
})(process.argv);

// 自動処理を実行する
const main = async (inputs) => {
  // puppeteer でブラウザを起動する
  const browser = await puppeteer.launch({ devtools: options.debug });
  // ページを追加する
  const page = await browser.newPage();

  console.log(
    `\nworkspace: https://${inputs.team_name}.slack.com/\n    email: ${inputs.email}\n password: **********\n\nConnecting...\n`
  );

  // ログイン画面に遷移する（チームのカスタム絵文字管理画面へのリダイレクトパラメータ付き）
  await page.goto(
    `https://${inputs.team_name}.slack.com/?redir=%2Fcustomize%2Femoji#/`,
    {
      waitUntil: "domcontentloaded",
    }
  );
  // ログイン画面に遷移できたかをチェックする
  if (await page.$("#signin_form").then((res) => !res)) {
    // おそらくチームが存在しない場合なので inquirer を起動して team_name を再入力させる
    const _retry = async (tried_team_name) => {
      try {
        const retry = await inquirer.prompt({
          type: "input",
          name: "team_name",
          message: `${tried_team_name} is not found. Please try again.`,
          validate: isInputs,
        });
        // ログイン画面に再び遷移する
        await page.goto(
          `https://${retry.team_name}.slack.com/?redir=%2Fcustomize%2Femoji#/`,
          {
            waitUntil: "domcontentloaded",
          }
        );
        // ログイン画面に遷移できたかを再びチェックし、できていたら再帰処理を抜ける
        if (await page.$("#signin_form").then((res) => !!res)) {
          // チーム名を保存し直す
          inputs.team_name = retry.team_name;
          return;
        }
        // ログインページに到達できるまで何度でもトライ！
        await _retry(retry.team_name);
      } catch (e) {
        return e;
      }
    };
    // 再帰処理をスタートする
    await _retry(inputs.team_name);
  }
  // ログイン email を入力する
  await page.type("#email", inputs.email);
  // パスワードを入力する
  await page.type("#password", inputs.password);
  // 「サインイン」する
  await Promise.all([
    page.click("#signin_btn"),
    page.waitForNavigation({ waitUntil: "networkidle0" }),
  ]);
  // ログインエラーになっているかをチェックする
  if (await page.$(".alert_error").then((res) => !!res)) {
    // ログインエラーなら inquirer を起動して email と password を再入力させる
    const _retry = async (tried) => {
      // 前の入力を空にしておく
      await page.evaluate(() => (document.querySelector("#email").value = ""));
      await page.evaluate(
        () => (document.querySelector("#password").value = "")
      );
      try {
        const retry = await inquirer.prompt([
          {
            type: "input",
            name: "email",
            message: `Enter login email again.`,
            validate: isEmail,
            default: tried.email,
          },
          {
            type: "password",
            name: "password",
            mask: "*",
            message: `Enter a password again.`,
            validate: isInputs,
          },
        ]);
        // Recaptcha があるかをチェックする
        if (await page.$("#slack_captcha").then((res) => !!res)) {
          // Recaptcha があったら無理なので諦める
          console.log(
            "\n\nOops, you might judged a Bot. Please wait and try again.\n\n"
          );
          await browser.close();
        }
        // フォームに再入力して submit する
        await page.type("#email", retry.email);
        await page.type("#password", retry.password);
        await Promise.all([
          page.click("#signin_btn"),
          page.waitForNavigation({ waitUntil: "networkidle0" }),
        ]);
        // #signin_form がなかったらログインできたと見なして再帰処理を抜ける
        if (await page.$("#signin_form").then((res) => !res)) {
          return;
        }
        // ログインできるまで何度でもトライ！
        await _retry(retry);
      } catch (e) {
        return e;
      }
    };
    // 再帰処理をスタートする
    await _retry(inputs);
  }
  // 2FA入力欄があるかをチェックする
  if (await page.$('[name="2fa_code"]').then((res) => !!res)) {
    // 2FA入力欄があれば inquirer を起動して入力させる
    const _auth = async () => {
      // 前の入力を空にしておく
      await page.evaluate(
        () => (document.querySelector('[name="2fa_code"]').value = "")
      );
      try {
        const answer = await inquirer.prompt({
          type: "password",
          name: "2fa",
          mask: "*",
          message: "Enter a 2FA code.",
          validate: isInputs,
        });
        // フォームに入力して submit する
        await page.type('[name="2fa_code"]', answer["2fa"]);
        await Promise.all([
          page.click("#signin_btn"),
          page.waitForNavigation({ waitUntil: "networkidle0" }),
        ]);
        // 2FA入力欄がなかったら2FA認証できたと見なして再帰処理を抜ける
        if (await page.$('[name="2fa_code"]').then((res) => !res)) {
          options.debug && console.log("OK");
          return;
        }
        // 2FA認証できるまで何度でもトライ！
        await _auth();
      } catch (e) {
        return e;
      }
    };
    // 再帰処理をスタートする
    await _auth();
  }

  // グローバル変数boot_dataと、カスタム絵文字セクションが見つかるまで待つ
  await Promise.all([
    page.waitForXPath("//script[contains(text(), 'boot_data')]"),
    page.waitForSelector("#list_emoji_section")
  ]);

  // 登録済みのカスタム絵文字リストを取得する
  const emojiAdminList = await page.evaluate(
    getEmojiAdminList,
    inputs.team_name
  );
  options.debug &&
    console.log("emojiAdminList:", emojiAdminList.length, emojiAdminList);

  // 追加する対象デコモジリストを取得する
  const targetDecomojiList = await getTargetDecomojiList(inputs.categories);
  options.debug &&
    console.log(
      "targetDecomojiList:",
      targetDecomojiList.length,
      targetDecomojiList
    );

  // emojiAdminList からファイル名だけの配列を作っておく
  const emojiAdminNameList = new Set(emojiAdminList.map((v) => v.name));
  options.debug && console.log("emojiAdminNameList:", emojiAdminNameList);

  // ファイルをアップロードする
  await importer(page, inputs, targetDecomojiList, emojiAdminNameList);

  // 処理が終わったらブラウザを閉じる
  if (!options.debug) {
    await browser.close();
  }
};

if (options.inputs) {
  // --inputs=./something.json などと値が指定されていたらそれを require し
  // --inputs キーのみの場合はデフォルトで `./inputs.json` を require する
  main(
    require(isStringOfNotEmpty(options.inputs)
      ? options.inputs
      : "./inputs.json")
  );
} else {
  // inputs がない場合は inquirer を起動して対話的にオプションを作る
  askInputs((inputs) => main(inputs));
}