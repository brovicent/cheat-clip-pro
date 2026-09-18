@echo off
setlocal
cd /d "%~dp0"
title Cheat Clip Pro - Build Installer

echo ======================================================================
echo           CHEAT CLIP PRO - ONE-CLICK INSTALLER BUILDER               
echo ======================================================================
echo.

if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe scripts\build_installer.py
) else (
    python scripts\build_installer.py
)

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed! Check the output above for details.
    pause
    exit /b %errorlevel%
)

echo.
echo [DONE] Installer is ready in dist_installer\
pause
