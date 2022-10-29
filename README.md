# KZLT

Kanazawa.rb の LT 大会用エントリ & 順番決定 Slack slash command。

Slack の Slash command apps (muryoimpl の非公開もの) を frontend に、
backend に Google Spreadsheet (muryoimplの非公開もの) を使っている。


## 運用

main に JavaScript もしくは JSON が push されると GitHub Actions で Apps script 側に反映、デプロイされるようになっている。

変更が Apps script に反映される際に公開 URL が変更されないようになっているため、slash command に即反映される。
