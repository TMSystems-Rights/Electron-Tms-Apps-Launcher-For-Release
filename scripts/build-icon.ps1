<#
.SYNOPSIS
    PNG から透過付きのマルチサイズ ICO を作る

.DESCRIPTION
    16 から 256 の正方形へ中央を切り出して build/icon.ico を上書きする
    元の PNG は削除しない

.PARAMETER PngPath
    入力 PNG。未指定時は、このスクリプトの親の build\icon.png

.PARAMETER IcoPath
    出力 ICO。未指定時は、このスクリプトの親の build\icon.ico。既存ファイルは上書きする

.OUTPUTS
    なし。成果物は IcoPath へ書く

.EXAMPLE
    pwsh -NoProfile -File scripts/build-icon.ps1

.NOTES
    例外:
    - PNG が読めない、または ICO を書けないときは、その例外をそのまま送出する
#>
param(
	[string]$PngPath = (Join-Path $PSScriptRoot '..\build\icon.png'),
	[string]$IcoPath = (Join-Path $PSScriptRoot '..\build\icon.ico')
)

Add-Type -AssemblyName System.Drawing

# 失敗したら止める。PNG が読めない、または ICO を書けないときは、その例外のまま出す
$ErrorActionPreference = 'Stop'

# 入力 PNG の絶対パス。読めなければ throw し、ICO は書かない
$resolvedPng = (Resolve-Path -LiteralPath $PngPath).Path
# 出力 ICO の絶対パス。既存ファイルは上書きする
$resolvedIco = [System.IO.Path]::GetFullPath($IcoPath)
# ICO に入れる一辺。px。256 はディレクトリ上では 0 と書く
$sizes       = @(16, 24, 32, 48, 64, 128, 256)

<#
.SYNOPSIS
    正方形に切り出した 32bit DIB を返す

.DESCRIPTION
    ICO の画像データに埋め込むバイト列を作る。元画像は変更しない

.PARAMETER Source
    切り出し元の画像。中央の正方形を使う

.PARAMETER Size
    出力の一辺。px

.OUTPUTS
    System.Byte[]

.EXAMPLE
    $bytes = New-IconDibBytes -Source $src -Size 32

.NOTES
    例外:
    - 描画に失敗したときは、その例外をそのまま送出する
#>
function New-IconDibBytes {
	param(
		[System.Drawing.Image]$Source,
		[int]$Size
	)

	# ----------------------------------------------
	# 切り出し矩形
	# ----------------------------------------------
	# 元画像の短辺。px。中央の正方形の一辺になる
	$side    = [Math]::Min($Source.Width, $Source.Height)
	# 切り出し左端。px。幅が高さより大きいときの余白の半分。正方形なら 0
	$cropX   = [int](($Source.Width - $side) / 2)
	# 切り出し上端。px。高さが幅より大きいときの余白の半分。正方形なら 0
	$cropY   = [int](($Source.Height - $side) / 2)
	# 元画像上の切り出し矩形。単位は px
	$srcRect = New-Object System.Drawing.Rectangle $cropX, $cropY, $side, $side
	# 出力ビットマップ上の描画先。左上 0 から、一辺 Size の正方形
	$dstRect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size

	# ----------------------------------------------
	# 描画と書き込み先
	# ----------------------------------------------
	# 32bit ARGB の出力。失敗時は finally で破棄する
	$bmp     = New-Object System.Drawing.Bitmap -ArgumentList $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	# 描画先。finally で破棄する
	$g       = [System.Drawing.Graphics]::FromImage($bmp)
	# DIB バイトの書き込み先。finally で破棄する
	$ms      = New-Object System.IO.MemoryStream
	# DIB をリトルエンディアンで書くライター。finally で破棄する
	$writer  = New-Object System.IO.BinaryWriter $ms

	try {
		# ----------------------------------------------
		# 中央の正方形を描く
		# ----------------------------------------------
		$g.Clear([System.Drawing.Color]::Transparent)
		# 縮小しても輪郭を滑らかにする。既定のままでは 16px が角張る
		$g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
		# 縮小の補間。バイキュービック。最近傍だと小さいサイズが階段状になる
		$g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
		# 描画位置の端数。高品質にすると、縮小の半ピクセルずれを抑える
		$g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
		# 合成の精度。アルファを残し、透過を不透明に潰さない
		$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
		$g.DrawImage($Source, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

		# ----------------------------------------------
		# AND マスクの行幅
		# ----------------------------------------------
		# 1 行の AND マスク幅。バイト。32bit 境界へ切り上げる。0 にはならない
		$maskStride = [int]([Math]::Ceiling($Size / 32.0) * 4)

		# ----------------------------------------------
		# BITMAPINFOHEADER
		# ----------------------------------------------
		$writer.Write([UInt32]40)
		$writer.Write([Int32]$Size)
		$writer.Write([Int32]($Size * 2))
		$writer.Write([UInt16]1)
		$writer.Write([UInt16]32)
		$writer.Write([UInt32]0)
		$writer.Write([UInt32]($Size * $Size * 4))
		$writer.Write([Int32]0)
		$writer.Write([Int32]0)
		$writer.Write([UInt32]0)
		$writer.Write([UInt32]0)

		# ----------------------------------------------
		# ピクセル
		# ----------------------------------------------
		# 下から上へ書く行。px。DIB は下端が先頭なので、0 は最後の行
		for ($y = $Size - 1; $y -ge 0; $y--) {
			# 左から右の列。px。0 は左端
			for ($x = 0; $x -lt $Size; $x++) {
				# この画素の色。BGRA の順で書く
				$pixel = $bmp.GetPixel($x, $y)
				$writer.Write([byte]$pixel.B)
				$writer.Write([byte]$pixel.G)
				$writer.Write([byte]$pixel.R)
				$writer.Write([byte]$pixel.A)
			}
		}

		# ----------------------------------------------
		# AND マスク
		# ----------------------------------------------
		# 下から上へ書く行。px。ピクセルと同じボトムアップ
		for ($y = $Size - 1; $y -ge 0; $y--) {
			# 1 行分の AND マスク。0 は不透明。透明ピクセルだけビットを立てる
			$row = New-Object byte[] $maskStride
			# 左から右の列。px。0 は左端
			for ($x = 0; $x -lt $Size; $x++) {
				# アルファが 128 未満。透明扱いにして、AND マスクのビットを立てる
				if ($bmp.GetPixel($x, $y).A -lt 128) {
					# この x が入るバイト位置。0 から maskStride 未満
					$byteIndex = [int][Math]::Floor($x / 8)
					# 透明ビット。1 が透明。不透明ピクセルは 0 のまま
					$row[$byteIndex] = $row[$byteIndex] -bor (0x80 -shr ($x % 8))
				}
			}
			$writer.Write($row)
		}

		$writer.Flush()
		return , $ms.ToArray()
	} finally {
		$writer.Dispose()
		$ms.Dispose()
		$g.Dispose()
		$bmp.Dispose()
	}
}

# 読み込んだ元画像。finally で破棄する
$src    = [System.Drawing.Image]::FromFile($resolvedPng)
# サイズごとの DIB。1 件でも失敗したら ICO は書かない。成功前は空
$images = @()

try {
	foreach ($size in $sizes) {
		# 1 サイズ分の DIB。Size は px。Bytes が空のサイズは作らない
		$images += [pscustomobject]@{
			# 一辺。px。256 はディレクトリエントリでは 0 になる
			Size  = $size
			# 32bit DIB。ヘッダ、ピクセル、AND マスクを含む
			Bytes = [byte[]](New-IconDibBytes -Source $src -Size $size)
		}
	}
} finally {
	$src.Dispose()
}

# 出力 ICO。Create なので既存は切り詰めて上書きする
$stream = [System.IO.File]::Open($resolvedIco, [System.IO.FileMode]::Create)
# ICO ヘッダと画像を書くライター。finally で破棄する
$writer = New-Object System.IO.BinaryWriter $stream

try {
	$writer.Write([UInt16]0)
	$writer.Write([UInt16]1)
	$writer.Write([UInt16]$images.Count)

	# 画像データの開始位置。バイト。ICONDIR の 6 と、エントリ 16 × 枚数の直後
	$offset = 6 + (16 * $images.Count)
	foreach ($image in $images) {
		# ディレクトリに書く一辺。256 は 1 バイトに入らないので 0、それ以外は px
		$sizeByte = if ($image.Size -eq 256) { 0 } else { $image.Size }
		$writer.Write([byte]$sizeByte)
		$writer.Write([byte]$sizeByte)
		$writer.Write([byte]0)
		$writer.Write([byte]0)
		$writer.Write([UInt16]1)
		$writer.Write([UInt16]32)
		$writer.Write([UInt32]$image.Bytes.Length)
		$writer.Write([UInt32]$offset)
		# 次の画像の開始位置。バイト。この画像の DIB 長だけ進める。0 バイトの画像は進まない
		$offset += $image.Bytes.Length
	}

	foreach ($image in $images) {
		$writer.Write($image.Bytes)
	}
} finally {
	$writer.Dispose()
	$stream.Dispose()
}

Write-Host "Created $resolvedIco"
