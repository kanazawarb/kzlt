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
  const ORDERED = 'ordered';
  const UNORDERED = 'unordered';

  switch(cmd) {
    case 'create':
      if (spreadsheet.getSheetByName(sheetName)) {
        return ContentService.createTextOutput('既にシートが存在します');
      } else {
        spreadsheet.insertSheet(sheetName);
      }

      return ContentService.createTextOutput(`シート: ${sheetName} が作成されました`);
    case 'entry':
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        return ContentService.createTextOutput('/kzlt create でシートを作成してください');
      }

      const current = new Date().toLocaleString();
      const userName = e.parameter.user_name;
      const title = argText.slice(idx + 1, argText.length).trim();
      const entryLine = [current, userName, title, UNORDERED];

      const entryValues = sheet.getRange(
        startRowNum,
        startColNum,
        startRowNum + maxRowSize,
        entryLine.length,
        ).getValues();

      for (let row = 0; row < maxRowSize; row++) {
        if (!entryValues[row][0]) {
          sheet.getRange(
            startRowNum + row,
            startColNum,
            1,
            entryLine.length,
            ).setValues([entryLine]);

          return ContentService.createTextOutput(`title: ${title} を受け付けました`);
        }
      }

      return ContentService.createTextOutput("entry がいっぱい！！！！");
    case 'list':
      const entrysheet = spreadsheet.getSheetByName(sheetName);
      const entries = entrysheet.getRange(
        startRowNum,
        startColNum,
        startRowNum + maxRowSize,
        4,
        ).getValues();

      let text = "現在までのエントリー\n";
      let entryCount = 0;
      for (let i = 0; i < maxRowSize; i++) {
        if (!entries[i][0]) break;
        if (entries[i][3] === ORDERED) continue;

        const name = entries[i][1];
        const title = entries[i][2];
        text += `- ${title} by ${name}\n`;
        entryCount++;
      }

      const msg = entryCount === 0 ? 'エントリーはありません' : text;
      return ContentService.createTextOutput(msg);
    case 'all':
      const asheet = spreadsheet.getSheetByName(sheetName);
      const aentries = asheet.getRange(
        startRowNum,
        startColNum,
        startRowNum + maxRowSize,
        4,
        ).getValues();

      let allText = "";
      for (let i = 0; i < maxRowSize; i++) {
        if (!aentries[i][0]) break;

        const entry = aentries[i];
        allText += `- ${entry[3] === ORDERED ? '[done]' : ''} ${entry[2]} by ${entry[1]}\n`;
      }

      return ContentService.createTextOutput(allText);
    case 'shuffle':
      const ssheet = spreadsheet.getSheetByName(sheetName);
      const eentries = ssheet.getRange(
        startRowNum,
        startColNum,
        startRowNum + maxRowSize,
        4,
        ).getValues();

      const container = [];
      for (let i = 0; i < maxRowSize; i++) {
        if (!eentries[i][0]) break;
        if (eentries[i][3] === ORDERED) continue;

        const entryAry = eentries[i];
        container.push(entryAry);
      }

      // 並び替え対象としたものに印をつける
      const vals = [...Array(container.length)].map((_) => [ORDERED]);
      ssheet.getRange(
        startRowNum,
        5,
        container.length,
        1,
      ).setValues([...vals]);

      // markdown を作り、レスポンスを返す
      const indexes = shuffle(indexesNumbers(container.length));
      const mdText = makeMarkdown(container, indexes);
      const payload = {
        response_type: "in_channel",
        text: mdText,
      };
      const resp = ContentService.createTextOutput();
      resp.setMimeType(ContentService.MimeType.JSON);
      resp.setContent(JSON.stringify(payload));

      return resp;
    case 'reset':
      const rsheet = spreadsheet.getSheetByName(sheetName);
      const rentries = rsheet.getRange(
        startRowNum,
        startColNum,
        startRowNum + maxRowSize,
        4,
        ).getValues();

      let counter = [];
      for (let i = 0; i < maxRowSize; i++) {
        if (!rentries[i][0]) break;
        counter++;
      }
      const values = [...Array(counter)].map((_) => [UNORDERED]);
      rsheet.getRange(
        startRowNum,
        5,
        counter,
        1,
      ).setValues([...values]);

      return ContentService.createTextOutput("すべてのエントリーを順番決めてない扱いにしました");
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

function makeMarkdown(container, indexes) {
  let mdTable = "```\n"; // | タイトル | 時刻	 | 時間	 | 担当 |
  let mdList = "";
  indexes.forEach((num) => {
    const ary = container[num];
    mdTable += `| ${ary[2]} | | | ${ary[1]} |\n`;
    mdList += `- ${ary[2]} by ${ary[1]}\n`;
  });
  mdTable += "```";

  return mdList + "\n" + mdTable;
}