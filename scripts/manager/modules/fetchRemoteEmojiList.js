/**
  emoji.adminList が返す配列のアイテムの型定義
  @typedef {{
    name: string;
    is_alias: number;
    alias_for: string;
    url: string;
    created: number;
    team_id: string;
    user_id: string;
    user_display_name: string;
    avatar_hash: string;
    can_delete: boolean;
    is_bad: boolean;
    synonyms: string[];
  }} EmojiItem;

  emoji.adminList が返すレスポンスの型定義
  @typedef {EmojiItem[]} EmojiAdminList;
*/

const fetchRemoteEmojiList = async (page, inputs) => {
  inputs.debug && console.time("[fetch time]");

  inputs.debug &&
    inputs.fatlog &&
    console.log("\nStart to fetch remote emoji list...");

  const remoteEmojiList = await page.evaluate(async (inputs) => {
    const { workspace, mode } = inputs;

    /** @type {EmojiAdminList} */
    let emojiAdminList = [];
    const fetchEmojiAdminList = async (nextPage) => {
      const formData = new FormData();
      formData.append("page", nextPage || 1);
      formData.append("count", 100);
      formData.append("token", window.boot_data.api_token);
      if (mode === "Remove") {
        formData.append("user_ids", JSON.stringify([window.boot_data.user_id]));
      }
      try {
        const response = await fetch(
          `https://${workspace}.slack.com/api/emoji.adminList`,
          {
            method: "POST",
            headers: { Accept: "application/json" },
            body: formData,
          }
        );
        const data = await response.json();
        emojiAdminList.push(...data.emoji);
        // 絵文字が一つもないか、最終ページまで fetch したら resolve する
        if (data.paging.pages === 0 || data.paging.page === data.paging.pages) {
          return;
        }
        // 次のページを fetch
        await fetchEmojiAdminList(data.paging.page + 1);
      } catch (e) {
        return e;
      }
    };

    // 絵文字を全件取得する
    await fetchEmojiAdminList();
    return emojiAdminList;
  }, inputs);

  inputs.debug &&
    inputs.fatlog &&
    console.log("\nComplete to fetch remote emoji list!");

  inputs.debug && console.timeEnd("[fetch time]");
  return remoteEmojiList;
};

module.exports = fetchRemoteEmojiList;
