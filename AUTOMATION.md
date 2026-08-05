# 自動取得ループ

## 目的

公式ソースのRSS/Atomを定期取得し、新規項目をレビュー待ちとして保存する。自動処理は取得・重複排除・分類までを担当し、公開判断は必ず管理者が行う。

## 実行条件

- Cloudflare Cron: `*/15 * * * *`
- 対象: `sources.enabled = 1` の情報源
- 最大取得件数: 1ソースあたり50件
- 重複判定: `source_id` と `external_id` の組み合わせ
- 自動公開: しない
- 取得失敗: `last_failure_at` を更新し、他のソースの取得は継続

## 実行経路

```text
Cloudflare Cron
      │
      ▼
scheduled handler
      │
      ▼
enabled sources を順番に取得
      │
      ├─ raw_items に保存（重複は無視）
      ├─ extracted_items に保存（status=review）
      ├─ 許可ホストの記事本文を最大5件ずつ抽出
      └─ audit_events に記録
                    │
                    ▼
              Human Review
                    │
          publish または reject
```

## 手動実行

管理APIトークンを使って、定期実行と同じループを即時実行できる。

```powershell
$token = ((Get-Content .dev.vars | Where-Object { $_ -like 'ADMIN_TOKEN=*' }) -split '=', 2)[1]
Invoke-RestMethod http://localhost:8787/api/automation/run `
  -Method Post `
  -Headers @{ Authorization = "Bearer $token" }
```

レスポンスの `status` は `review_required` で、`created` は新規抽出件数、`auto_published` は条件付き自動公開件数を示す。`failed` が0でない場合は、管理画面の情報源ごとの最終取得時刻と失敗時刻を確認する。条件の詳細は `AUTO_PUBLISH_POLICY.md` を参照する。

## 記事本文の段階取得

Cronの各実行では、未処理の記事を最大5件だけ取得する。FNNなどのHTMLはNewsArticle構造化データ、description、記事領域の順で読み取り、気象庁XMLはHeadline・Text等を読み取る。全文は保存せず、最大1,000文字の抽出スナップショットと表示用の短い要約だけを保存する。

- 許可ホスト: `ARTICLE_SOURCE_HOSTS`
- 応答上限: 1MB
- タイムアウト: 8秒
- 再試行: 最大3回
- `Warmup Page`、未許可リダイレクト、非テキスト応答は除外
- ニュース由来は本文取得後も `review` のまま

手動バックフィルは `POST /api/automation/enrich-articles` に `{"limit":10}` を送る。特定情報源だけを処理する場合は `{"limit":10,"source_id":6}`、個別再検証は `{"raw_id":1207}` とする。1回の上限は10件で、監査ログには本文ではなく抽出方式と文字数だけを記録する。

## ローカル確認

`wrangler dev` を起動した状態で管理画面を開き、API URLと`.dev.vars`のトークンを入力する。管理画面の「自動取得を今すぐ実行」を押した後、レビュー待ち件数が増え、公開マップには自動反映されないことを確認する。

## 停止条件

- 取得元が許可ホスト外になった
- 原文URLが取得できない
- 同一情報の大量追加が発生した
- 取得元の内容形式が変わり、分類の信頼度が下がった
- D1またはAPIのエラー率が上がった

停止時も既存の公開済み情報は削除せず、原因と時刻を監査ログに残す。自動取得の再開前に、情報源の原文と抽出結果を人手で確認する。

## 本番URL

- 公開マップ: https://mamoru-map-api.krin6525.workers.dev/
- 運用コンソール: https://mamoru-map-api.krin6525.workers.dev/admin
- ヘルスチェック: https://mamoru-map-api.krin6525.workers.dev/api/health

本番の管理画面では、API URLに同じWorkers URLを入力する。管理トークンはブラウザに保存せず、Cloudflare Secretとローカルの`.dev.vars`で管理する。
