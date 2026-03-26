Set WshShell = CreateObject("WScript.Shell")

' Kill old instances (hidden, wait for each to finish)
WshShell.Run "taskkill /IM sidebar-notes.exe /F", 0, True
WshShell.Run "taskkill /IM node.exe /F", 0, True
WScript.Sleep 1000

' Start Vite hidden (window style 0 = hidden, don't wait)
WshShell.Run "cmd /c cd /d C:\Users\kyley\dev\sidebar-notes && npx vite", 0, False
WScript.Sleep 3000

' Launch the app normally
WshShell.Run """C:\Users\kyley\dev\sidebar-notes\src-tauri\target\debug\sidebar-notes.exe""", 1, False
