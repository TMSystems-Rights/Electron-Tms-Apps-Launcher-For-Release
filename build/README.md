# インストーラ用リソース

| ファイル | 用途 |
|---|---|
| `icon.png` | マスター画像（512×512 推奨）。差し替え時はこのファイルを編集する |
| `icon.ico` | Windows 用マルチサイズアイコン（タスクバー / exe / インストーラ） |

## アイコン更新手順

1. `icon.png` を編集または差し替え
2. 以下で `icon.ico` を再生成

```powershell
pwsh scripts/build-icon.ps1
```

3. `npm run dev` または `npm run dist` で反映を確認

`electron-builder.yml` の `win.icon` で `icon.ico` を参照しています。

## インストーラ

```powershell
npm run dist
```

生成物: `release/TmsAppLauncher-<version>-setup.exe`

| 項目 | 内容 |
|---|---|
| 形式 | NSIS（`.exe`、x64） |
| インストール先 | ウィザードで変更可能 |
| UI 言語 | 日本語（`language: 1041`） |
| スタートメニュー | 常に作成（「TMS-AppsLauncher」） |
| デスクトップ | 「追加タスク」画面で選択（`build/installer.nsh`、デフォルト Off） |
| exe 名 | `TmsAppLauncher.exe` |

カスタム NSIS は `electron-builder.yml` の `nsis.include: installer.nsh` で読み込まれます。
