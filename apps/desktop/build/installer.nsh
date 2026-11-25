; DelyForge installer additions (picked up automatically by electron-builder from build/installer.nsh).
; Goal: after installing or updating there is exactly one DelyForge on the PC.
; Bots, settings and backups live in %APPDATA%\DelyForge and are never touched here.

!macro customInit
  ; Close every running DelyForge, wherever it was started from, so its files can be replaced or removed.
  ; Polite first (bots stop cleanly), then forced for anything still running.
  nsExec::Exec 'taskkill /IM "DelyForge.exe" /T'
  Pop $0
  Sleep 2000
  nsExec::Exec 'taskkill /F /IM "DelyForge.exe" /T'
  Pop $0
!macroend

; Removes a DelyForge program folder unless it is the one just installed (comparison ignores upper/lower case).
!macro removeOldCopy DIR
  ${If} "${DIR}" != "$INSTDIR"
  ${AndIf} ${FileExists} "${DIR}\DelyForge.exe"
    RMDir /r "${DIR}"
  ${EndIf}
!macroend

!macro customInstall
  ; Every folder an earlier DelyForge build may have installed into.
  !insertmacro removeOldCopy "$LOCALAPPDATA\Programs\@delyforgedesktop"
  !insertmacro removeOldCopy "$LOCALAPPDATA\Programs\delyforge"
  !insertmacro removeOldCopy "$LOCALAPPDATA\Programs\DelyForge"
!macroend
