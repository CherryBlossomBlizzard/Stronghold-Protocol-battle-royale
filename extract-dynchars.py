#!/usr/bin/env python3
"""提取 dynchars 皮肤模型 → plugins/official-skins/media/spine/<key>/，并更新 plugin.json 的 spine 字段。"""
import sys, os, json, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools", "local-extract"))
import aklz4  # noqa: F401 (LZ4AK decoder)
import UnityPy

ROOT = os.path.dirname(os.path.abspath(__file__))
AB_ROOT = r"D:\Hypergryph Launcher\games\Arknights\Arknights_Data\StreamingAssets\AB\Windows\arts\dynchars"
PLUGIN = os.path.join(ROOT, "plugins", "official-skins")
MEDIA = os.path.join(PLUGIN, "media")
SPIPE = os.path.join(MEDIA, "spine")

plugin = json.loads(open(os.path.join(PLUGIN, "plugin.json"), encoding="utf-8").read())
keys = []
for cid, rec in plugin['assets']['chars'].items():
    for sk in (rec.get("skins") or {}):
        keys.append(sk)

def safe_name(k):
    return k.replace("#", "_").replace("/", "_").replace("+", "_").replace(".", "_")

ok, fail = [], []
for key in keys:
    ab = os.path.join(AB_ROOT, key + ".ab")
    if not os.path.isfile(ab):
        fail.append((key, "no bundle")); continue
    try:
        env = UnityPy.load(ab)
        skel = atlas = None
        textures = {}
        for obj in env.objects:
            if obj.type.name == "TextAsset":
                d = obj.read()
                n = getattr(d, "m_Name", "") or ""
                script = getattr(d, "m_Script", "") or ""
                if isinstance(script, str): script = script.encode("utf-8", "surrogateescape")
                if n == f"dyn_illust_{key}.atlas": atlas = (n, script)
                elif n.startswith(f"dyn_illust_{key}") and (n.endswith(".skel") or n == f"dyn_illust_{key}"):
                    # 有些皮肤的主 skel 带 _Start 等后缀，或干脆没有扩展名 —— 取最大的那个（主文件最大）
                    if skel is None or len(script) > len(skel[1]): skel = (n, script)
            elif obj.type.name == "Texture2D":
                d = obj.read()
                n = getattr(d, "m_Name", "") or ""
                if n.startswith(f"dyn_illust_{key}"):
                    try:
                        img = d.image
                        textures[n] = img
                    except Exception as e:
                        fail.append((key, f"tex {n}: {e}"))
        if not (skel and atlas):
            fail.append((key, f"skel={bool(skel)} atlas={bool(atlas)}")); continue
        outdir = os.path.join(SPIPE, safe_name(key))
        os.makedirs(outdir, exist_ok=True)
        with open(os.path.join(outdir, skel[0]), "wb") as f: f.write(skel[1])
        atlas_text = atlas[1].decode("utf-8", "replace")
        with open(os.path.join(outdir, atlas[0]), "wb") as f: f.write(atlas[1])
        # 贴图：atlas 里引用的页名 → 存 png；名字保持与 atlas 引用一致（Spine 读 atlas 相对路径）
        pages = re.findall(r"^(\S+\.(?:png|webp|jpg))\s*$", atlas_text, re.M)
        size = None
        for page in pages:
            img = textures.get(page.replace(".png", "")) or textures.get(page)
            if img is None:
                # 尝试带 [alpha] 等变体
                for tn, im in textures.items():
                    if page.startswith(tn): img = im; break
            if img is None: fail.append((key, f"page {page} not found")); continue
            img.save(os.path.join(outdir, page))
            size = size or 0
        # spine 引用（相对插件 media/ 的路径）
        rel = f"media/spine/{safe_name(key)}"
        entry = plugin["assets"]["chars"]
        # 找到归属干员
        for cid, rec in entry.items():
            skins = rec.get("skins") or {}
            if key in skins:
                skins[key]["spine"] = {"front": {"skel": f"{rel}/{skel[0]}", "atlas": f"{rel}/{atlas[0]}", "pages": pages}}
                break
        ok.append(key)
        print(f"  OK {key}: {len(pages)} pages, skel {len(skel[1])//1024}KB")
    except Exception as e:
        fail.append((key, repr(e)[:120]))

with open(os.path.join(PLUGIN, "plugin.json"), "w", encoding="utf-8") as f:
    json.dump(plugin, f, ensure_ascii=False, indent=2)

print(f"\n== 提取完成: {len(ok)}/{len(keys)} 成功 ==")
if fail:
    print("失败:")
    for k, why in fail: print(f"  {k}: {why}")