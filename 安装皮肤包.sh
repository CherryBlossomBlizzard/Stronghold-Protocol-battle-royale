#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ -f plugins/official-skins/plugin.json ] && [ -f plugins/official-skins/plugin.lock.json ]; then
  echo "  皮肤插件已经安装过了（含 plugin.lock.json）。如需重装请先删除 plugins/official-skins/。"
  exit 0
fi
if [ -f plugins/official-skins/plugin.json ]; then
  echo "  检测到旧版皮肤包（没有 plugin.lock.json，战斗里不会出模型），先删掉旧目录再重装 …"
  rm -rf plugins/official-skins
fi

echo "== 下载皮肤包（98 MB）=="
if [ ! -f official-skins.zip ]; then
  curl -L -o official-skins.zip "https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins.zip"
fi

echo "== 解压 =="
if command -v unzip >/dev/null 2>&1; then unzip -o official-skins.zip -d plugins/
else python3 -c "import zipfile; zipfile.ZipFile('official-skins.zip').extractall('plugins/')"; fi
rm -f official-skins.zip

[ -f plugins/official-skins/plugin.json ] && echo "== 皮肤包安装完成（64 套皮肤：62 套含战斗内动态模型 + 2 套立绘）== 重启服务器后，玩家在【设置】里打开「官方皮肤包」（装载自动，开关不会替玩家打开）==" || { echo "[错误] 解压失败"; exit 1; }