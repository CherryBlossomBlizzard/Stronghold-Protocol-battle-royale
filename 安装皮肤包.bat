@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist official-skins-plugin.zip (
  echo   [错误] 当前目录没有 official-skins-plugin.zip
  echo   把它放到服务器安装目录（与本文件同目录）后再运行。
  pause
  exit /b 1
)
echo == 解压插件到 plugins\ ==
powershell -NoProfile -Command "Expand-Archive -Path 'official-skins-plugin.zip' -DestinationPath 'plugins' -Force"
if exist plugins\official-skins\plugin.json (
  echo == 完成 ==
  echo   插件已就位：plugins\official-skins\
  echo   下一步：重启服务器，然后每个玩家在浏览器【设置】里打开「官方皮肤包」开关，
  echo   再到【干员调配】选皮肤。房主也可以在房间插件面板里为全房间启用。
) else (
  echo   [错误] 解压后没找到 plugins\official-skins\plugin.json
)
pause