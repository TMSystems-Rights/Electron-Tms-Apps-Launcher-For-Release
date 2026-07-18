Option Explicit

If WScript.Arguments.Count < 1 Then
	WScript.Quit 1
End If

Dim shortcutPath
shortcutPath = WScript.Arguments(0)

Dim shell
Set shell = CreateObject("Shell.Application")

' lpDirectory は空にし、.lnk 内の作業フォルダ・AUMI・引数を Shell に任せる
shell.ShellExecute shortcutPath, "", "", "", 1
