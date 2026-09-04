Option Explicit

Dim shell, fso, scriptDir, launcher, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = scriptDir & "\Start-HeuresisDev.ps1"
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & launcher & """"

' Window style 0 keeps the launcher completely hidden. The PowerShell script
' handles rebuilding the local app when GitHub changes, then opens Heuresis.
shell.Run command, 0, False
