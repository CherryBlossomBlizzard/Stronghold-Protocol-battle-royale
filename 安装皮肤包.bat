@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 安装官方皮肤包

if exist plugins\official-skins\plugin.json (
  echo   皮肤插件已经安装过了（plugins\official-skins\）。如需重装请先删除该文件夹。
  pause
  exit /b 0
)

if not exist official-skins-plugin.zip (
  echo   正在从 GitHub 下载皮肤包（21 MB，下载速度取决于网络）…
  curl -L -o official-skins-plugin.zip "https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins-plugin.zip"
  if errorlevel 1 (
    echo   [错误] 下载失败。请手动下载：
    echo     https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins-plugin.zip
    echo   放到本目录（与 bat 同目录）后重新运行。
    pause
    exit /b 1
  )
)

echo == 解压插件到 plugins\ ==
powershell -NoProfile -Command "Expand-Archive -Path 'official-skins-plugin.zip' -DestinationPath 'plugins' -Force"
if exist plugins\official-skins\plugin.json (
  echo.
  echo   ============================================================
  echo    皮肤包安装完成
  echo   ============================================================
  echo    下一步：
  echo    1. 重启服务器（关掉再运行 启动服务器.bat）
  echo    2. 每个玩家：浏览器【设置】拉到最底 → 打开「官方皮肤包」开关
  echo    3. 到【干员调配】点开干员 → 「皮肤」分区选皮肤
  echo       （带模型的皮肤在战斗里也会换装）
  echo ============================================================
) else (
  echo   [错误] 解压后没找到 plugins\official-skins\plugin.json
)
pause