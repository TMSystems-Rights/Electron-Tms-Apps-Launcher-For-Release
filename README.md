# TMS-AppsLauncher（アプリ起動ランチャー）

起動アプリをグループ分け整理し表示するアプリ起動ランチャー。Electron + TypeScript（main/preload）+ Vanilla JavaScript（renderer）で構築。

公開配布リポジトリ: [TMSystems-Rights/Electron-Tms-Apps-Launcher-For-Release](https://github.com/TMSystems-Rights/Electron-Tms-Apps-Launcher-For-Release)

## v1.7.2 の主な変更

- GUI アプリの起動を ShellExecute 経由に変更し、サクラエディタなど未保存確認ダイアログが出ない不具合を修正しました。

## v1.7.1 の主な変更

- ウィンドウがアクティブになったとき、アプリ検索入力へ自動でフォーカスするようにしました。

## v1.7.0 の主な変更

- 検索対象にアプリ名だけでなく、実行パスのファイル名も含めるようにしました。
- 検索結果に実行パスのファイル名を表示し、ヒット箇所をハイライトするようにしました。
- 部分一致と文字ばらし一致でハイライト表示を変え、検索理由を判別しやすくしました。

## v1.6.5 の主な変更

- 公開配布リポジトリを `Electron-Tms-Apps-Launcher-For-Release` に切り替えました。
- public GitHub Releases から自動更新するため、インストーラに GitHub token を埋め込まない構成にしました。

## v1.6.4 の主な変更

- 検索ボックスにフォーカスがない状態でも Esc キーで検索文字列をクリアし、検索候補を閉じるようにしました。

## v1.6.3 の主な変更

- アプリケーション表示名を `TMS-AppsLauncher` に変更しました。
- GitHub リポジトリ名を `Electron-Tms-Apps-Launcher` に変更しました。

## v1.6.2 の主な機能

- ウィンドウヘッダ背景が Windows のアクセントカラー設定に追従します。アプリ起動中に OS 側のアクセントカラーを変更した場合も即時反映します。
- 起動時にヘッダが白くフラッシュしないよう、初回描画前にタイトルバー色を適用します。
- 管理者権限で起動した場合、タイトルに `（管理者権限）` を表示します。
- アプリ行を右クリックしてコンテキストメニューを表示できます。「管理者として実行」から UAC 昇格で起動できます。
- ツールバーの検索ボックスから、文字の並び順を問わず登録アプリを検索できます。検索結果は上下キーで選択し、Enterまたはクリックで起動できます。
- 検索結果を選ぶと対象行をプレビューし、折りたたまれたグループを一時的に展開します。Escで検索とプレビューを解除できます。
- Windowsのタスクバーに表示されている起動中アプリを3秒間隔で検知し、一覧の背景、左ボーダー、状態ドットで表示します。最小化中も起動中として扱います。

起動中判定は通常のexe、解決可能なlnk、WindowsApps配下のApp Execution Aliasに対応します。実行パスを取得できない管理者権限プロセス、PIDL/UWPショートカット、タスクバーに表示されないバックグラウンドプロセスは対象外です。

## 必要条件

- Node.js 20 以上（推奨）
- Windows 11（64bit）

## セットアップ

```powershell
npm install
```

## 開発起動

```powershell
npm run dev
```

## ビルド

TypeScript コンパイル + renderer 静的ファイルコピー:

```powershell
npm run build
```

## 配布パッケージ作成（Windows インストーラ）

```powershell
npm run dist
```

出力先: `release/<version>/TmsAppLauncher-<version>-setup.exe`（例: `release/1.2.2/TmsAppLauncher-1.2.2-setup.exe`）

`npm run dist` / `npm run dist:publish` 実行前に、`scripts/ensure-dist-ready.ps1` が `app.asar` の**上書き可否**（rename テスト）を検査します。問題があればビルド開始前に中止します（ファイルの削除は行いません）。

`electron-builder.yml` の `publish` は public の配布用リポジトリ `TMSystems-Rights/Electron-Tms-Apps-Launcher-For-Release` を参照します。public リポジトリの GitHub Releases から更新を取得するため、インストーラに GitHub token は埋め込みません。

#### `app.asar` ロック（EBUSY）が出る場合

electron-builder は既存の `app.asar` を **unlink（削除／置換）** します。別プロセスが参照していると失敗します。**エクスプローラーで release を開いていなくても**起こり得ます。

| 想定原因                                    | 対処                                                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor 等 IDE** が `release/` を監視      | `.cursorignore` と `.vscode/settings.json` の `watcherExclude` を設定済み。**Cursor 完全終了**後に再ビルド。孤立フォルダの削除は Cursor 外のターミナルで `pwsh -File scripts/remove-orphan-build-dir.ps1` |
| **ウイルス対策**（F-Secure / NURO SAFE 等） | `release` フォルダをリアルタイムスキャンの**除外**に追加                                                                                                                                                  |
| **Windows Search** のインデックス           | しばらく待つか、`release` をインデックス対象外にする                                                                                                                                                      |
| `release\...\win-unpacked` からアプリ起動中 | プロセスを終了してから再ビルド                                                                                                                                                                            |

**推奨**: パッケージ版の動作確認は `win-unpacked` 直起動ではなく、生成された `setup.exe` でインストールした版を使う。

不要な一時ビルドフォルダ（例: `release-v122`）を削除する場合も、Cursor 起動中は `app.asar` がロックされるため削除できません。Cursor を完全終了してから、外部ターミナルで次を実行してください。

```powershell
pwsh -NoProfile -File scripts/remove-orphan-build-dir.ps1
# 別フォルダを指定する場合:
# pwsh -NoProfile -File scripts/remove-orphan-build-dir.ps1 -TargetDir 'E:\...\release-v122'
```

### 自動アップデート

パッケージ版は起動約 5 秒後に GitHub Releases を確認し、新バージョンがあればバックグラウンドでダウンロードします。ダウンロード完了後に再起動確認ダイアログが表示されます。設定画面の「更新を確認」から手動確認もできます。

#### リリース手順

GitHub Release 公開は、必ず **コミットと push の後**に実行します。

AI（Cursor 等）がリリース作業を行う場合は、`.cursor/rules/release_workflow.mdc` も必ず参照すること。

##### バージョンアップして配布する場合（必須順序）

1. `package.json` の `version` を更新する
2. `npm run dev` 等で動作確認する
3. `npm run build` / `npm run lint` / `npm run test` 等で検証する
4. 変更を **git commit** する（バージョン更新を含むすべての変更）
5. **git push origin main** する
6. `git status` が clean で、`HEAD` と `origin/main` が一致していることを確認する
7. **`npm run dist`** でローカル成果物を生成する
8. GitHub Release に同一ビルドの成果物 3 点を公開する
9. **タグの一致を確認する**（下記「公開後の確認」）

> **重要**: `npm run dist` / `npm run dist:publish` は **commit と push の後**に実行すること。未コミットの作業ツリーからビルドすると、インストーラは新内容でも Git タグが古いコミットを指し、ソースと Release の対応がずれる。タグの付け直し（`git tag -f` / `git push -f`）が必要になる場合がある。

通常のリリースでは `npm run dist:publish` は使わず、`npm run dist` で生成した 3 点を `gh release create/upload` で公開します。`dist:publish` を実行してしまった場合は、`.cursor/rules/release_workflow.mdc` の復旧手順に従い、assets 3 点とタグを検証してください。

##### dist 前の確認

- `git status` が clean（未コミットの version 変更がない）
- `git rev-parse HEAD` と `git rev-parse origin/main` が一致している
- **コミット済み**の `package.json` の `version` が今回のリリース番号と一致している
    - ローカルだけ version を上げて未コミットのままビルドすると、インストーラ内容と Release タグの対応がずれる

##### 必須成果物

`npm run dist` 後、`release/<version>/` に次の 3 点があることを確認します。

| ファイル                                      | 用途                                          |
| --------------------------------------------- | --------------------------------------------- |
| `TmsAppLauncher-<version>-setup.exe`          | NSIS インストーラ                             |
| `TmsAppLauncher-<version>-setup.exe.blockmap` | 差分更新用                                    |
| `latest.yml`                                  | electron-updater が参照する最新バージョン情報 |

`latest.yml` は同じ `npm run dist` で生成された `setup.exe` の `sha512` と `size` を持ちます。`npm run dist` を再実行した場合は、必ず上記 3 点を同じ実行結果でまとめて公開し直してください。

##### GitHub Release 公開

`gh` で public 配布リポジトリの Release に成果物をアップロードします。`gh` の認証情報は Release 作成 / asset 置換にのみ使用し、インストーラには埋め込みません。

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
$repo = "TMSystems-Rights/Electron-Tms-Apps-Launcher-For-Release"
$releaseDir = "release\$version"

gh release create $tag `
	"$releaseDir\TmsAppLauncher-$version-setup.exe" `
	"$releaseDir\TmsAppLauncher-$version-setup.exe.blockmap" `
	"$releaseDir\latest.yml" `
	--repo $repo `
	--title $tag `
	--notes "TMS-AppsLauncher $tag"
```

既存 Release の asset を差し替える場合は、同じ 3 点を `--clobber` でまとめて上書きします。

```powershell
gh release upload $tag `
	"$releaseDir\TmsAppLauncher-$version-setup.exe" `
	"$releaseDir\TmsAppLauncher-$version-setup.exe.blockmap" `
	"$releaseDir\latest.yml" `
	--repo $repo `
	--clobber
```

##### 公開後の確認（必須）

Release 作成後、public 配布リポジトリ側の Release と assets を確認します。ソース管理リポジトリと配布リポジトリを分ける場合、ソース側の `origin/main` と public Release repo のタグ SHA は一致しないことがあります。

```powershell
gh release view v<version> `
	--repo TMSystems-Rights/Electron-Tms-Apps-Launcher-For-Release `
	--json assets,url,tagName
```

- **確認すべきこと**: Release に setup.exe / blockmap / latest.yml の 3 点が揃っている
- **確認すべきこと**: `latest.yml` の `sha512` と `size` が同じビルドで生成した `setup.exe` と対応している
- **注意**: public 配布リポジトリにソースコミットを mirror しない場合、Release の tag は配布リポジトリ側の tag として扱う

タグ不一致が起きる仕組み: リリース作成時の `--target` が意図したコミットと違う、または未コミット状態からビルド / 公開すると、タグと成果物の対応がずれます。public 配布リポジトリに private 側の commit SHA が存在しない場合、その SHA を `gh release create --target` に渡さないでください。

##### バージョンを上げない軽微な修正

README・設計ドキュメント等の変更で、既存ユーザーに新インストーラを配布する必要がない場合は Release 公開は不要です。**git commit → git push** だけでよい。

##### コマンド例（バージョンアップリリース）

```powershell
git add .
git commit -m "v1.x.x で〇〇を追加する"
git push origin main
npm run dist
# gh release create/upload で setup.exe / blockmap / latest.yml を公開
gh release view v1.x.x --repo TMSystems-Rights/Electron-Tms-Apps-Launcher-For-Release --json assets,url,tagName
```

Release 公開には `gh auth login` 済みの認証情報、または GitHub CLI が参照する `GH_TOKEN` / `GITHUB_TOKEN` を使用します。これらは `gh` の操作権限としてのみ使い、`electron-builder.yml` の `publish.token` には設定しません。

`GITHUB_RELEASE_TOKEN` など別名の環境変数を一時的に `GH_TOKEN` へ割り当てて `gh` を実行した場合は、Release 作業完了後に必ず次を実行するか、ターミナルを閉じてください。private リポジトリ向けの読み取り専用 `GH_TOKEN` と混線させないためです。

```powershell
Remove-Item Env:GH_TOKEN
```

**v1.2.2 以前**（v1.2.0 / v1.2.1）をお使いの場合は、自動更新が動作しないため **v1.2.2 へ手動インストール**してください。v1.2.2 以降は自動更新が利用できます。

部分公開のまま終了しないでください。特に `latest.yml` が無い、または `latest.yml` の `sha512` が公開済み `setup.exe` と違う状態では自動更新が壊れます。

### インストーラの仕様

| 項目           | 内容                                                                           |
| -------------- | ------------------------------------------------------------------------------ |
| 形式           | NSIS（`.exe`）                                                                 |
| インストール先 | ウィザードで変更可能（デフォルト: `%LOCALAPPDATA%\Programs\TMS-AppsLauncher`） |
| ショートカット | スタートメニュー（常時）、デスクトップ（追加タスク画面・**デフォルト ON**）    |
| 対象           | Windows 11 64bit                                                               |

インストール後、データは `%APPDATA%\tms-app-launcher\` に保存されます（開発版の `tms-app-launcher-dev` とは別です）。

## Lint

```powershell
npm run lint
npm run lint:fix
```

`npm run lint` は ESLint に加えて、renderer の HTML/CSS が所定フォーマット済みかも検査します。

AI（Codex / Cursor 等）が `src/renderer/**/*.html` または `src/renderer/**/*.css` を編集した場合は、ユーザーが GUI で保存したときと同じ差分になるよう、必ず次のどちらかで整形してください。

```powershell
npm run format:renderer
# または JS の自動修正もまとめて行う場合:
npm run lint:fix
```

HTML は Prettier 設定（`.prettierrc.json`）、CSS は VS Code 標準 CSS formatter 相当（`vscode-css-languageservice`）で整形します。これにより、ユーザーが後から GUI で保存しても HTML/CSS の余計なフォーマット差分が出ない状態を保ちます。

## 自動検証

```powershell
npm test
```

検索、起動中アプリ照合、行ドラッグ、Renderer統合を一時プロファイル上で検証します。通常のユーザーデータと開発用データは変更しません。

## プロジェクト構成

```
src/
├── main/          # メインプロセス（TypeScript）
├── preload/       # preload スクリプト（TypeScript）
└── renderer/      # 画面（HTML/CSS/Vanilla JS）
    ├── common/    # 共通 JS
    ├── main-view/ # メイン画面
    ├── modal-edit/      # 登録・編集モーダル
    └── modal-settings/  # 設定モーダル
```

## データ保存先

| 種別                 | パス                                         |
| -------------------- | -------------------------------------------- |
| ブートストラップ設定 | `%APPDATA%\tms-app-launcher\app-config.json` |
| 実データ             | `<dataDir>\launcher-data.json`               |
| ログ                 | `%APPDATA%\tms-app-launcher\logs\`           |

開発時（未パッケージ）は `%APPDATA%\tms-app-launcher-dev\` を使用します。

### データ保存先の変更について

- **保存先の設定**は `%APPDATA%\tms-app-launcher\app-config.json`（開発時は `tms-app-launcher-dev`）に記録されます
- 設定画面のパス欄は **フォーカスを外す・参照ボタン・「閉じる」** のタイミングで反映されます（入力だけでは未保存のことがあります）
- **既に `launcher-data.json` があるフォルダ**を指定した場合、既存データを上書きせずそのデータを読み込みます（開発用データフォルダの共有向け）
- 開発版（`npm run dev`）とインストール版は **別の app-config** を使うため、データフォルダを共有するには上記の設定変更が必要です

## 仕様書

`設計ドキュメント/0060_アプリ起動ランチャー/020_仕様書/010_アプリ起動ランチャー仕様書.md`
