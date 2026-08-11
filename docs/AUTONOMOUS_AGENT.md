# 守マップ自律改善エージェント

Observer → Analyst → Builder → Release Gate の4層で、既存Workerとは分離して改善候補を扱う。

## 安全境界

- 本番Worker、D1、Queue、Cron、migration、認証情報にはエージェントからアクセスしない。
- Previewは専用Worker名・専用設定で動かし、本番secretを渡さない。
- Builderは低リスクのUI改善だけを対象にし、1 issue = 1 branch = 1 changeとする。
- 本番反映はGitHub Environment `production` の人手承認が必須。初期値は `MAMORU_AGENT_RELEASE_ENABLED=false`。
- 同一fingerprintの反復、health/5xx、認証異常は自動修正せず停止・エスカレーションする。

## 実行

`npm test` で基盤テストを実行する。PRでは `agent-preview.yml` がテスト、Wrangler dry-run、Preview smoke testを行う。production workflowはworkflow_dispatchかつEnvironment承認後のみ実行し、現状は無効化されている。
