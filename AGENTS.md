# AGENTS.md — 環境構築・引き継ぎメモ

このファイルは、Claude以外のAIツール(Codex/ChatGPT、Gemini CLIなど)が
このリポジトリを別マシンでゼロから引き継ぐ際に必要な知見をまとめたものです。
コード自体から読み取れない「詰まりポイントと回避策」だけを記録しています。

## 1. このリポジトリでできること

- Webアプリ本体(Cloudflare Workers + D1)は `wrangler deploy` で完結する
- TWA(Android版アプリ)のビルドプロジェクトは別リポジトリ `mamoru-map-twa` にある
  (署名鍵を含むため意図的に分離。https://github.com/ykxlly/mamoru-map-twa)

## 2. Cloudflare Workers / D1

### 認証はマシン単位
`wrangler whoami` で確認できる認証状態は、そのマシンのログインセッションに
紐づいており、Gitリポジトリには含まれない。別マシンで作業する場合は
`npx wrangler login` を改めて実行する必要がある(AIが代行不可、ユーザー操作必須)。

### D1マイグレーションはローカルとリモートで乖離しうる
migration-*.sql をリポジトリに追加しただけでは本番D1には反映されない。
過去に `migration-009-national-road-status.sql` が未適用のまま気づかず、
本番 `/api/archive/reports` が500エラーになった実例がある。

デプロイ手順に必ず含めること:
```bash
# 適用済みか確認(対象カラムの有無をチェック)
npx wrangler d1 execute mamoru-map --remote --command "SELECT name FROM pragma_table_info('extracted_items') WHERE name = '<新カラム名>'"

# 未適用なら、Time Travelでブックマークを取ってから適用
npx wrangler d1 time-travel info mamoru-map
npx wrangler d1 execute mamoru-map --remote --file=./migration-XXX.sql
```

## 3. TWA(Android)ビルド環境の構築 — Windows特有の詰まりポイント

`mamoru-map-twa` プロジェクトを別のWindowsマシンでゼロから構築する場合、
以下の順に詰まる。すべて実際に発生した問題と解決策。

### 3.1 前提バージョン
- JDK 17(Microsoft Build of OpenJDK等)
- Android SDK cmdline-tools + `platform-tools`, `platforms;android-34`,
  `build-tools;36.1.0`(bubblewrap CLIが要求するバージョンは `platforms;android-35` も含めておくと安全)
- `@bubblewrap/cli` (npm)

### 3.2 Android SDKパスの検証エラー「The provided androidSdk isn't correct.」
bubblewrapはSDKルート直下に `tools/` または `bin/` フォルダを要求する(レガシー構成)。
最近のcmdline-toolsは `cmdline-tools/latest/bin` にしか実体がないため、
SDKルートに `tools` という名前でジャンクション(シンボリックリンク)を張る:

```powershell
New-Item -ItemType Junction -Path '<ANDROID_HOME>\tools' -Target '<ANDROID_HOME>\cmdline-tools\latest'
```

### 3.3 `gradlew.bat` が見つからない(`'gradlew.bat' は、内部コマンドまたは外部コマンド...`)
原因: 環境変数 `NoDefaultCurrentDirectoryInExePath=1` が設定されていると、
cmd.exeがカレントディレクトリから無条件ファイル名の実行ファイルを探さなくなる。
bubblewrapの内部実装(`GradleWrapper.js`)は `shell:true` でカレントディレクトリの
`gradlew.bat` を修飾なしで呼ぶため、この環境変数があると必ず失敗する。

回避策(node_modules内をローカルパッチ):
```js
// node_modules/@bubblewrap/core/dist/lib/GradleWrapper.js
if (process.platform === 'win32') {
    this.gradleCmd = '.\\gradlew.bat';  // 'gradlew.bat' から変更
}
```

### 3.4 `'C:\Program' は、内部コマンドまたは外部コマンド...` (apksigner呼び出し失敗)
原因: JDKが `C:\Program Files\...` のようにスペースを含むパスにあると、
`shell:true` で組み立てられるコマンドがスペースで分割されて壊れる。

回避策: スペースを含まないパスへジャンクションを作成し、
`~/.bubblewrap/config.json` の `jdkPath` をそちらに向ける:
```powershell
New-Item -ItemType Junction -Path 'C:\Users\<user>\.bubblewrap\jdk17' -Target 'C:\Program Files\<vendor>\<jdk-dir>'
```
```json
// ~/.bubblewrap/config.json
{"jdkPath": "C:\\Users\\<user>\\.bubblewrap\\jdk17", "androidSdkPath": "..."}
```

### 3.5 「Your project path contains non-ASCII characters」
プロジェクトパスに日本語などの非ASCII文字が含まれると、Android Gradle Pluginが
ビルドを拒否する。`gradle.properties` に以下を追加して回避:
```properties
android.overridePathCheck=true
```

### 3.6 PKCS12形式keystoreのパスワード制約
`keytool -genkeypair` でデフォルト生成されるPKCS12形式は、ストアパスワードと
キーパスワードを別々に設定できない(`-keypass` に別値を渡しても警告が出て無視され、
実質ストアパスワードと同一になる)。**両方とも同じ値で生成すること。**
異なる値を渡してビルド後に署名させると `apksigner` が
`Failed to load signer` で失敗する。

### 3.7 bubblewrap CLIの対話プロンプトを非対話パイプで流す
`printf "Y\n\n\n"` のような固定行数のパイプはストリームがEOFで閉じた瞬間に
inquirerのreadlineも即座にcloseされ、後続のプロンプトで
`Error [ERR_USE_AFTER_CLOSE]` になる。ストリームを閉じないよう
`yes` コマンドで無限に空行を供給する:
```bash
{ echo "Y"; yes ""; } | npx bubblewrap build --skipPwaValidation
```

### 3.8 twa-manifest.json の `appVersionName` は使われない
`appVersionName` フィールドを書いても無視される。実際に読まれるのは
`appVersion` フィールド(`TwaManifest.js` が `data.appVersion` を参照)。
バージョン自動採番(`appVersionCode` の文字列表現と一致していれば
対話プロンプトなしで採番される)を機能させるには `appVersion` を
`appVersionCode` の文字列表現と一致させておく。

### 3.9 パスワードの非対話入力
環境変数 `BUBBLEWRAP_KEYSTORE_PASSWORD` / `BUBBLEWRAP_KEY_PASSWORD` を
設定しておくと、ビルド時のパスワード入力プロンプトをスキップできる。

## 4. Digital Asset Links(TWAの全画面表示に必須)

`public/.well-known/assetlinks.json` に、keystoreのSHA256フィンガープリントを
登録する必要がある。取得コマンド:
```bash
keytool -list -v -keystore ./android.keystore -alias <alias> -storepass <password> | grep "SHA256:"
```
パッケージIDを変更した場合、または署名鍵を作り直した場合は、この値も
更新してデプロイし直すこと(忘れるとTWAがブラウザバー付きで表示されてしまう)。

## 5. 署名鍵の管理

- `android.keystore` を紛失すると、そのパッケージID(`app.mamorumap.twa`)は
  **二度とGoogle Playで更新できない**(新しいアプリとして再登録するしかない)
- リポジトリには含めない(`.gitignore` 対象)。パスワードマネージャー等、
  Gitとは独立した場所にバックアップを保管すること
