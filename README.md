# まもるマップ

## Project PLATEAU Phase 1

`migration-010-plateau-datasets.sql` から `migration-013-plateau-sync-queue-batches.sql` をD1へ順に適用後、管理Bearerトークンで `POST /api/admin/plateau/sync` を実行するとCloudflare Queues経由でPLATEAU配信サービスのデータカタログを同期します。開始後は `GET /api/admin/plateau/sync/status` と `GET /api/admin/plateau/sync/runs?limit=20` で確認できます。参照APIは `GET /api/plateau/regions` と `GET /api/plateau/availability?municipality_code=13101` です。緯度経度による推定は未対応です。

災害時の公式発表・報道情報を、出典付きで地図に整理するMVPです。一般利用者からの自由投稿は受け付けず、登録済みソースの取得と管理者レビューを経た情報だけを公開します。

## 今回の実装範囲

Cloudflare Workers + D1で次のループを実装しています。

1. 情報源を登録
2. RSS/Atom・GeoJSON・JSON-LD・公開HTMLを取得
3. タイトル・要約・日時・URLを抽出
4. 許可された元URLから記事本文または公式XMLを段階取得
5. 全文を保存せず短い根拠要約を生成
6. ルールで種別・地域を仮分類
7. `review`（レビュー待ち）として保存
8. 人手レビューで `published` または `rejected`
9. 公開済みだけを `/api/reports` で返す
10. `/api/archive/reports` では公開履歴と、Solafuneで発見した報道メタデータを明確に分離して返す
11. 状態・情報区分・位置精度・最終確認・有効期限を表示する
12. 状態変更と訂正を`report_revisions`へ履歴保存する

公開画面はMapLibre GL JSと国土地理院タイルを使用し、地図・情報一覧・キーワード検索・市区町村／種別／緊急度フィルターを1画面にまとめています。日付スライダーと「発生当初」ボタンで履歴を遡れます。一般利用者からの投稿機能はありません。

通常表示では未レビューの報道情報を表示しません。「発生当初（参考含む）」を選んだ場合に限り、見出し・発表日時・位置・元URLだけを「報道・参考（未確認）」として表示し、記事本文や内部レビュー情報は公開しません。

トヨタ「通れた道マップ」は、同ページが使用する交通規制JSONから熊本地震周辺の規制種別・原因・座標だけを取得します。JARTIC／VICS由来の参考情報としてレビュー待ちに保存し、通常表示ではOFFです。独自WMS画像、航空写真、車両ID・ナンバー・連絡先を含み得る給電車両データは取得・再配布しません。

`GET /api/weather` はOpen-Meteoから熊本市中心部の現在気温・降水量・10m風速を取得し、数値検証後に最大10分キャッシュして返します。画面にはCC BY 4.0に基づくOpen-Meteoへの帰属リンクを常時表示します。これはモデル参考値であり、避難判断には使用しません。

## セットアップ

```powershell
npm install
npx wrangler d1 create mamoru-map
# 表示された database_id を wrangler.toml に設定
npx wrangler d1 execute mamoru-map --local --file=schema.sql
npx wrangler d1 execute mamoru-map --local --file=sources.seed.sql
npm run dev
```

既存のD1に座標列を追加する場合だけ、初回に以下を実行します。

```powershell
npx wrangler d1 execute mamoru-map --local --file=migration-001-coordinates.sql
npx wrangler d1 execute mamoru-map --local --file=migration-006-article-enrichment.sql
npx wrangler d1 execute mamoru-map --local --file=migration-007-trust-metadata.sql
npx wrangler d1 execute mamoru-map --local --file=migration-008-harden-existing-auto-publish.sql
```

PowerShellでローカルの管理APIを使う場合は、`.dev.vars.example`を`.dev.vars`にコピーし、`ADMIN_TOKEN`と`ALLOWED_SOURCE_HOSTS`を設定してください。管理APIは `Authorization: Bearer <ADMIN_TOKEN>` が必須です。

開発サーバー起動後：

- `admin.html`：管理コンソール（取得・レビュー・公開）
- `GET /api/health`
- `GET /api/sources`
- `POST /api/sources`
- `POST /api/sources/:id/ingest`
- `POST /api/automation/enrich-articles`
- `GET /api/review-queue`
- `POST /api/review/:id`
- `GET /api/reports`
- `GET /api/reports/:id/history`
- `GET /api/archive/reports`
- `GET /api/weather`
- `GET /api/reports.geojson`
- `GET /api/reports.csv`
- `GET /api/admin/reports`
- `GET /api/admin/reports/:id/history`
- `POST /api/admin/reports/:id/state`

保護されたAPI（情報源登録、取得、レビュー）は、認証済みリクエストを1クライアントあたり1分30回までに制限します。情報源の登録URLとフィードURLは、同一ホストかつ許可リスト内である必要があります。

## 情報源登録例

```powershell
Invoke-RestMethod http://localhost:8787/api/sources -Method Post -ContentType 'application/json' -Body (@{
  name = '公式情報の例'
  category = 'official'
  source_url = 'https://example.com'
  feed_url = 'https://example.com/feed.xml'
} | ConvertTo-Json)
```

## セキュリティ上の残作業

- 本番のCORS制限
- 運用者ごとのID・権限管理
- 定期的なD1の古いレート制限イベント削除

これらを追加するまで、公開環境での自動取得やレビューAPIの公開は行わないでください。
