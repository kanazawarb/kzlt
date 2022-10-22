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
/kzlt create -- 今回のLT大会用の枠を作成する
/kzlt entry 'LTタイトル' -- 自分のLTを登録する
/kzlt list  -- エントリー済みのLTを出力する(順番を決めたものを除く)
/kzlt all -- エントリー済みのLTを出力する(順番決めた/決めてない関係なく)
/kzlt shuffle -- 順番を決める (次のshuffleに出てこない)
/kzlt reset -- 順番決めたものすべてを順番決めていないことにする
/kzlt remove 'エントリ番号' -- エントリ時に返ってきた番号を指定してエントリを削除する
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
  const status = { ORDERED: 'ordered', UNORDERED: 'unordered', REMOVED: 'removed' };
  const index = { DATE: 0, NAME: 1, TITLE: 2, STATUS: 3 };

  switch(cmd) {
    case 'create': {
      if (spreadsheet.getSheetByName(sheetName)) {
        return ContentService.createTextOutput('既にシートが存在します');
      } else {
        spreadsheet.insertSheet(sheetName);
      }

      return ContentService.createTextOutput(`シート: ${sheetName} が作成されました`);
    }
    case 'entry': {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        return ContentService.createTextOutput('/kzlt create でシートを作成してください');
      }

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

          return ContentService.createTextOutput(`title: ${title} を受け付けました。entryId: ${startRowNum + row}`);
        }
      }

      return ContentService.createTextOutput("満席です。");
    }
    case 'remove': {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        return ContentService.createTextOutput('/kzlt create でシートを作成してください');
      }

      const value = argText.slice(idx + 1, argText.length).trim();
      if (Number(value) === 0 || Number.isNaN === Number(value) || typeof(Number(value)) !== 'number') {
        return ContentService.createTextOutput('entry 時に返ってきた entryId を指定してください /kzlt remove 1');
      }

      const targetRowNum = Number(value);
      const entry = sheet.getRange(targetRowNum, startColNum, 1, 4).getValues()[0];
      if (entry[index.NAME] !== e.parameter.user_name) {
        return ContentService.createTextOutput(`entry が自身のものではありません。 ${entry[index.NAME]}`);
      }

      sheet.getRange(targetRowNum, startColNum + 3).setValue(status.REMOVED);
      return ContentService.createTextOutput(`entryId: ${value}, title: ${entry[index.TITLE]} を削除しました`);
    }
    case 'list': {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        return ContentService.createTextOutput('/kzlt create でシートを作成してください');
      }

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

      if (entryCount === 0) {
        return ContentService.createTextOutput('エントリーはありません');
      } else {
        const payload = {
          response_type: "in_channel",
          text: text,
        };
        const response = ContentService.createTextOutput();
        response.setMimeType(ContentService.MimeType.JSON);
        response.setContent(JSON.stringify(payload));

        return response;
      }
    }
    case 'all': {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        return ContentService.createTextOutput('/kzlt create でシートを作成してください');
      }

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
        const badge = entry[index.STATUS] === status.ORDERED ? '[done]' : '';
        allText += `- ${badge} ${entry[index.TITLE]} by ${entry[index.NAME]}, entryId: ${startRowNum + i}\n`;
      }

      return ContentService.createTextOutput(allText);
    }
    case 'shuffle': {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        return ContentService.createTextOutput('/kzlt create でシートを作成してください');
      }

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

      // 並び替え対象としたものに印をつける
      const values = container.map((v) => v[index.STATUS] === status.REMOVED ? [status.REMOVED] : [status.ORDERED]);
      sheet.getRange(
        startRowNum,
        5,
        container.length,
        1,
      ).setValues([...values]);

      // markdown を作り、レスポンスを返す
      const mdText = makeMarkdown(container, status, index);
      const payload = {
        response_type: "in_channel",
        text: mdText,
      };
      const response = ContentService.createTextOutput();
      response.setMimeType(ContentService.MimeType.JSON);
      response.setContent(JSON.stringify(payload));

      return response;
    }
    case 'reset': {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        return ContentService.createTextOutput('/kzlt create でシートを作成してください');
      }

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
      const values = container.map((v) => v[index.STATUS] === status.REMOVED ? [status.REMOVED] : [status.UNORDERED]);
      sheet.getRange(
        startRowNum,
        5,
        container.length,
        1,
      ).setValues([...values]);

      return ContentService.createTextOutput("すべてのエントリーを順番決めてない扱いにしました");
    }
    default:
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

function makeMarkdown(container, status, index) {
  const orderNumbers= indexesNumbers(container.length);

  let mdTable = "```\n"; // | タイトル | 時刻	 | 時間	 | 担当 |
  let mdList = "";
  for (const num of orderNumbers) {
    const ary = container[num];

    if (ary[index.STATUS] === status.REMOVED) continue;

    mdTable += `| ${ary[index.TITLE]} | | | ${ary[index.NAME]} |\n`;
    mdList += `- ${ary[index.TITLE]} by ${ary[index.NAME]}\n`;
  };
  mdTable += "```";

  return mdList + "\n" + mdTable;
}
