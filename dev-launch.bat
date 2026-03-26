@echo off
title SBN Dev
taskkill /IM sidebar-notes.exe /F >nul 2>&1
taskkill /IM node.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul
set PATH=%PATH%;C:\Users\kyley\.cargo\bin
cd /d C:\Users\kyley\dev\sidebar-notes
start "Vite" /min cmd /c "npx vite"
timeout /t 3 /nobreak >nul
start "" "C:\Users\kyley\dev\sidebar-notes\src-tauri\target\debug\sidebar-notes.exe"
