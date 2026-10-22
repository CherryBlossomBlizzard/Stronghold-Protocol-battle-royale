@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 卫戍协议：盟约 · 大逃杀 — 自动卸载旧版本
cd /d "%~dp0"

rem ============================================================================
rem  自动卸载旧版本（升级助手）
rem  做什么：
rem    1) 停掉本服正在运行的进程（4040 / 4041 / 4042 / 8080；3000 一律不动）
rem    2) 删除旧版本的【程序文件】—— 本仓库跟踪清单之外的同名残留也会一并清掉
rem    3) 保留你的【数据与素材】：runtime（配置/公告）、plugins（皮肤等）、
rem       node_modules、public\vendor、public\assets、public\fonts、.cache、.git
rem  什么时候用：解压新版覆盖之前；或怀疑旧文件残留导致行为异常时。
rem ============================================================================

echo ============================================================================
echo    卫戍协议：盟约 · 大逃杀 — 自动卸载旧版本
echo ============================================================================
echo.
echo   将要删除（旧程序文件）：
echo     · public\js public\css public\fonts public\media   （旧前端代码与样式）
echo     · server shared test tools docs types packs schemas .github
echo     · node_modules public\vendor                       （依赖，重装自动补）
echo     · 根目录的 js/json/md 配置与锁文件（package.json 等）
echo.
echo   将要保留（你的数据）：
echo     · runtime\        本服配置、公告、扣血上限开关
echo     · plugins\        皮肤等插件（official-skins 官方皮肤包在这里）
echo     · public\assets\  已下载的美术与音频
echo     · .git\ .cache\
echo.
echo   停服范围：4040 / 4041 / 4042 / 8080 上的本服进程；3000 一律不动。
echo.

set /p "OK=确认卸载旧版本？(y/N)："
if /i not "%OK%"=="y" if /i not "%BR_UNINSTALL_YES%"=="1" (
  echo.
  echo   已取消。
  pause
  exit /b 1
)

echo.
echo   == 第 1 步：停服 ==
call :freeport 4040
call :freeport 4041
call :freeport 4042
call :freeport 8080

echo.
echo   == 第 2 步：删除旧程序文件 ==

rem --- 前端代码（新包解压时会覆盖回来）---
for %%D in ("public\js" "public\css" "public\fonts" "public\media") do (
  if exist %%D (
    echo   删除 %%D …
    rmdir /s /q %%D
  )
)

rem --- 服务端与工具 ---
for %%D in ("server" "shared" "test" "tools" "docs" "types" "packs" "schemas" "scripts" ".github") do (
  if exist %%D (
    echo   删除 %%D …
    rmdir /s /q %%D
  )
)

rem --- 根目录的程序文件（按 git 跟踪清单；找不到就跳过）---
for %%F in (".dockerignore" ".git-blame-ignore-revs" ".gitattributes" ".gitignore" "AGENTS.md" "CHANGELOG.md" "CLAUDE.md" "CONTRIBUTING.md" "Dockerfile" "eslint.config.js" "jsconfig.json" "LICENSE" "MODIFICATIONS.md" "NOTICE.md" "README.md" "README-battle-royale.md" "README-upstream.md" "THIRD-PARTY-NOTICES.md" "IMPLEMENTATION_STATUS.md" "package.json" "package-lock.json" "冷更新说明.md" "开服必看.md" "先停服再解压.bat" "启动服务器-4040.bat" "启动-神人派对-9000.bat" "启动卫戍协议：盟约 · 大逃杀.bat" "下载素材.bat") do (
  if exist %%F (
    echo   删除 %%F …
    del /f /q %%F
  )
)

rem --- 依赖（重装自动补回）---
if exist "node_modules" (
  echo   删除 node_modules（重装会自动补回）…
  rmdir /s /q "node_modules"
)
if exist "public\vendor" (
  echo   删除 public\vendor（重装会自动补回）…
  rmdir /s /q "public\vendor"
)

echo.
echo   == 第 3 步：完成 ==
echo.
echo   旧版本程序文件已卸载；你的数据都还在：
echo     runtime\（配置）  plugins\（皮肤插件）  public\assets\（素材）
echo.
echo   下一步：
echo     1) 把新版 Stronghold-Protocol 的内容解压覆盖到本目录；
echo     2) 运行 启动服务器.bat —— 它会自动装回依赖并启动。
echo.
pause
exit /b 0

rem ---------------------------------------------------------------------------
rem :freeport <port> — 关闭占用该端口的 LISTENING 进程；3000 一律不动。
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
    echo   [端口 %P%] PID !PID! 也在监听 3000 —— 按安全规则不动它。
  ) else (
    set "IMG=?"
    for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq !PID!" /FO CSV /NH') do set "IMG=%%~N"
    echo   [端口 %P%] 停止 PID !PID! ^(!IMG!^)…
    taskkill /PID !PID! /T /F >nul 2>&1
    set "FOUND=1"
  )
)
if not defined FOUND echo   [端口 %P%] 没有进程在监听。
endlocal
exit /b 0