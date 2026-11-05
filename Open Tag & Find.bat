@echo off
setlocal
set "PROJECT_DIR=%~dp0"

start "Tag & Find Server" cmd.exe /k "cd /d ""%PROJECT_DIR%"" && npm.cmd run dev -- --port 3000"

for /l %%i in (1,1,30) do (
    powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 goto open_app
    timeout /t 1 /nobreak >nul
)

echo The app server did not respond within 30 seconds. Check the Tag & Find Server window.
pause
exit /b 1

:open_app
start "" "http://localhost:3000"
endlocal
