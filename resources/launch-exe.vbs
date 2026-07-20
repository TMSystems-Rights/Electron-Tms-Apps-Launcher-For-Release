Option Explicit

' GUI 実行ファイルを ShellExecute で起動する（エクスプローラー相当）。
' CreateProcess 直起動だと、子アプリのモーダルダイアログが前面に出ない／応答しない
' ことがあるため、通常の .exe 起動はこちらを使う。
'
' 引数:
'   0: 実行ファイルパス（必須）
'   1: 引数文字列（任意）
'   2: 作業ディレクトリ（任意）

If WScript.Arguments.Count < 1 Then
	WScript.Quit 1
End If

Dim exePath, argLine, workDir
exePath = WScript.Arguments(0)
argLine = ""
workDir = ""

If WScript.Arguments.Count >= 2 Then
	argLine = WScript.Arguments(1)
End If

If WScript.Arguments.Count >= 3 Then
	workDir = WScript.Arguments(2)
End If

Dim shell
Set shell = CreateObject("Shell.Application")
shell.ShellExecute exePath, argLine, workDir, "", 1
