# リポジトリ作業ルール

## HTML/CSS のフォーマット

- `src/renderer/**/*.html` または `src/renderer/**/*.css` を編集した場合は、最終確認前に必ず `npm run format:renderer` を実行する。
- JavaScript の自動修正と renderer の HTML/CSS フォーマットをまとめて適用したい場合は、`npm run lint:fix` を使う。
- `npm run lint` には `npm run format:renderer:check` が含まれる。HTML/CSS のフォーマットチェックが失敗した状態で作業を完了しない。
- フォーマッタの挙動は、ユーザーが GUI で保存したときの挙動に合わせる。HTML は `.prettierrc.json`、CSS は `scripts/format-renderer-assets.mjs` で実装している VS Code 標準 CSS formatter 相当の処理を使う。
