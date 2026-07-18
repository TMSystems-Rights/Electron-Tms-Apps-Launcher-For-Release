# dist:publish 後に、ローカルとリモートのリリースタグが一致しているか検証する。
# 不一致のままだと Cursor 等の git pull --tags が「would clobber existing tag」で失敗する。
param(
	[string]$Version = (Get-Content "$PSScriptRoot\..\package.json" -Raw | ConvertFrom-Json).version
)

$tag = "v$Version"
$repoRoot = Resolve-Path "$PSScriptRoot\.."

Push-Location $repoRoot
try {
	$local = git rev-parse $tag 2>$null
	if (-not $local) {
		Write-Error "ローカルにタグ $tag がありません。dist:publish を実行したか確認してください。"
		exit 1
	}

	$remoteLine = git ls-remote origin "refs/tags/$tag"
	if (-not $remoteLine) {
		Write-Error "リモートにタグ $tag がありません。dist:publish の GitHub 公開が失敗した可能性があります。"
		exit 1
	}
	$remote = ($remoteLine -split '\s+')[0]

	if ($local -ne $remote) {
		Write-Error @"
タグ $tag がローカルとリモートで不一致です。
  ローカル: $local ($(git log -1 --oneline $local))
  リモート: $remote ($(git log -1 --oneline $remote 2>$null))

electron-builder はローカルで git tag -f しますが、リモートに同名タグが別 SHA で存在すると上書きされません。
次回の pull --tags でタグ競合が起きます。原因を確認してから対処してください。
"@
		exit 1
	}

	# dist:publish 直後は release コミット = HEAD。後から別コミットを push した場合は一致しないが正常。
	$onHead = $local -eq (git rev-parse HEAD)
	$headHint = if ($onHead) { '（現在の HEAD と一致）' } else { '（HEAD より過去のリリースコミット — リリース後に別コミットを push した場合は正常）' }

	Write-Host "OK: $tag -> $local $headHint"
	Write-Host "OK: ローカルとリモートのタグ SHA が一致しています。"
	exit 0
}
finally {
	Pop-Location
}
