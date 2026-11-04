@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 安装官方皮肤包

if exist plugins\official-skins\plugin.json (
  if exist plugins\official-skins\plugin.lock.json (
    echo   皮肤插件已经安装过了（含 plugin.lock.json）。如需重装请先删除 plugins\official-skins\。
    pause
    exit /b 0
  )
  echo   检测到旧版皮肤包（没有 plugin.lock.json，战斗里不会出模型），先删掉旧目录再重装 …
  rmdir /s /q plugins\official-skins 2>nul
)

echo == 下载皮肤包（98 MB，视网络而定）==
if not exist official-skins.zip (
  curl -L -o official-skins.zip "https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins.zip"
  if errorlevel 1 (
    echo   [错误] 下载失败。请检查网络后重试。
    pause
    exit /b 1
  )
)

echo == 解压到 plugins\ ==
powershell -NoProfile -Command "Expand-Archive -Path 'official-skins.zip' -DestinationPath 'plugins' -Force"
del official-skins.zip 2>nul

if exist plugins\official-skins\plugin.json (
  echo.
  echo   ============================================================
  echo    皮肤包安装完成（64 套皮肤：62 套含战斗内动态模型 + 2 套立绘）
  echo   ============================================================
  echo    下一步：重启服务器。玩家在【设置】里打开「官方皮肤包」，
  echo    到【干员调配】选皮肤（装载是自动的，开关不会替玩家打开）。
) else echo   [错误] 解压后没找到 plugins\official-skins\plugin.json
pause