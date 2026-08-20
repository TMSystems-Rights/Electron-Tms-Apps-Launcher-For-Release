# win-unpacked からポータブル ZIP と SHA-256 を生成する。
# electron-builder の zip ターゲットは使わない。
# フォルダ削除は行わず、出力 ZIP / sha256 ファイルは上書きする。
param(
	[string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
	[string]$Version = '',
	[string]$WinUnpackedDir = '',
	[string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-PackageVersion {
	param([string]$Root)

	$packageJsonPath = Join-Path $Root 'package.json'
	$packageJson     = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json

	return [string]$packageJson.version
}

function Convert-ToZipEntryName {
	param(
		[string]$Prefix,
		[string]$RelativePath
	)

	$normalized = $RelativePath.Replace('\', '/')

	if ([string]::IsNullOrWhiteSpace($normalized)) {
		return $Prefix
	}

	return "$Prefix/$normalized"
}

function Test-ExcludedPortableSource {
	param([string]$RelativePath)

	$normalized = $RelativePath.Replace('\', '/')

	if ($normalized -eq 'app-update.yml' -or $normalized.EndsWith('/app-update.yml')) {
		return $true
	}

	if ($normalized -eq 'data' -or $normalized.StartsWith('data/')) {
		return $true
	}

	return $false
}

function Add-ZipFileEntry {
	param(
		[System.IO.Compression.ZipArchive]$Archive,
		[string]$EntryName,
		[string]$SourcePath
	)

	$entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
	$sourceStream = [System.IO.File]::OpenRead($SourcePath)
	try {
		$entryStream = $entry.Open()
		try {
			$sourceStream.CopyTo($entryStream)
		} finally {
			$entryStream.Dispose()
		}
	} finally {
		$sourceStream.Dispose()
	}
}

function Add-ZipTextEntry {
	param(
		[System.IO.Compression.ZipArchive]$Archive,
		[string]$EntryName,
		[byte[]]$Bytes
	)

	$entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
	$entryStream = $entry.Open()
	try {
		$entryStream.Write($Bytes, 0, $Bytes.Length)
	} finally {
		$entryStream.Dispose()
	}
}

if ([string]::IsNullOrWhiteSpace($Version)) {
	$Version = Get-PackageVersion -Root $ProjectRoot
}

if ([string]::IsNullOrWhiteSpace($WinUnpackedDir)) {
	$WinUnpackedDir = Join-Path $ProjectRoot "release\$Version\win-unpacked"
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
	$OutputDir = Join-Path $ProjectRoot "release\$Version"
}

$winUnpackedFull = [System.IO.Path]::GetFullPath($WinUnpackedDir)
$outputFull      = [System.IO.Path]::GetFullPath($OutputDir)
$exePath         = Join-Path $winUnpackedFull 'TmsAppLauncher.exe'
$markerSource    = Join-Path $ProjectRoot 'resources\portable-mode.json'
$readmeSource    = Join-Path $ProjectRoot 'resources\README-PORTABLE.txt'
$zipName         = "TmsAppLauncher-$Version-portable-x64.zip"
$hashName        = "$zipName.sha256"
$zipPath         = Join-Path $outputFull $zipName
$hashPath        = Join-Path $outputFull $hashName
$zipRoot         = 'TMS-AppsLauncher'

if (-not (Test-Path -LiteralPath $exePath)) {
	throw "win-unpacked が見つかりません: $exePath`nnpm run dist の後に実行してください。"
}

if (-not (Test-Path -LiteralPath $markerSource)) {
	throw "portable-mode.json がありません: $markerSource"
}

if (-not (Test-Path -LiteralPath $readmeSource)) {
	throw "README-PORTABLE.txt がありません: $readmeSource"
}

if (-not (Test-Path -LiteralPath $outputFull)) {
	New-Item -ItemType Directory -Path $outputFull | Out-Null
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$zipStream = [System.IO.File]::Create($zipPath)
$archive   = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
$added     = 0

try {
	$files = Get-ChildItem -LiteralPath $winUnpackedFull -Recurse -File

	foreach ($file in $files) {
		$relative = $file.FullName.Substring($winUnpackedFull.Length).TrimStart('\', '/')

		if (Test-ExcludedPortableSource -RelativePath $relative) {
			continue
		}

		$entryName = Convert-ToZipEntryName -Prefix $zipRoot -RelativePath $relative
		Add-ZipFileEntry -Archive $archive -EntryName $entryName -SourcePath $file.FullName
		$added += 1
	}

	Add-ZipFileEntry -Archive $archive -EntryName "$zipRoot/portable-mode.json" -SourcePath $markerSource
	Add-ZipFileEntry -Archive $archive -EntryName "$zipRoot/README-PORTABLE.txt" -SourcePath $readmeSource
	$added += 2
} finally {
	$archive.Dispose()
	$zipStream.Dispose()
}

$sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$hashLine = "$sha256  $zipName`n"
[System.IO.File]::WriteAllText($hashPath, $hashLine, $utf8NoBom)

$verify = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
	$names = @($verify.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })

	if ($names -notcontains "$zipRoot/TmsAppLauncher.exe") {
		throw "ZIP に $zipRoot/TmsAppLauncher.exe がありません。"
	}

	if ($names -notcontains "$zipRoot/portable-mode.json") {
		throw "ZIP に portable-mode.json がありません。"
	}

	if ($names -notcontains "$zipRoot/README-PORTABLE.txt") {
		throw "ZIP に README-PORTABLE.txt がありません。"
	}

	if ($names | Where-Object { $_ -eq "$zipRoot/app-update.yml" -or $_.EndsWith('/app-update.yml') }) {
		throw 'ZIP に app-update.yml が含まれています。'
	}

	if ($names | Where-Object { $_ -eq "$zipRoot/data" -or $_.StartsWith("$zipRoot/data/") }) {
		throw 'ZIP に利用者データ data/ が含まれています。'
	}
} finally {
	$verify.Dispose()
}

Write-Host "portable zip: $zipPath"
Write-Host "sha256: $sha256"
Write-Host "entries copied: $added"
