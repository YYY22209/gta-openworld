@echo off
title GTA Open World - Local Server
cd /d "%~dp0"

REM Auto-open browser after server starts
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8090/index.html"

echo ================================================
echo   GTA Open World - local server running
echo   Browser: http://localhost:8090
echo   Keep this window OPEN while playing.
echo   Close this window to stop the game.
echo ================================================
python -m http.server 8090
if errorlevel 1 (
  echo Python not found, trying Node.js...
  npx --yes serve -l 8090 .
)
pause
