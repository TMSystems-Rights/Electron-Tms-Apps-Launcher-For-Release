<#
.SYNOPSIS
    孤立したビルドフォルダを、Cursor が掴んでいないときだけ削除する

.DESCRIPTION
    既定の対象はリポジトリ隣の release-v122
    Cursor が起動中なら削除せず終了コード 1。対象が無いときは何も消さず終了コード 0

.PARAMETER TargetDir
    削除するフォルダ。未指定時は、このスクリプトの親の release-v122

.OUTPUTS
    なし。結果は標準出力へ書く

.EXAMPLE
    pwsh -NoProfile -File scripts/remove-orphan-build-dir.ps1

.NOTES
    例外:
    - Remove-Item が失敗したときは、その例外をそのまま送出する
#>
param(
	[string]$TargetDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'release-v122')
)

# 失敗したら止める。Remove-Item の失敗は削除せず、その例外のまま出す
$ErrorActionPreference = 'Stop'

# 対象フォルダが無い。何も消さず終了コード 0
if (-not (Test-Path -LiteralPath $TargetDir)) {
	Write-Host "対象フォルダは存在しません: $TargetDir"
	exit 0
}

# 起動中の Cursor。0 件なら削除してよい。見つからなくてもスクリプトは止めない
$cursorProcesses = Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue
# Cursor が 1 件以上いる。削除せず終了コード 1
if ($cursorProcesses) {
	Write-Host 'Cursor が起動中のため削除できません。' -ForegroundColor Yellow
	Write-Host ''
	Write-Host '手順:'
	Write-Host '  1. Cursor のウィンドウをすべて閉じる（Reload Window では不可）'
	Write-Host '  2. タスクマネージャーで Cursor.exe が残っていないことを確認'
	Write-Host '  3. Windows Terminal 等、Cursor 外の PowerShell から本スクリプトを再実行'
	Write-Host ''
	Write-Host "実行中 Cursor PID: $($cursorProcesses.Id -join ', ')"
	exit 1
}

Remove-Item -LiteralPath $TargetDir -Recurse -Force
Write-Host "削除しました: $TargetDir"
