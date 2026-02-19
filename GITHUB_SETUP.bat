@echo off
echo ===================================================
echo   Vinted Analyzer - Przygotowanie do GitHub
echo ===================================================
echo.
echo [1] Inicjalizacja repozytorium...
git init
echo [2] Dodawanie plikow...
git add .
echo [3] Pierwszy commit...
git commit -m "Initial commit - cloud ready"
echo.
echo Gotowe! Teraz wykonaj te kroki:
echo 1. Stworz nowe repozytorium na GitHub (np. "vinted-analyzer")
echo 2. Skopiuj komende "git remote add origin ..." ze strony GitHub i wklej ja tutaj.
echo 3. Wpisz "git push -u origin main"
echo.
pause
