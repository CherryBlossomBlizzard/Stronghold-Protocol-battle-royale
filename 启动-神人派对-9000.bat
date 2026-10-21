@echo off
chcp 936 >nul
setlocal EnableExtensions EnableDelayedExpansion
title 卫戍协议 · 神人派对  -  Stronghold Protocol: Party  (9000)

rem ============================================================================
rem  《卫戍协议·神人派对》一键启动器（9000 端口）
rem  双击本文件即可。菜单可选：启动 / 只检查环境 / 查看端口与规则 / 退出。
rem  与 4040、3000 端口的其它安装互不影响（独立端口、独立 runtime）。
rem ============================================================================

set "PORT=9000"
set "HOST=::"
set "SP_SERVER_SETTINGS_DIR=runtime"
cd /d "%~dp0"

rem ---- Node.js 检查 -------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto :nonode
node -e "process.exit(Math.max(0, Math.sign(22 - parseInt(process.versions.node))))"
if errorlevel 1 goto :oldnode

:menu
cls
echo ============================================================================
echo    卫戍协议 · 神人派对     强 势 登 场   ^|   9000 端口
echo ----------------------------------------------------------------------------
echo    玩法：共同 PvE 守线 + 隐藏身份与秘密任务 + 卡牌博弈 + 公共市场
echo          同步秘密行动 + 反制结算 + 古拉格挑战
echo    人数：4-20 人（推荐 8-12 人，可加 AI 队友补位）
echo    开法：建好房间后，在房间底部勾选「开启《卫冕协议·神人派对》模式」
echo ============================================================================
echo.
echo    [1] 启动服务器（默认 9000）
echo    [2] 只检查环境（不启动）
echo    [3] 查看端口占用 / 本机地址 / 规则
echo    [4] 退出
echo.
set "CH="
set /p "CH=  请选择 [1/2/3/4]: "
if "%CH%"=="1" goto :start
if "%CH%"=="2" goto :check
if "%CH%"=="3" goto :status
if "%CH%"=="4" exit /b 0
goto :menu

rem ---- 启动 --------------------------------------------------------------
:start
call :freeport %PORT%
echo.
echo   正在启动服务器（端口 %PORT%）……
echo   —— 启动完成后，用浏览器打开：  http://localhost:%PORT%
echo   —— 局域网 / 朋友的电脑用：   http://本机IP:%PORT%  （下面会打印出来）
echo   —— 停止服务器：在本窗口按 Ctrl+C，或直接关掉本窗口。
echo.
node server\index.js
echo.
echo   服务器已退出（退出码 %errorlevel%）。
echo   如果提示端口被占用，请重新选 [3] 查看，或关掉占用 %PORT% 的程序后重试。
echo.
pause
goto :menu

rem ---- 环境检查 ----------------------------------------------------------
:check
echo.
node -e "console.log('  Node.js 版本: ' + process.version)"
if exist "node_modules\ws\package.json" (echo   依赖 node_modules: OK) else (echo   依赖 node_modules: 缺失 —— 需要先运行 npm install)
if exist "public\vendor" (echo   前端库 public\vendor: OK) else (echo   前端库 public\vendor: 缺失 —— 需要先运行 npm install)
if exist "public\assets" (echo   游戏素材 public/assets: OK) else (echo   游戏素材 public/assets: 缺失 —— 会用占位图，双击「下载素材.bat」补齐)
if exist "data\assets.json" (echo   游戏数据 data\*.json: OK) else (echo   游戏数据: 缺失)
if exist "server\match\party\PartyMatch.js" (echo   神人派对模块: OK) else (echo   神人派对模块: 缺失！这个包里应该有，请重新解压)
echo.
pause
goto :menu

rem ---- 状态 --------------------------------------------------------------
:status
echo.
echo   ---- 端口 %PORT% 占用情况 ----
set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% " ^| findstr /i LISTENING') do (
  set "FOUND=1"
  set "PID=%%P"
  set "IMG=?"
  for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq !PID!" /FO CSV /NH 2^>nul') do set "IMG=%%~N"
  echo     PID !PID!  ^(!IMG!^)  正在监听
)
if not defined FOUND echo     端口 %PORT% 空闲。
echo.
echo   ---- 本机地址（给局域网的朋友用）----
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i /c:"IPv4"') do (
  set "IP=%%A"
  set "IP=!IP: =!"
  if defined IP echo     http://!IP!:%PORT%
)
echo     http://localhost:%PORT%   ^(本机^)
echo.
echo   ---- 古拉格规则速查 ----
echo     第 8 回合开放；第 6 回合与第 8 回合各检定一次 D20，只有恰好掷出 6 才触发暴动。
echo     挑战成功者在下一次主战场结算时返场；队友只能用调度券买一次额外挑战机会，不能替人复活。
echo     暴动后古拉格永久关闭，本局不再收新囚犯。
echo.
pause
goto :menu

rem ---- 清端口 ------------------------------------------------------------
:freeport
rem 只清理 %PORT% 上的残留进程。同时监听 3000 或 4040 的进程一律不动。
setlocal enabledelayedexpansion
set "P=%~1"
set "KEEP= "
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":3000 " /c:":4040 " ^| findstr /i LISTENING') do set "KEEP=!KEEP!%%P "
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%P% " ^| findstr /i LISTENING') do (
  set "PID=%%P"
  set "SKIP="
  if "!PID!"=="0" set "SKIP=1"
  for %%X in (!KEEP!) do if "%%X"=="!PID!" set "SKIP=1"
  if defined SKIP (
    echo   [端口 %P%] PID !PID! 也在监听 3000/4040 —— 不动它，跳过。
  ) else (
    set "IMG=?"
    for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq !PID!" /FO CSV /NH 2^>nul') do set "IMG=%%~N"
    echo   [端口 %P%] 发现 PID !PID! ^(!IMG!^)，自动关闭……
    taskkill /PID !PID! /T /F >nul 2>&1
  )
)
endlocal
exit /b 0

:nonode
echo.
echo   [错误] 没有找到 Node.js（需要 22 或更高版本）。
echo.
echo   方法一（推荐）：winget install OpenJS.NodeJS.LTS
echo   方法二：从官网下载 https://nodejs.org/zh-cn/download
echo.
echo   安装完成后请关掉本窗口，再重新双击「启动-神人派对-9000.bat」。
echo.
pause
exit /b 1

:oldnode
echo.
for /f "delims=" %%v in ('node -v') do echo   [错误] 当前 Node.js 版本 %%v 太旧，需要 22 或更高。
echo.
echo   升级：winget upgrade OpenJS.NodeJS.LTS
echo.
pause
exit /b 1
