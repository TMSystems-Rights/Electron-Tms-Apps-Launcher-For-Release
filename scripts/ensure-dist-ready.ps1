# electron-builder 実行前に app.asar の上書き可否を検査する。
# electron-builder は既存 app.asar の unlink（実質 rename）に失敗すると EBUSY になる。
# ファイル／フォルダの削除は行わない。
param(
	[string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

function Get-PackageVersion {
	param([string]$Root)

	$packageJsonPath = Join-Path $Root 'package.json'
	$packageJson     = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json

	return [string]$packageJson.version
}

function Test-PathUnderDirectory {
	param(
		[string]$ExecutablePath,
		[string]$DirectoryPath
	)

	if ([string]::IsNullOrWhiteSpace($ExecutablePath)) {
		return $false
	}

	$normalizedExecutable = [System.IO.Path]::GetFullPath($ExecutablePath)
	$normalizedDirectory  = [System.IO.Path]::GetFullPath($DirectoryPath)

	return $normalizedExecutable.StartsWith($normalizedDirectory, [StringComparison]::OrdinalIgnoreCase)
}

function Test-AppAsarReplaceable {
	param([string]$AppAsarPath)

	if (-not (Test-Path -LiteralPath $AppAsarPath)) {
		return $true
	}

	$directory = Split-Path -Parent $AppAsarPath
	$fileName  = Split-Path -Leaf $AppAsarPath
	$probeName = ".dist-lock-probe-$([Guid]::NewGuid().ToString('N'))"
	$probePath = Join-Path $directory $probeName

	try {
		Rename-Item -LiteralPath $AppAsarPath -NewName $probeName -ErrorAction Stop
		Rename-Item -LiteralPath $probePath -NewName $fileName -ErrorAction Stop
		return $true
	} catch {
		return $false
	}
}

$version     = Get-PackageVersion -Root $ProjectRoot
$releaseRoot = Join-Path $ProjectRoot 'release'
$issues      = [System.Collections.Generic.List[string]]::new()

$appAsar = Join-Path $releaseRoot "$version\win-unpacked\resources\app.asar"

foreach ($processName in @('TmsAppLauncher', 'electron')) {
	Get-CimInstance Win32_Process -Filter "Name='$processName.exe'" -ErrorAction SilentlyContinue |
		Where-Object { Test-PathUnderDirectory $_.ExecutablePath $releaseRoot } |
		ForEach-Object {
			$issues.Add("$processName.exe が release 配下から起動中です (PID $($_.ProcessId)): $($_.ExecutablePath)")
		}
}

if (-not (Test-AppAsarReplaceable -AppAsarPath $appAsar)) {
	$relative = $appAsar.Substring($ProjectRoot.Length).TrimStart('\')
	$issues.Add("$relative を上書きできません（他プロセスが参照中）")
}

if ($issues.Count -gt 0) {
	Write-Host ''
	Write-Host 'dist ビルドを中止しました。release 内の app.asar を置き換えできません。' -ForegroundColor Yellow
	Write-Host ''
	foreach ($issue in $issues) {
		Write-Host "  - $issue"
	}
	Write-Host ''
	Write-Host '想定される原因（エクスプローラーで release を開いていなくても発生します）:'
	Write-Host '  - Cursor 等 IDE がワークスペース内の release を監視している'
	Write-Host '  - ウイルス対策（F-Secure / NURO SAFE 等）のリアルタイムスキャン'
	Write-Host '  - Windows Search のインデックス作成'
	Write-Host ''
	Write-Host '対処（ファイル削除は不要）:'
	Write-Host '  1. 本リポジトリに .cursorignore（release/ 除外）を追加済み。Cursor を再起動すると効果が出ます'
	Write-Host '  2. ウイルス対策の除外リストに release フォルダを追加する'
	Write-Host '  3. release 配下から起動したランチャー／Electron があれば終了する'
	Write-Host '  4. 動作確認は setup.exe でインストールした版を使う'
	Write-Host ''
	exit 1
}

Write-Host "dist ビルド前提条件 OK (output: release/$version)"
