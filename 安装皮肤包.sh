#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ -f plugins/official-skins/plugin.json ] && [ -d plugins/official-skins/media/spine ]; then
  echo "  皮肤插件已经安装过了。如需重装请先删除 plugins/official-skins/。"
  exit 0
fi

echo "== 下载皮肤包（59 MB）=="
if [ ! -f official-skins.zip ]; then
  curl -L -o official-skins.zip "https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins.zip"
fi

echo "== 解压 =="
if command -v unzip >/dev/null 2>&1; then unzip -o official-skins.zip -d plugins/
else python3 -c "import zipfile; zipfile.ZipFile('official-skins.zip').extractall('plugins/')"; fi
rm -f official-skins.zip

[ -f plugins/official-skins/plugin.json ] && echo "== 皮肤包安装完成（64 套皮肤）== 重启服务器后，玩家在【设置】里打开「官方皮肤包」==" || { echo "[错误] 解压失败"; exit 1; }