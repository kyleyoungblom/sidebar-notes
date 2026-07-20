Set WshShell = CreateObject("WScript.Shell")

' Kill the app, and whatever holds the Vite port (1420). We target the port
' owner specifically instead of "taskkill /IM node.exe" so we don't nuke
' unrelated node processes (MCP servers, other dev servers, etc.).
WshShell.Run "taskkill /IM sidebar-notes.exe /F", 0, True
WshShell.Run "powershell -NoProfile -Command ""Get-NetTCPConnection -LocalPort 1420 -State Listen -EA 0 | Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }""", 0, True

' Start Vite hidden, then WAIT until it's actually listening on 1420 (up to ~20s)
' before launching the app. A debug build loads its UI from http://localhost:1420,
' so launching before Vite is ready is what produced the blank "xray" window.
WshShell.Run "cmd /c cd /d C:\Users\kyley\dev\sidebar-notes && npx vite", 0, False
WshShell.Run "powershell -NoProfile -Command ""$n=0; while (-not (Get-NetTCPConnection -LocalPort 1420 -State Listen -EA 0) -and $n -lt 100) { Start-Sleep -Milliseconds 200; $n++ }""", 0, True

' Launch the CURRENT debug build. The Cargo target dir is relocated to
' AppData\Local\sidebar-notes-target via src-tauri\.cargo\config.toml, so the
' binary is NOT under src-tauri\target\debug (that path holds a stale 0.4.0 exe).
' NOTE: this launches the last-built binary. After changing RUST code you must
' rebuild via `npm run tauri dev` first; frontend changes are picked up by Vite.
WshShell.Run """C:\Users\kyley\AppData\Local\sidebar-notes-target\debug\sidebar-notes.exe""", 1, False
