function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const propToken = props.getProperty('TOKEN');
  const propId = props.getProperty('SPREADSHEET_ID');

  // TODO: hmac による検証のほうが推奨らしいのでいつか書き換える
  const verificationToken = e.parameter.token
  if (verificationToken !== propToken) {
    throw new Error('Invalid token error');
  }

  const help = `
/kzlt entry 'LTタイトル' -- 自分のLTを登録する
/kzlt my -- 自分のエントリしたLTを自分にだけ表示する
/kzlt list  -- エントリー済みのLTをchannelに出力する(順番を決めたものを除く)
/kzlt all -- エントリー済みのLTを出力する(順番決めた/決めてない関係なく)
/kzlt shuffle -- 順番を決め、channelに出力する (次のshuffleに出てこない)
/kzlt reset -- 順番決めたものすべてを順番決めていないことにする
/kzlt remove 'エントリ番号' -- エントリ時に返ってきた番号を指定してエントリを削除する
/kzlt delimit -- 一旦区切ってすでに順番を決めたエントリをshuffle対象外とする
※ delimit 後に shuffle することで、前回 shuffle 後にエントリしたものだけで shuffle できます
`;

  const argText = e.parameter.text;
  if (!argText) {
    return ContentService.createTextOutput(help);
  }

  const spreadsheet = SpreadsheetApp.openById(propId);
  if (!spreadsheet) {
    throw new Error('Spreadsheet: kzrb-LT-entries is not found');
  }

  const idx = argText.search(/\s+/);
  const cmd = argText.slice(0, idx == -1 ? argText.length : idx);
  const sheetName = e.parameter.channel_name;
  const startRowNum = 2;
  const startColNum = 2;
  const maxRowSize = 100; // TODO: さぽって 100 行に限定してる
  const status = { ORDERED: 'ordered', UNORDERED: 'unordered', REMOVED: 'removed', DELIMITED: 'delimited' };
  const index = { DATE: 0, NAME: 1, TITLE: 2, STATUS: 3 };
  const messages = {
    no_entry: "エントリーはありません",
    reset_order: "すべてのエントリーを順番を決めてない状態に戻しました",
    full_entry: "満席です",
    delimit_time: "ここまで順番を決めたエントリは発表済みとみなします"
  }

  // なければ sheet を作る
  const sheet = function(name) {
    const targetSheet = spreadsheet.getSheetByName(name);
    return targetSheet ? targetSheet : spreadsheet.insertSheet(name);
  }(sheetName);

  console.log({ cmd: cmd, user_name: e.parameter.user_name });

  switch (cmd) {
    case 'entry': { // エントリする
      const current = new Date().toLocaleString();
      const userName = e.parameter.user_name;
      const title = argText.slice(idx + 1, argText.length).trim();
      const entryLine = [current, userName, title, status.UNORDERED];

      const entryValues = sheet.getRange(
        startRowNum,
        startColNum,
        maxRowSize,
        entryLine.length,
      ).getValues();

      for (let row = 0; row < maxRowSize; row++) {
        if (!entryValues[row][index.DATE]) {
          sheet.getRange(
            startRowNum + row,
            startColNum,
            1,
            entryLine.length,
          ).setValues([entryLine]);
          SpreadsheetApp.flush()

          console.log({ cmd: cmd, user_name: e.parameter.user_name, title: title, argText: argText });

          const payload = createMessagePayload(
            `${userName} さんから LT: 「${title}」のエントリがありました。entryId: ${startRowNum + row}`
          );
          return createPublicTextOutput(payload);
        }
      }

      return ContentService.createTextOutput(messages.full_entry);
    }
    case 'remove': { // 番号指定でエントリを削除扱いにする
      const entryId = argText.slice(idx + 1, argText.length).trim();
      if (Number(entryId) === 0 || Number.isNaN === Number(entryId) || typeof (Number(entryId)) !== 'number') {
        return ContentService.createTextOutput('entry 時に返ってきた entryId を指定してください /kzlt remove 1');
      }

      const targetRowNum = Number(entryId);
      const entry = sheet.getRange(targetRowNum, startColNum, 1, 4).getValues()[0];
      if (entry[index.NAME] !== e.parameter.user_name) {
        return ContentService.createTextOutput(`entry が自身のものではありません。 ${entry[index.NAME]}`);
      }

      sheet.getRange(targetRowNum, startColNum + index.STATUS).setValue(status.REMOVED);

      console.log({ cmd: cmd, user_name: e.parameter.user_name, entryId: entryId });

      const payload = createMessagePayload(
        `LT title: ${entry[index.TITLE]} のエントリが取り消されました。`
      );
      return createPublicTextOutput(payload);
    }
    case 'my': { // 自分がエントリしたものを出力する
      const entries = sheet.getRange(
        startRowNum,
        startColNum,
        maxRowSize,
        4,
      ).getValues();

      const userName = e.parameter.user_name;
      let text = `${userName}のエントリー\n`;
      let entryCount = 0;
      for (let i = 0; i < maxRowSize; i++) {
        if (!entries[i][index.DATE]) break;

        if (entries[i][index.NAME] !== userName) continue;
        if (entries[i][index.STATUS] === status.REMOVED) continue;

        const title = entries[i][index.TITLE];
        text += `- ${title}, entryId: ${startRowNum + i}\n`;
        entryCount++;
      }

      if (entryCount === 0) text = messages.no_entry;

      console.log({ cmd: cmd, user_name: e.parameter.user_name, text: text });

      return ContentService.createTextOutput(text);
    }

    case 'list': { // shuffle されていないエントリを出力する
      const entries = sheet.getRange(
        startRowNum,
        startColNum,
        maxRowSize,
        4,
      ).getValues();

      let text = "現在までのエントリー\n";
      let entryCount = 0;
      for (let i = 0; i < maxRowSize; i++) {
        if (!entries[i][index.DATE]) break;
        if (entries[i][index.STATUS] !== status.UNORDERED) continue;

        const name = entries[i][index.NAME];
        const title = entries[i][index.TITLE];
        text += `- ${title} by ${name}, entryId: ${startRowNum + i}\n`;
        entryCount++;
      }

      console.log({ cmd: cmd, user_name: e.parameter.user_name });

      if (entryCount === 0) {
        return ContentService.createTextOutput(messages.no_entry);
      } else {
        const payload = createMessagePayload(text);

        return createPublicTextOutput(payload);
      }
    }
    case 'all': { // 削除扱いのエントリ以外すべてを出力する
      const entries = sheet.getRange(
        startRowNum,
        startColNum,
        maxRowSize,
        4,
      ).getValues();

      let allText = "";
      for (let i = 0; i < maxRowSize; i++) {
        if (!entries[i][index.DATE]) break;
        if (entries[i][index.STATUS] === status.REMOVED) continue

        const entry = entries[i];
        const badge = (entry[index.STATUS] === status.ORDERED || entry[index.STATUS] === status.DELIMITED) ? '[done]' : '';
        allText += `- ${badge} ${entry[index.TITLE]} by ${entry[index.NAME]}, entryId: ${startRowNum + i}\n`;
      }

      if (!allText) allText = messages.no_entry;

      console.log({ cmd: cmd, user_name: e.parameter.user_name, text: allText });

      return ContentService.createTextOutput(allText);
    }
    case 'shuffle': { // shuffle されていないエントリをシャッフルする
      const entries = sheet.getRange(
        startRowNum,
        startColNum,
        maxRowSize,
        4,
      ).getValues();

      const container = [];
      for (let i = 0; i < maxRowSize; i++) {
        if (!entries[i][index.DATE]) break;

        const entry = entries[i];
        container.push(entry);
      }

      if (container.length === 0) {
        return createPublicTextOutput(createMessagePayload(messages.no_entry));
      }

      // 並び替え対象としたものに印をつける
      const statuses = container.map((v) => {
        switch (v[index.STATUS]) {
          case status.REMOVED: {
            return [status.REMOVED];
          }
          case status.DELIMITED: {
            return [status.DELIMITED];
          }
          default: {
            return [status.ORDERED];
          }
        }
      });
      sheet.getRange(
        startRowNum,
        5,
        container.length,
        1,
      ).setValues([...statuses]);
      SpreadsheetApp.flush()

      // シャッフルした番号の配列をつくる
      const orderNumbers = indexesNumbers(container.length);
      // markdown を作り、レスポンスを返す
      const mdText = makeMarkdown(orderNumbers, container, status, index);

      console.log({ cmd: cmd, user_name: e.parameter.user_name, text: mdText });

      const payload = createMessagePayload(mdText);
      return createPublicTextOutput(payload);
    }
    case 'reset': { // すでにシャッフルされたエントリの状態をシャッフルされていない状態に戻す
      const entries = sheet.getRange(
        startRowNum,
        startColNum,
        startRowNum + maxRowSize,
        4,
      ).getValues();

      const container = [];
      for (let i = 0; i < maxRowSize; i++) {
        if (!entries[i][index.DATE]) break;

        container.push(entries[i]);
      }
      const values = container.map((v) => {
        switch (v[index.STATUS]) {
          case status.REMOVED: {
            return [status.REMOVED];
          }
          case status.DELIMITED: {
            return [status.DELIMITED];
          }
          default: {
            return [status.UNORDERED];
          }
        }
      });
      sheet.getRange(
        startRowNum,
        5,
        container.length,
        1,
      ).setValues([...values]);
      SpreadsheetApp.flush()

      console.log({ cmd: cmd, user_name: e.parameter.user_name, text: message.reset_order });

      return ContentService.createTextOutput(messages.reset_order);
    }
    case 'delimit': {
      const entries = sheet.getRange(
        startRowNum,
        5,
        maxRowSize,
        1,
      ).getValues();

      for (let i = 0; i < maxRowSize; i++) {
        if (!entries[i][0]) break;
        if (entries[i][0] !== status.ORDERED) continue;

        sheet.getRange(
          startRowNum + i,
          5,
          1,
        ).setValue(status.DELIMITED)
      }
      SpreadsheetApp.flush()

      console.log({ cmd: cmd, user_name: e.parameter.user_name, text: messages.delimit_time });

      const payload = createMessagePayload(messages.delimit_time);
      return createPublicTextOutput(payload);
    }
    default:
      console.log({ cmd: cmd, user_name: e.parameter.user_name });

      return ContentService.createTextOutput(cmd + "\n" + help);
  }
}

function shuffle([...ary]) {
  for (let i = ary.length - 1; i >= 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ary[i], ary[j]] = [ary[j], ary[i]];
  }
  return ary;
}

function indexesNumbers(num = 10) {
  const nums = [...Array(num).keys()];
  return shuffle(nums);
}

function makeMarkdown(orderNumbers, container, status, index) {
  let count = 0;
  let mdTable = "```\n"; // | タイトル | 時刻	 | 時間	 | 担当 |
  let mdList = "";
  for (const num of orderNumbers) {
    const ary = container[num];

    if (ary[index.STATUS] === status.REMOVED) continue;
    if (ary[index.STATUS] === status.DELIMITED) continue;
    count++;

    mdTable += `| ${ary[index.TITLE]} | | | ${ary[index.NAME]} |\n`;
    mdList += `- ${ary[index.TITLE]} by ${ary[index.NAME]}\n`;
    if (count % 4 === 0) {
      mdTable += `| 休憩 | | | |\n`;
      mdList += `- 【休憩】`;
    }
  };
  mdTable += "```";

  return mdList + "\n" + mdTable;
}

function createPublicTextOutput(payload) {
  const response = ContentService.createTextOutput();
  response.setMimeType(ContentService.MimeType.JSON);
  response.setContent(JSON.stringify(payload));

  return response;
}

function createMessagePayload(text) {
  return {
    response_type: "in_channel",
    text: text,
    username: "kzrb",
    icon_url: "https://meetup.kzrb.org/images/logo_kzrb.png"
  }
}
