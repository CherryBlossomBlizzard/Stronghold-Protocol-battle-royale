#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
BASE="https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist"

# 装一批皮肤：$1 = 插件目录名（同时是 zip 名）
install_pack() {
  local name="$1" size="$2"
  if [ -f "plugins/$name/plugin.json" ] && [ -f "plugins/$name/plugin.lock.json" ]; then
    echo "  $name 已经装过了（含 plugin.lock.json）。"
    return 0
  fi
  if [ -f "plugins/$name/plugin.json" ]; then
    echo "  $name 是旧版（没有 plugin.lock.json，战斗里不会出模型），先删掉重装 …"
    rm -rf "plugins/$name"
  fi
  echo "== 下载 $name（$size）=="
  [ -f "$name.zip" ] || curl -L --retry 2 -o "$name.zip" "$BASE/$name.zip"
  echo "== 解压 $name =="
  if command -v unzip >/dev/null 2>&1; then unzip -o "$name.zip" -d plugins/
  else python3 -c "import zipfile; zipfile.ZipFile('$name.zip').extractall('plugins/')"; fi
  rm -f "$name.zip"
  [ -f "plugins/$name/plugin.json" ] || { echo "[错误] $name 解压失败"; return 1; }
}

install_pack official-skins "98 MB，64 套"
install_pack official-skins-part2 "42.9 MB，36 套"

# 让新房间默认带上皮肤包（没有 plugins/config.json 时新房间不带任何插件 → 皮肤显示「0 套外观」）
if [ -f plugins/official-skins/plugin.json ] && [ ! -f plugins/config.json ]; then
  DEF="\"official-skins\""
  [ -f plugins/official-skins-part2/plugin.json ] && DEF="\"official-skins\", \"official-skins-part2\""
  cat > plugins/config.json <<JSON
{
  "rooms": "host",
  "default": [$DEF],
  "allow": ["*"],
  "classes": { "cosmetic": true, "content": true }
}
JSON
  echo "  已写入 plugins/config.json：新房间默认启用皮肤包。"
fi

echo "== 皮肤包安装完成（64 + 36 = 100 套）== 重启服务器后，新房间默认就带皮肤包；到【干员调配】里选皮肤即可。"
