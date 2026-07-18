# release-v122 等の孤立ビルドフォルダを削除する。
# Cursor が app.asar を掴んでいる間は削除できないため、Cursor 完全終了後に実行する。
param(
	[string]$TargetDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'release-v122')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $TargetDir)) {
	Write-Host "対象フォルダは存在しません: $TargetDir"
	exit 0
}

$cursorProcesses = Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue
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
