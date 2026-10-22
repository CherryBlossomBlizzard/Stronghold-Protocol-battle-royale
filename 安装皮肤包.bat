@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 安装官方皮肤包

if exist plugins\official-skins\plugin.json (
  if exist plugins\official-skins\media\spine (
    echo   皮肤插件已经安装过了。如需重装请先删除 plugins\official-skins\。
    pause
    exit /b 0
  )
)

echo == 下载 5 个分卷（共约 400MB，视网络而定）==
for %%I in (001 002 003 004 005) do (
  if not exist "official-skins-plugin.zip.7z.%%I" (
    curl -L -o "official-skins-plugin.zip.7z.%%I" "https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins-plugin.zip.7z.%%I"
    if errorlevel 1 (
      echo   [错误] 分卷 %%I 下载失败。请检查网络后重试。
      pause
      exit /b 1
    )
  )
)

echo == 合并分卷 ==
copy /b official-skins-plugin.zip.7z.001+official-skins-plugin.zip.7z.002+official-skins-plugin.zip.7z.003+official-skins-plugin.zip.7z.004+official-skins-plugin.zip.7z.005 official-skins-plugin.7z >nul

echo == 解压 ==
rem 7-Zip 查找顺序：PATH → 标准安装位 → 下载目录/本目录里的便携版 7z.exe
set "SZ="
where 7z >nul 2>nul && set "SZ=7z"
if not defined SZ if exist "%ProgramFiles%\7-Zip\7z.exe" set "SZ=%ProgramFiles%\7-Zip\7z.exe"
if not defined SZ if exist "%ProgramFiles(x86)%\7-Zip\7z.exe" set "SZ=%ProgramFiles(x86)%\7-Zip\7z.exe"
if not defined SZ for %%D in ("%USERPROFILE%\Downloads" "%~dp0") do if exist "%%~D\7z.exe" set "SZ=%%~D\7z.exe"
if not defined SZ (
  echo   [错误] 没有找到 7-Zip。三种解决办法任选：
  echo     a. 安装 7-Zip：https://www.7-zip.org/  （装完重新运行本脚本）
  echo     b. 把 7z.exe（绿色版）放到本目录或下载目录
  echo     c. 用 7-Zip 手动解压合并好的 official-skins-plugin.7z，把解压出的
  echo        official-skins 文件夹放进 plugins\ 里
  pause
  exit /b 1
)
"%SZ%" x -y official-skins-plugin.7z >nul

echo == 清理分卷 ==
del official-skins-plugin.zip.7z.* official-skins-plugin.7z 2>nul

if exist plugins\official-skins\plugin.json (
  if exist plugins\official-skins\media\spine (
    echo.
    echo   ============================================================
    echo    皮肤包安装完成（64 套皮肤，含战斗内动态模型）
    echo   ============================================================
    echo    下一步：重启服务器。玩家在【设置】里打开「官方皮肤包」，
    echo    到【干员调配】选皮肤；立绘与战斗内动态模型都会生效。
  ) else echo   [错误] 解压不完整（缺 media\spine）
) else echo   [错误] 解压后没找到 plugins\official-skins\plugin.json
pause