@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Stronghold Protocol Server (4040)
cd /d "%~dp0"

rem ============================================================================
rem  卫戍协议：盟约 · 大逃杀（20 人 · 4040）  ·  20 人房 / 4040 端口
rem  与 3000 端口那一份完全隔离：独立目录、独立 runtime、独立缓存，两者可同时运行。
rem  启动前会自动清理占用 4040 的残留进程；监听 3000 的进程一律不动。
rem ============================================================================

set "PORT=4040"
set "HOST=::"
set "SP_SERVER_SETTINGS_DIR=runtime"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 没有找到 Node.js（需要 22 或更高版本）。请先安装，再运行本文件。
  echo.
  pause
  exit /b 1
)

:menu
cls
echo ============================================================================
echo    卫戍协议：盟约 · 大逃杀（20 人 · 4040）   ·   20 人房   ·   4040 端口
echo    维护者：CherryBlossomBlizzard（GitHub）
echo    血量 30 · 卡池角色无限张 · 装备无限量 · 无联防 · 出怪掷骰子
echo    第 15 回合起怪物血量每回合翻四倍 · 第 20 回合首领战（十亿血 · 限时 2 分钟 · 打完即结束）
echo ============================================================================
echo.
node tools\battle-royale.mjs status
echo.
echo    [1] 启动服务器（4040：先自动清理 4040 上的残留进程）
echo    [2] 切换 回合扣血上限  开 / 关
echo    [3] 查看当前规则
echo    [4] 退出
echo.
set "CH="
set /p "CH=请选择 [1-4]："
if "%CH%"=="1" goto start
if "%CH%"=="2" goto toggle
if "%CH%"=="3" goto show
if "%CH%"=="4" exit /b 0
goto menu

:toggle
echo.
node tools\battle-royale.mjs lp-cap toggle
echo.
pause
goto menu

:show
echo.
node tools\battle-royale.mjs status
echo.
pause
goto menu

:start
call :freeport 4040
rem SP-LITE-CHECK：精简包（不带依赖/素材）首次启动时自动补上；完整包会自动跳过
if not exist "node_modules" (
  echo   首次运行：安装依赖（npm install）…
  call npm install
)
if not exist "public\assets" (
  echo   首次运行：下载美术与音频（npm run setup，可中断，再次运行会续传）…
  call npm run setup
)

echo.
echo   正在启动…… 启动完成后浏览器打开：  http://localhost:4040
echo   局域网玩家用  http://本机IP:4040  进入。3000 端口那一份不受影响。
echo   停止服务器：在本窗口按 Ctrl+C 或直接关掉窗口。
echo.
node server\index.js
echo.
echo   服务器已退出（退出码 %errorlevel%。端口被别的程序占用时，改本文件顶部的 PORT）。
pause
goto menu

:freeport
rem 只清理第 1 个参数这个端口上的进程；如果该进程同时监听 3000，则一律不动（3000 那一份绝不碰）。
setlocal enabledelayedexpansion
set "P=%~1"
set "P3000= "
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":3000 " ^| findstr /i LISTENING') do set "P3000=!P3000!%%P "
set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%P% " ^| findstr /i LISTENING') do (
  set "PID=%%P"
  set "SKIP="
  if "!PID!"=="0" set "SKIP=1"
  for %%X in (!P3000!) do if "%%X"=="!PID!" set "SKIP=1"
  if defined SKIP (
    echo   [端口 %P%] PID !PID! 也在监听 3000 —— 按需求不动它，跳过。
  ) else (
    set "IMG=?"
    for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq !PID!" /FO CSV /NH') do set "IMG=%%~N"
    echo   [端口 %P%] 发现 PID !PID! ^(!IMG!^)，自动关闭…
    taskkill /PID !PID! /T /F >nul 2>&1
    set "FOUND=1"
  )
)
if not defined FOUND echo   [端口 %P%] 空闲，无需清理。
endlocal
exit /b 0
