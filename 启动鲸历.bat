@echo off
chcp 65001 >nul
cd /d "%~dp0"
title WhaleWeek

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found. Opening the local page directly...
  echo The app still works and saves locally; only PWA install needs a local server.
  echo.
  start "" "%~dp0index.html"
  exit /b 0
)

node scripts\serve.mjs --open
pause
