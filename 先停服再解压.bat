@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 冷更新助手 · 先停服再解压
set "PORT=4040"
if not "%~1"=="" set "PORT=%~1"

echo ============================================================
echo   冷更新助手：停掉 %PORT% 端口上的服务器
echo   （更新包不会自己停服，必须停干净了再解压覆盖）
echo ============================================================
echo.

set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT%" ^| findstr LISTENING') do (
  if not "%%P"=="0" set "FOUND=!FOUND! %%P"
)

if "!FOUND!"=="" (
  echo   没有任何进程在监听 %PORT% 端口 —— 服务器已经停了。
  echo.
  echo   下一步：把更新包里的 Stronghold-Protocol 文件夹内容解压覆盖到安装目录，然后重新启动。
  echo.
  pause
  exit /b 0
)

echo   监听 %PORT% 端口的进程 PID：!FOUND!
echo.
set /p "OK=要停掉它们吗？(y/N)："
if /i not "%OK%"=="y" (
  echo.
  echo   已取消。请自己停服后再解压覆盖。
  echo.
  pause
  exit /b 1
)

for %%P in (!FOUND!) do (
  echo   正在停止 PID %%P …
  taskkill /PID %%P /T /F
)

echo.
echo   已停服。接下来：
echo     1) 把更新包里的 Stronghold-Protocol 文件夹内容解压覆盖到安装目录；
echo     2) 重新启动（启动卫戍协议：盟约 · 大逃杀.bat / 启动服务器-4040.bat）。
echo.
pause
