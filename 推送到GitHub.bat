@echo off
chcp 65001 >nul
title 补推送大逃杀更新到 GitHub
cd /d "%~dp0"
echo   把本地最新提交（含双规则模式）推送到 GitHub …
echo.
git push origin build/030-migrate:v0.3.1-battle-royale
git push origin HEAD:refs/heads/main
echo.
echo   完成（如仍报网络错误，等网络恢复后再双击本文件）。
pause