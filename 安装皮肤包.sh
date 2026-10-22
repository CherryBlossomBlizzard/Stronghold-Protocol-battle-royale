#!/usr/bin/env bash
# 安装官方皮肤包：自动从 GitHub 的 dist 分支下载（21 MB），解压到 plugins/
set -e
cd "\$(dirname "\$0")"

if [ -f plugins/official-skins/plugin.json ]; then
  echo "  皮肤插件已经安装过了（plugins/official-skins/）。如需重装请先删除该文件夹。"
  exit 0
fi

if [ ! -f official-skins-plugin.zip ]; then
  echo "  正在从 GitHub 下载皮肤包（21 MB）…"
  curl -L -o official-skins-plugin.zip "https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins-plugin.zip"
fi

echo "== 解压插件到 plugins/ =="
if command -v unzip >/dev/null 2>&1; then
  unzip -o official-skins-plugin.zip -d plugins/
else
  python3 -c "import zipfile; zipfile.ZipFile('official-skins-plugin.zip').extractall('plugins/')"
fi

if [ -f plugins/official-skins/plugin.json ]; then
  echo "== 皮肤包安装完成 =="
  echo "  下一步：重启服务器；玩家在【设置】里打开「官方皮肤包」，"
  echo "  到【干员调配】选皮肤。房主也可在房间插件面板为全房间启用。"
else
  echo "[错误] 解压后没找到 plugins/official-skins/plugin.json"
  exit 1
fi