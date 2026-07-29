@echo off
setlocal enabledelayedexpansion
title OpenMinis - Build Installer

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo ========================================
echo   OpenMinis PC - Build EXE Installer
echo ========================================
echo.

:: ---- Step 1: Compile TypeScript ----
echo [1/4] Compiling TypeScript...
cd /d "%ROOT%"
"%NODE_EXE%" node_modules\typescript\bin\tsc
if errorlevel 1 (
    echo ERROR: TypeScript compilation failed!
    pause
    exit /b 1
)
echo       OK.

:: ---- Step 2: Build distribution folder ----
echo [2/4] Building distribution folder...
"%NODE_EXE%" build-dist.js
if errorlevel 1 (
    echo ERROR: Distribution build failed!
    pause
    exit /b 1
)
echo       OK.

:: ---- Step 3: Create installer EXE ----
echo [3/4] Creating setup EXE...
powershell -ExecutionPolicy Bypass -File "%ROOT%\create-installer.ps1"
echo       Done.

:: ---- Step 4: Check result ----
echo.
echo [4/4] Checking result...
if exist "%ROOT%\release\OpenMinis-Setup.exe" (
    for %%A in ("%ROOT%\release\OpenMinis-Setup.exe") do (
        set "sz=%%~zA"
        set /a "mb=!sz! / 1048576"
    )
    echo.
    echo ========================================
    echo   BUILD SUCCESSFUL
    echo ========================================
    echo.
    echo   Installer: release\OpenMinis-Setup.exe
    echo   Size: !mb! MB
    echo.
    echo   Run this EXE on any Windows machine
    echo   to install OpenMinis with a desktop
    echo   shortcut.
    echo.
) else (
    echo.
    echo WARNING: IExpress may not have succeeded.
    echo You can also run: start-electron.bat
    echo Or use the files in: release\OpenMinis\
    echo.
)

pause
