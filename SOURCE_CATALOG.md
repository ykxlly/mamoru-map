# 情報源カタログ v0.1

## 方針

まもるマップは、公式機関の発表を最優先し、ニュースは補助情報として扱う。すべての情報に出典URL、情報源名、公開日時、取得日時、情報カテゴリを付ける。取得できない原文や出典不明の情報は公開しない。

## 情報カテゴリ

| カテゴリ | 例 | 扱い | 公開条件 |
|---|---|---|---|
| 公式発表 | 自治体、消防、警察、気象庁、国土地理院、災害対策本部 | 最優先 | 自動抽出後、人手確認 |
| 公式地理情報 | 避難所、通行規制、ハザード、地形・道路情報 | 地図表示の基礎 | データ仕様と更新日を表示 |
| 報道情報 | NHK、新聞社、通信社など | 補助的に表示 | 記事URL・媒体名を表示し、人手確認 |
| 未確認 | 抽出済みだが判断できない情報 | 任意の参考レイヤー | 「参考・未確認」と明示し、本文・内部メモを公開しない |

## 登録済み・確認済みソース

2026-08-03時点で、公式ページ上の配信案内と配信URLを確認できたものを登録対象とする。熊本市は公式RSSを案内しており、気象庁は防災情報XMLの配信を案内している。([熊本市RSS案内](https://www.city.kumamoto.jp/kiji00361867/index.html), [気象庁データ利用案内](https://www.data.jma.go.jp/developer/))

| 状態 | ソース | 配信URL | 取得形式 |
|---|---|---|---|
| 登録対象 | 熊本市 防災サイト | `https://www.city.kumamoto.jp/bousai/new_list.xml` | RSS |
| 登録対象 | 熊本市 公式サイト新着情報 | `https://www.city.kumamoto.jp/new_list.xml` | RSS |
| 登録対象 | 気象庁 地震・火山 | `https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml` | Atom/XML |
| 登録対象 | 気象庁 随時 | `https://www.data.jma.go.jp/developer/xml/feed/extra.xml` | Atom/XML |
| 登録対象 | 気象庁 定時 | `https://www.data.jma.go.jp/developer/xml/feed/regular.xml` | Atom/XML |
| 登録対象 | トヨタ 通れた道マップ 交通規制 | `https://www.toyota.co.jp/jpn/auto/passable_route/map/Home/GetVicsReg` | JSON（規制・原因・座標のみ） |
| 表示用 | Open-Meteo Forecast API | `https://api.open-meteo.com/v1/forecast` | JSON（現在気温・降水量・10m風速） |

トヨタの交通規制情報はJARTIC／VICSセンター由来の参考情報であり、通行可能を保証しない。熊本地震周辺の座標範囲に限定し、給電車両データ、VIN、ナンバー、連絡先、航空写真、WMS画像は保存しない。

Open-Meteoは熊本市中心部の現在気象カードだけに利用する。最大10分キャッシュし、`Weather data by Open-Meteo.com`とCC BY 4.0への帰属を表示する。気象警報や避難判断は気象庁・自治体の発表を優先する。

## 優先ソース（候補）

| 優先度 | ソース | 主な情報 | 取得方法 | 備考 |
|---:|---|---|---|---|
| 1 | 熊本県・市町村の公式発表 | 避難所、避難情報、支援 | 公式サイト、RSS、API | 最優先。URLと発表日時を保存 |
| 1 | 消防・警察・災害対策本部 | 救助、通行、被害 | 公式サイト、公式発表 | 緊急情報は人手確認を必須化 |
| 1 | 気象庁 | 警報、注意報、地震・気象 | 公式API・公開データ | 発表区分と対象地域を保存 |
| 1 | 国土地理院 | 地図、地形、道路等 | 公式公開データ | 地図の基盤データとして利用 |
| 2 | NHK等の報道機関 | 現地状況、取材情報 | 公式RSS・API・公開ページ | 「報道情報」と明示。本文転載禁止 |
| 2 | その他ニュース媒体 | 現地状況、解説 | 利用規約で許可されたRSS・API | 媒体ごとに採用可否を記録 |

## 保留中

- 熊本県：RSS配信の案内ページは確認できたが、登録対象となる具体的なフィードURLをまだ特定していない
- NHK等のニュース：ニュース本文を取得・再配布できる公式RSS/APIと利用条件を確認してから登録する

## ソース登録の必須項目

- `source_id`
- `source_name`
- `organization_type`
- `source_url`
- `feed_or_api_url`
- `access_method`
- `source_category`（official / news）
- `terms_checked_at`
- `enabled`
- `last_success_at`
- `last_failure_at`
- `owner`

## 採用ルール

- 公式機関は公式ドメインまたは公式に案内された配信元だけを採用する
- ニュースは媒体が提供する公式RSS/API、または利用規約上許可された取得方法だけを利用する
- robots.txt、利用規約、著作権、再配布条件を確認する
- ニュース本文は保存・転載せず、タイトル、短い要約、URL、日時、媒体名を保存する
- ソースが訂正・削除された場合は、元情報を失わずに失効状態へ変更する
