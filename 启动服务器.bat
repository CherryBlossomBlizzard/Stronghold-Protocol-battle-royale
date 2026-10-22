@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 卫戍协议：盟约 · 大逃杀 — 服务器启动器
cd /d "%~dp0"

rem ============================================================================
rem  卫戍协议：盟约 · 大逃杀（0.3.1 底座 · 20 人房）
rem  · 端口自选：菜单选一个，或手动输入任意端口（1024-65535）
rem  · 启动前自动检测端口占用：占用进程自动关闭（自动卸载）
rem  · 安全规则：清理其它端口时，监听 3000 的进程一律不动；只有你明确选 3000 时才会清理 3000
rem ============================================================================

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
echo    卫戍协议：盟约 · 大逃杀   ·   20 人房   ·   端口自选
echo    维护者：CherryBlossomBlizzard（GitHub）
echo    血量 30 · 卡池角色无限张 · 装备无限量 · 无联防
echo    第 1-13 回合按官方出怪 · 第 14 回合起掷骰子且怪物血量每回合翻倍
echo    第 20 回合首领战（五亿血 · 限时 2 分钟 · 限伤关闭 · 打完即结束）
echo ============================================================================
echo.
node tools\battle-royale.mjs status 2>nul
echo.
echo    -- 选择端口 --------------------------------------------------
echo    [1] 4040  · 本服常用
echo    [2] 4041
echo    [3] 4042
echo    [4] 3000  · 官方默认端口
echo    [5] 8080
echo    [6] 手动输入其他端口
echo    -- 其他操作 --------------------------------------------------
echo    [7] 切换 回合扣血上限 开 / 关
echo    [8] 查看当前规则
echo    [0] 退出
echo.
set "CH="
set /p "CH=请选择："
if "%CH%"=="1" (set "PORT=4040" & goto check)
if "%CH%"=="2" (set "PORT=4041" & goto check)
if "%CH%"=="3" (set "PORT=4042" & goto check)
if "%CH%"=="4" (set "PORT=3000" & goto check)
if "%CH%"=="5" (set "PORT=8080" & goto check)
if "%CH%"=="6" goto askport
if "%CH%"=="7" goto toggle
if "%CH%"=="8" goto show
if "%CH%"=="0" exit /b 0
goto menu

:askport
echo.
set "PORT="
set /p "PORT=请输入端口（1024-65535）："
echo %PORT%| findstr /r /c:"^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo   [错误] 端口必须是纯数字。
  pause
  goto menu
)
if %PORT% LSS 1024 (
  echo   [错误] 端口不能小于 1024，避免和系统服务冲突。
  pause
  goto menu
)
if %PORT% GTR 65535 (
  echo   [错误] 端口不能大于 65535。
  pause
  goto menu
)
goto check

:check
echo.
echo   == 端口 %PORT% 占用检测 ==
call :freeport %PORT%
goto deps

:deps
if not exist "node_modules" (
  echo   首次运行：安装依赖，npm install …
  call npm install
  if errorlevel 1 (
    echo   [错误] npm install 失败。请检查网络后重试。
    pause
    goto menu
  )
)
if not exist "public\vendor\preact.module.js" (
  echo   首次运行：下载前端运行库，npm run vendor …
  call npm run vendor
)
if not exist "public\assets" (
  echo   首次运行：下载美术与音频，npm run setup，可中断，再次运行会续传 …
  call npm run setup
  echo   [提示] 素材没下完也不影响启动，游戏里会自动补齐。
)
goto start

:start
echo.
echo   == 启动服务器 ==
echo   端口：%PORT%
echo   启动完成后浏览器打开：   http://localhost:%PORT%
echo   局域网玩家用             http://本机IP:%PORT%  进入。
echo   停止服务器：在本窗口按 Ctrl+C 或直接关掉窗口。
echo.
node server\index.js
echo.
echo   服务器已退出，退出码 %errorlevel% 。
echo   端口被别的程序占用时：回菜单换一个端口，或再次启动让它自动清理。
echo.
pause
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

rem ---------------------------------------------------------------------------
rem :freeport <port> — 只清理第 1 个参数这个端口上的 LISTENING 进程（自动卸载）。
rem 安全规则：清理其它端口时，同时监听 3000 的进程一律不动；选的就是 3000 时例外。
rem ---------------------------------------------------------------------------
:freeport
setlocal enabledelayedexpansion
set "P=%~1"
set "P3000= "
if not "%P%"=="3000" (
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":3000 " ^| findstr /i LISTENING') do set "P3000=!P3000!%%P "
)
set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%P% " ^| findstr /i LISTENING') do (
  set "PID=%%P"
  set "SKIP="
  if "!PID!"=="0" set "SKIP=1"
  for %%X in (!P3000!) do if "%%X"=="!PID!" set "SKIP=1"
  if defined SKIP (
    echo   [端口 %P%] PID !PID! 也在监听 3000 —— 按安全规则不动它，跳过。
  ) else (
    set "IMG=?"
    for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq !PID!" /FO CSV /NH') do set "IMG=%%~N"
    echo   [端口 %P%] 发现 PID !PID! ^(!IMG!^) 占用，自动关闭…
    taskkill /PID !PID! /T /F >nul 2>&1
    set "FOUND=1"
  )
)
if not defined FOUND echo   [端口 %P%] 空闲，无需清理。
endlocal
exit /b 0