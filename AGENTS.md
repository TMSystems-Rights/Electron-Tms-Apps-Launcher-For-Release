# リポジトリ作業ルール

## HTML/CSS のフォーマット

- `src/renderer/**/*.html` または `src/renderer/**/*.css` を編集した場合は、最終確認前に必ず `npm run format:renderer` を実行する。
- JavaScript の自動修正と renderer の HTML/CSS フォーマットをまとめて適用したい場合は、`npm run lint:fix` を使う。
- `npm run lint` には `npm run format:renderer:check` が含まれる。HTML/CSS のフォーマットチェックが失敗した状態で作業を完了しない。
- フォーマッタの挙動は、ユーザーが GUI で保存したときの挙動に合わせる。HTML は `.prettierrc.json`、CSS は `scripts/format-renderer-assets.mjs` で実装している VS Code 標準 CSS formatter 相当の処理を使う。

# コミットコメントについて

- コミットコメントは原則、日本語で記載すること。（但しコードや技術用語など、英語表記の必要がある単語などはその限りではない）

## GitHub Release 公開時のトークン

- このリポジトリのリリース作業で `gh release create` / `gh release upload` / `gh release view` を実行する場合は、必ず OS 環境変数 `GITHUB_RELEASE_TOKEN` を `GH_TOKEN` に一時割り当てして使う。
- OS 環境変数 `GH_TOKEN` には読み取り専用トークンが設定されているため、Release 作成・更新には使わない。
- 例: `$env:GH_TOKEN=$env:GITHUB_RELEASE_TOKEN; gh release create ...`

## リリース前のプロセス終了確認

- `npm run dev` / `npm run test` / 手動動作確認で起動した `TmsAppLauncher.exe` / `electron.exe` は、検証後に必ず残留確認して終了する。
- 残留プロセスがあると `npm run dist` 中に `release/<version>/win-unpacked.tmp` や `app.asar` をロックするため、commit / push / dist の前に `.cursor/rules/release_workflow.mdc` の「テスト後のプロセス終了確認」を実施する。
- 終了が必要な場合は、まず該当ウィンドウを閉じる。閉じられない場合のみ PID を確認して `Stop-Process -Id <PID>` を使い、`Stop-Process -Name electron` のような広い終了はしない。

