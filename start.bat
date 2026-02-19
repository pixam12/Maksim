@echo off
title Vinted Analyzer
cd /d "%~dp0"
echo.
echo  💎 Vinted Analyzer - Uruchamianie...
echo.
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
node server.js
pause
