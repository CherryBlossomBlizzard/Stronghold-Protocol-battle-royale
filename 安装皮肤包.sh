#!/usr/bin/env bash
# 安装官方皮肤包到本服务器的 plugins/ 目录（卫戍协议：盟约 · 大逃杀）
# 用法：把 official-skins-plugin.zip 放到服务器目录里，然后 bash 安装皮肤包.sh
set -e
cd "$(dirname "$0")"

if [ ! -f official-skins-plugin.zip ]; then
  echo "[错误] 当前目录没有 official-skins-plugin.zip"
  echo "       把它上传到服务器安装目录（与本文件同目录）后再运行。"
  exit 1
fi

echo "== 解压插件到 plugins/ =="
command -v unzip >/dev/null 2>&1 && unzip -o official-skins-plugin.zip -d plugins/ \
  || (command -v python3 >/dev/null 2>&1 && python3 -c "import zipfile,os; zipfile.ZipFile('official-skins-plugin.zip').extractall('plugins/')")

if [ -f plugins/official-skins/plugin.json ]; then
  echo "== 完成 =="
  echo "  插件已就位：plugins/official-skins/"
  echo "  下一步：重启服务器（或等它自动扫描），然后每个玩家在浏览器【设置】里打开「官方皮肤包」开关，"
  echo "  再到【干员调配】选皮肤。房主也可以在房间插件面板里为全房间启用。"
else
  echo "[错误] 解压后没找到 plugins/official-skins/plugin.json，请检查 zip 结构。"
  exit 1
fi