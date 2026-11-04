@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 安装官方皮肤包

set "SKINVER=0.2.0"
set "BASE=https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist"
set "ANY="

call :pack official-skins 50000000 "80 MB，64 套（第一批：带战斗模型 + 立绘）"
call :pack official-skins-part2 20000000 "42.9 MB，36 套（第二批：带战斗模型 + 立绘）"
call :pack official-skins-part3 10000000 "15.4 MB，381 套（第三批：全部时装立绘）"

rem 让新房间默认带上皮肤包：没有 plugins\config.json 时新房间不带任何插件 → 皮肤显示为「0 套外观」
powershell -NoProfile -Command "$ids=@('official-skins','official-skins-part2','official-skins-part3') | Where-Object { Test-Path ('plugins\' + $_ + '\plugin.json') }; if ($ids.Count) { $o=[ordered]@{rooms='host'; default=@($ids); allow=@('*'); classes=[ordered]@{cosmetic=$true; content=$true}}; [System.IO.File]::WriteAllText('plugins\config.json', ($o | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false))); Write-Host '  已写入 plugins\config.json：新房间默认启用皮肤包' }"

echo.
echo   ============================================================
echo    皮肤包安装完成（三批共 481 套：64 + 36 + 381）
echo    名字是「干员名 · 系列」；带骨骼的在战斗中也会换小人。
echo   ============================================================
echo    下一步：重启服务器。新房间默认就带皮肤包（也可以让玩家自己在
echo    【设置】里开关），到【干员调配】里选皮肤即可。
echo.
echo   按任意键关闭窗口。
pause
exit /b 0

rem ---------------------------------------------------------------------------
rem :pack ^<插件目录名^> ^<最小体积^> ^<说明^> —— 缺 lock 或版本不对就重下解压到 plugins\
rem ---------------------------------------------------------------------------
:pack
setlocal enabledelayedexpansion
set "PK=%~1"
set "MINB=%~2"
set "LBL=%~3"
set "DIR=plugins\%PK%"
set "NEED="
if not exist "%DIR%\plugin.lock.json" set "NEED=1"
if not defined NEED (
  findstr /c:"\"version\": \"%SKINVER%\"" "%DIR%\plugin.json" >nul 2>nul || set "NEED=1"
)
if not defined NEED (
  echo   %PK% 已经是最新版（%SKINVER%）。
  endlocal & exit /b 0
)
if exist "%DIR%\plugin.json" (
  echo   检测到旧版 %PK%（缺动画数据或版本低于 %SKINVER%），先删掉旧目录再重装 …
  rmdir /s /q "%DIR%" 2>nul
)
echo == 下载 %PK%（%LBL%）==
if exist "%PK%.zip" del "%PK%.zip" 2>nul
curl -L --retry 2 -o "%PK%.zip" "%BASE%/%PK%.zip"
if errorlevel 1 (
  echo   [错误] %PK% 下载失败（curl 退出码 !errorlevel!）。请检查网络后重试。
  echo          常见原因：证书/代理拦截（curl: 35）、DNS 不通、GitHub 被墙。
  echo          手动下载地址：%BASE%/%PK%.zip
  echo          下载后把 %PK%.zip 放到本文件旁边，再运行一次。
  endlocal
  exit /b 1
)
set "SZ=0"
for %%F in ("%PK%.zip") do set "SZ=%%~zF"
if !SZ! LSS %MINB% (
  echo   [错误] %PK% 没下完整（只有 !SZ! 字节）。已删除，请重试或换网络。
  del "%PK%.zip" 2>nul
  endlocal
  exit /b 1
)
echo == 解压 %PK% ==
powershell -NoProfile -Command "Expand-Archive -Path '%PK%.zip' -DestinationPath 'plugins' -Force"
del "%PK%.zip" 2>nul
if not exist "%DIR%\plugin.json" (
  echo   [错误] %PK% 解压后没找到 %DIR%\plugin.json
  echo          常见原因：压缩包不完整、磁盘空间不足、plugins 目录只读。
  endlocal
  exit /b 1
)
echo    %PK% 就绪。
endlocal
exit /b 0
