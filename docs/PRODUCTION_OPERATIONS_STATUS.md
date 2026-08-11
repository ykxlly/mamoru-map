# 本番運用状態

確認日時: 2026-08-11 (JST)

## 自動改善・接続監視

| 項目 | 状態 |
| --- | --- |
| Stage 1 Observer | 有効 (`MAMORU_AGENT_ENABLED=true`) |
| 30分schedule | 有効 (`*/30 * * * *`) |
| Stage 2 Builder | 有効 (`MAMORU_AGENT_BUILDER_ENABLED=true`) |
| Preview | 利用可能 |
| Stage 3 Release | `production` Environmentの人間承認が必須 |
| 低リスクAUTO_RELEASE | 無効 (`MAMORU_AGENT_AUTO_RELEASE_ENABLED=false`) |
| 最新Observer run | `31470623620` (成功、13/13、問題0件) |
| 最新Preview run | `31473954057` (成功) |
| 最新本番Deployment | `f5d149bd-4c18-4f34-84b3-7936c24704f2` |
| 本番Worker Version | `5198b7c8-12af-4069-b442-9a69b13e2bae` (100%) |

接続監視はdefault branchで稼働しており、接続監視だけを理由にWorkerを再デプロイしない。Observerは応答本文、Cookie、Authorization、個人情報、位置情報をArtifactへ保存しない。PWAアセットとPLATEAUローダーの存在・Content-Type、およびリポジトリ内のPWA/高度補正不変条件も定期検証する。

## 状態表示の定義

- 監視中: Observerが有効で、直近の観測に未解決問題がない
- 問題検出: Observerが安全なerrorCodeを記録し、Issue候補を生成した
- 改善案作成中: Builderが1 Issue・1 fingerprint・1 branchで変更を作成中
- Preview検証中: production Secretを使わないPreviewで検証中
- 承認待ち: 高リスク変更がproduction EnvironmentのRequired reviewerを待機中
- 本番反映済み: 本番smoke testと監視が成功し、Deployment IDを記録済み
- ロールバック済み: 記録済みDeploymentへ復旧し、原因を再審査中
- 自動Release無効: `MAMORU_AGENT_AUTO_RELEASE_ENABLED=false`。低リスクでも無人本番反映しない

この文書のrun ID、問題件数、Deployment ID、Worker Versionは本番反映時に更新する。
