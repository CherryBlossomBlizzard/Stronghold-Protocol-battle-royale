@echo off
chcp 936 >nul
setlocal EnableExtensions
title 下载游戏素材  -  Stronghold Protocol assets

rem ============================================================================
rem  下载《明日方舟》美术与音频到 public/assets（约 550 MB，可中断，再次运行会续传）。
rem  不下载也能玩：游戏会用占位图。下载完成后画面才完整。
rem ============================================================================

cd /d "%~dp0"
echo.
echo   即将从公开镜像下载游戏素材（约 550 MB）。
echo   可以随时按 Ctrl+C 中断，下次运行会从断点继续。
echo.
echo   按任意键开始，或关闭窗口取消……
pause >nul

if not exist "node_modules\ws\package.json" (
  echo   [1/2] 先安装依赖……
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

echo   [2/2] 下载素材……
node tools\fetch-assets.mjs --asset-source=mirror --concurrency=24
if errorlevel 1 goto :fail

echo.
echo   素材下载完成！现在双击「启动-神人派对-9000.bat」开始游戏。
echo.
pause
exit /b 0

:fail
echo.
echo   下载失败。可能是网络问题。
echo   · 稍后重新双击本文件即可从断点继续；
echo   · 也可以打开命令行手动运行：
echo       node tools\fetch-assets.mjs --asset-source=mirror
echo.
echo   注意：即使素材没有下载完整，游戏依然可以启动（只是使用占位图）。
echo.
pause
exit /b 1
