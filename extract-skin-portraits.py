#!/usr/bin/env python3
"""把本机客户端里**每一套皮肤的商店立绘**提取出来（spritepack/arts_shop_skin_portrait_*.ab）。

这些 .ab 里的 Sprite 名字就是皮肤 id（`char_1023_ghost2_boc#6`），一个 sprite 一张立绘 —— 这才是
【干员调配】皮肤栏里该显示的图，而之前只提了战斗用的 Spine 骨骼，所以那一格只有一张暗色的战斗图集、
名字还是原始 id。

输出：plugins-skins/<safe(皮肤id)>.webp（先落盘到临时目录，之后按体积分包）。
"""
import sys, os, json, glob
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools", "local-extract"))
import aklz4  # noqa: F401
import UnityPy

ROOT = os.path.dirname(os.path.abspath(__file__))
AB = r"D:\Hypergryph Launcher\games\Arknights\Arknights_Data\StreamingAssets\AB\Windows\spritepack"
OUT = os.path.join(ROOT, ".tmp-portraits")


def safe(k):
    return k.replace("#", "_").replace("/", "_").replace("+", "_").replace(".", "_")


os.makedirs(OUT, exist_ok=True)
files = sorted(glob.glob(os.path.join(AB, "arts_shop_skin_portrait_*.ab")))
print(f"portrait 包 {len(files)} 个")
index = {}
for f in files:
    env = UnityPy.load(f)
    got = 0
    for obj in env.objects:
        t = getattr(getattr(obj, "type", None), "name", "")
        if t != "Sprite":
            continue
        try:
            d = obj.read()
            name = getattr(d, "m_Name", "") or ""
            if not name.startswith("char_"):
                continue
            img = d.image
            if img is None:
                continue
            target = os.path.join(OUT, safe(name) + ".webp")
            img.save(target, "WEBP", lossless=False, quality=78, method=6)
            index[name] = os.path.relpath(target, ROOT).replace("\\", "/")
            got += 1
        except Exception as e:
            print(f"  warn {f}: {e}")
    print(f"  {os.path.basename(f)}: {got} 张")

with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
    json.dump(index, fh, ensure_ascii=False, indent=1)
total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(OUT, "*.webp")))
print(f"\n共 {len(index)} 套皮肤立绘，{total / 1024 / 1024:.1f} MB")
