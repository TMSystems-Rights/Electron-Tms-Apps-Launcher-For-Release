!ifndef BUILD_UNINSTALLER

!include LogicLib.nsh
!include nsDialogs.nsh

Var DesktopShortcutDialog
Var DesktopShortcutCheckbox
Var CreateDesktopShortcut

!macro customInit
	StrCpy $CreateDesktopShortcut "1"
!macroend

Function DesktopShortcutPage
	nsDialogs::Create 1018
	Pop $DesktopShortcutDialog

	${If} $DesktopShortcutDialog == error
		Abort
	${EndIf}

	${NSD_CreateLabel} 0 0 100% 24u "追加タスクを選択してください。"
	Pop $0

	${NSD_CreateCheckbox} 0 28u 100% 12u "デスクトップにショートカットを作成する(&D)"
	Pop $DesktopShortcutCheckbox
	${NSD_SetState} $DesktopShortcutCheckbox ${BST_CHECKED}

	nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
	${NSD_GetState} $DesktopShortcutCheckbox $0

	${If} $0 == ${BST_CHECKED}
		StrCpy $CreateDesktopShortcut "1"
	${Else}
		StrCpy $CreateDesktopShortcut "0"
	${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
	Page custom DesktopShortcutPage DesktopShortcutPageLeave
!macroend

!endif

!ifndef BUILD_UNINSTALLER
!macro customInstall
	${If} $CreateDesktopShortcut == "1"
		CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${APP_DESCRIPTION}"
		ClearErrors
		WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
		System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
	${EndIf}
!macroend
!endif
