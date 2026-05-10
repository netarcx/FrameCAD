!macro customInstall
  ; Install SolidWorks Add-in files
  SetOutPath "$INSTDIR\solidworks-addin"
  File /r "${BUILD_RESOURCES_DIR}\solidworks-addin\*.*"

  ; Register COM add-in via RegAsm
  nsExec::ExecToLog '"$WINDIR\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe" /codebase "$INSTDIR\solidworks-addin\TrentCAD.SolidWorksAddin.dll"'
  Pop $0
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONEXCLAMATION "SolidWorks add-in registration returned code $0.$\nThe add-in may not appear in SolidWorks.$\nTry running the installer as Administrator."
  ${EndIf}
!macroend

!macro customUnInit
  ; Unregister COM add-in
  nsExec::ExecToLog '"$WINDIR\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe" /unregister "$INSTDIR\solidworks-addin\TrentCAD.SolidWorksAddin.dll"'

  ; Remove add-in files
  RMDir /r "$INSTDIR\solidworks-addin"
!macroend
