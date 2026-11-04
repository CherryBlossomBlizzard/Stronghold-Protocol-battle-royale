@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
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
  curl -L --retry 2 -o official-skins.zip "https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins.zip"
  if errorlevel 1 (
    echo   [错误] 下载失败（curl 退出码 !errorlevel!）。请检查网络后重试。
    echo          常见原因：证书/代理拦截（curl: 35）、DNS 不通、GitHub 被墙。
    echo          手动下载地址：
    echo          https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins.zip
    echo          下载后把 official-skins.zip 放到本文件旁边，再运行一次。
    pause
    goto end
  )
)
rem 98 MB 的包若只下到几十 KB，通常是 GitHub 的错误页/中断 —— 直接用会解压失败
set "ZSZ=0"
for %%F in (official-skins.zip) do set "ZSZ=%%~zF"
if %ZSZ% LSS 50000000 (
  echo   [错误] 下载到的文件不完整（只有 %ZSZ% 字节，正常约 103 MB）。
  echo          已删除，请重试；或换网络后再运行本文件。
  del official-skins.zip 2>nul
  pause
  goto end
)

echo == 解压到 plugins\ ==
powershell -NoProfile -Command "Expand-Archive -Path 'official-skins.zip' -DestinationPath 'plugins' -Force"
set "RC=%errorlevel%"
del official-skins.zip 2>nul

if exist plugins\official-skins\plugin.json (
  rem 让新房间默认带上皮肤包：没有 plugins\config.json 时新房间不带任何插件 → 皮肤显示为「0 套外观」
  if not exist plugins\config.json (
    >"plugins\config.json" echo {
    >>"plugins\config.json" echo   "rooms": "host",
    >>"plugins\config.json" echo   "default": ["official-skins"],
    >>"plugins\config.json" echo   "allow": ["*"],
    >>"plugins\config.json" echo   "classes": { "cosmetic": true, "content": true }
    >>"plugins\config.json" echo }
    echo    已写入 plugins\config.json：新房间默认启用官方皮肤包。
  )
  echo.
  echo   ============================================================
  echo    皮肤包安装完成（64 套皮肤：62 套含战斗内动态模型 + 2 套立绘）
  echo   ============================================================
  echo    下一步：重启服务器。新房间默认就带皮肤包（也可以让玩家自己在
  echo    【设置】里开关），到【干员调配】里选皮肤即可。
) else (
  echo.
  echo   [错误] 解压后没找到 plugins\official-skins\plugin.json（PowerShell 退出码 %RC%）
  echo          常见原因：压缩包不完整、磁盘空间不足、plugins 目录只读。
  echo          可以重新运行本文件；或手动解压 official-skins.zip 到 plugins\ 下。
)
echo.
echo   按任意键关闭窗口。
pause

exit /b 0

:end
endlocal
exit /b 0
