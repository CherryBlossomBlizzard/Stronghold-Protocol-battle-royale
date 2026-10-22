#!/usr/bin/env bash
# 安装官方皮肤包：自动从 GitHub dist 分支下载 5 个分卷（共 ~400MB），合并解压到 plugins/
set -e
cd "\$(dirname "\$0")"

if [ -f plugins/official-skins/plugin.json ] && [ -d plugins/official-skins/media/spine ]; then
  echo "  皮肤插件已经安装过了。如需重装请先删除 plugins/official-skins/。"
  exit 0
fi

echo "== 下载 5 个分卷（共约 400MB，视网络而定）=="
for i in 001 002 003 004 005; do
  if [ ! -f "official-skins-plugin.zip.7z.\" ]; then
    curl -L -o "official-skins-plugin.zip.7z.\" "https://github.com/CherryBlossomBlizzard/Stronghold-Protocol-battle-royale/raw/dist/official-skins-plugin.zip.7z.\"
  fi
done

echo "== 合并分卷 =="
cat official-skins-plugin.zip.7z.* > official-skins-plugin.7z

echo "== 解压 =="
if command -v 7z >/dev/null 2>&1; then
  7z x -y official-skins-plugin.7z
elif command -v 7za >/dev/null 2>&1; then
  7za x -y official-skins-plugin.7z
else
  echo "[错误] 需要 7-Zip（7z/7za）解压 .7z。请安装：apt install p7zip-full"
  exit 1
fi

echo "== 清理分卷 =="
rm -f official-skins-plugin.zip.7z.* official-skins-plugin.7z

if [ -f plugins/official-skins/plugin.json ] && [ -d plugins/official-skins/media/spine ]; then
  echo ""
  echo "  ============================================================"
  echo "   皮肤包安装完成（64 套皮肤，含战斗内动态模型）"
  echo "  ============================================================"
  echo "   下一步：重启服务器。玩家在【设置】里打开「官方皮肤包」，"
  echo "   到【干员调配】选皮肤；立绘与战斗内动态模型都会生效。"
else
  echo "[错误] 解压后没找到 plugins/official-skins/ 完整结构"
  exit 1
fi