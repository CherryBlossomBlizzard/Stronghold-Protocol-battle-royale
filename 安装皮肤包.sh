#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
BASE="https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist"
VER="0.2.0"

# 装一批皮肤：$1 = 插件目录名（同时是 zip 名），$2 = 最小体积（字节）
install_pack() {
  local name="$1" minb="$2"
  local dir="plugins/$name"
  if [ -f "$dir/plugin.lock.json" ] && grep -q "\"version\": \"$VER\"" "$dir/plugin.json" 2>/dev/null; then
    echo "  $name 已经是最新版（$VER）。"
    return 0
  fi
  [ -f "$dir/plugin.json" ] && { echo "  $name 是旧版，先删掉重装 …"; rm -rf "$dir"; }
  echo "== 下载 $name =="
  [ -f "$name.zip" ] || curl -L --retry 2 -o "$name.zip" "$BASE/$name.zip"
  local sz
  sz=$(wc -c < "$name.zip" 2>/dev/null || echo 0)
  if [ "$sz" -lt "$minb" ]; then
    echo "  [错误] $name 没下完整（$sz 字节）。已删除，请重试。"
    rm -f "$name.zip"
    return 1
  fi
  echo "== 解压 $name =="
  if command -v unzip >/dev/null 2>&1; then unzip -o "$name.zip" -d plugins/
  else python3 -c "import zipfile; zipfile.ZipFile('$name.zip').extractall('plugins/')"; fi
  rm -f "$name.zip"
  [ -f "$dir/plugin.json" ] || { echo "  [错误] $name 解压失败"; return 1; }
  echo "  $name 就绪。"
}

install_pack official-skins 50000000 || true
install_pack official-skins-part2 20000000 || true
install_pack official-skins-part3 10000000 || true

# 让新房间默认带上皮肤包（没有 plugins/config.json 时新房间不带任何插件 → 皮肤显示「0 套外观」）
if [ ! -f plugins/config.json ]; then
  DEF=""
  for p in official-skins official-skins-part2 official-skins-part3; do
    [ -f "plugins/$p/plugin.json" ] || continue
    if [ -z "$DEF" ]; then DEF="\"$p\""; else DEF="$DEF, \"$p\""; fi
  done
  if [ -n "$DEF" ]; then
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
fi

echo "== 皮肤包安装完成（三批共 481 套：64 + 36 + 381）== 重启服务器后，新房间默认就带皮肤包；到【干员调配】里选皮肤即可。"
