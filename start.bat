@echo off
cd /d "%~dp0"
echo.
echo ========================================
echo   OpenMinis PC Client
echo ========================================
echo.
echo Starting server...
echo.

set "PATH=C:\Program Files\nodejs;%PATH%"
call npm run start

pause
