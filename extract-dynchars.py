#!/usr/bin/env python3
"""提取 dynchars 皮肤模型 → plugins/official-skins/media/spine/<key>/，并更新 plugin.json 的 spine 字段。

骨骼与 atlas 按**同茎**配对取用（plain 名优先，其次 `_Start`），输出一律写成 plain 名
（`<key>.skel` / `<key>.atlas` / `<key>.webp`），与 plugin.json 的引用、atlas 里的页名行三者对齐 —— 这样
`render/units.js` 的 `spineEntry(id, { skin })` 才能解析到模型，部署后战斗里的角色小人就会按所选皮肤显示。
提取完用 `node tools/plugin.mjs pack <插件>` 生成 plugin.lock.json（骨骼动画数据），`check` 会点出仍读不出来的
皮肤；那些（例如骨骼本身不是 Spine 3.8）应当只留立绘、去掉 spine 字段，别让整包校验失败。

发布到 dist 分支（GitHub 单文件 100MB 上限）：先按同一尺寸重压 media/spine 下的 webp（quality≈70，尺寸不变，
atlas 的 UV 仍然有效），再 pack 重生成 lock，最后打包 zip。"""
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
        skels = {}   # TextAsset 名 → 字节
        atlases = {}
        textures = {}
        for obj in env.objects:
            if obj.type.name == "TextAsset":
                d = obj.read()
                n = getattr(d, "m_Name", "") or ""
                script = getattr(d, "m_Script", "") or ""
                if isinstance(script, str): script = script.encode("utf-8", "surrogateescape")
                if n.startswith("dyn_portrait_"):
                    continue                      # 立绘用的另一套骨骼，不是战斗小人
                if n.endswith(".atlas"): atlases[n[:-len(".atlas")]] = script
                elif n.endswith(".skel"): skels[n[:-len(".skel")]] = script
                elif n == f"dyn_illust_{key}":
                    skels[n] = script             # 没有扩展名的那种：可能是骨骼，也可能不是（下面按能否配对判断）
            elif obj.type.name == "Texture2D":
                d = obj.read()
                n = getattr(d, "m_Name", "") or ""
                if n.startswith(f"dyn_illust_{key}"):
                    try:
                        img = d.image
                        textures[n] = img
                    except Exception as e:
                        fail.append((key, f"tex {n}: {e}"))
        # 骨骼与 atlas 必须**同茎配对**（pixi-spine 按骨架名找同目录的 .atlas）。优先 plain 名，其次 _Start
        # （有些皮肤的主骨骼是 `<key>_Start.skel` + `<key>_Start.atlas`；旧实现取「最大的 TextAsset」，会挑到
        # 一个几 MB 的非骨骼大 blob，导出的 .skel 读不出来 —— 那正是「皮肤只有立绘、部署后不出战斗小人」的成因）。
        plain = f"dyn_illust_{key}"
        start = f"dyn_illust_{key}_Start"
        stem = next((s for s in (plain, start) if s in skels and s in atlases), None)
        if stem is None:
            stem = next((s for s in sorted(skels) if s in atlases), None)
        if stem is None:
            fail.append((key, f"skel={sorted(skels)} atlas={sorted(atlases)}")); continue
        skel, atlas = (stem + ".skel", skels[stem]), (stem + ".atlas", atlases[stem])
        outdir = os.path.join(SPIPE, safe_name(key))
        os.makedirs(outdir, exist_ok=True)
        # 一律写成 plain 名（与 plugin.json 的 `<base>.skel` / `<base>.atlas` 引用一致），atlas 里的页名行同样改成
        # plain `<base>.webp`，三者（引用、文件名、atlas 页名）对齐。
        base = safe_name(f"dyn_illust_{key}")
        with open(os.path.join(outdir, base + ".skel"), "wb") as f: f.write(skel[1])
        atlas_text = atlas[1].decode("utf-8", "replace")
        src_pages = re.findall(r"^(\S+)\.png\s*$", atlas_text, re.M)
        atlas_text = re.sub(r"^\S+\.png\s*$", base + ".webp", atlas_text, flags=re.M)
        with open(os.path.join(outdir, base + ".atlas"), "w", encoding="utf-8") as f: f.write(atlas_text)
        pages = [base + ".webp"] if src_pages else []
        for src_page in src_pages[:1]:        # 单页（dynchars 每个皮肤一张图集页）
            img = None
            for tn, im in textures.items():
                if safe_name(tn) == safe_name(src_page): img = im; break
            if img is None:
                for tn, im in textures.items():
                    if safe_name(tn).startswith(base): img = im; break
            if img is None:
                fail.append((key, f"page {src_page} not found")); pages = []; continue
            img.save(os.path.join(outdir, base + ".webp"), "WEBP", lossless=False, quality=90, method=6)
        # spine 引用（相对插件 media/ 的路径）：文件名一律 plain safe，贴图字段名是 textures（不是 pages）
        rel = f"media/spine/{safe_name(key)}"
        entry = plugin["assets"]["chars"]
        # 找到归属干员
        for cid, rec in entry.items():
            skins = rec.get("skins") or {}
            if key in skins:
                skins[key]["spine"] = {"front": {"skel": f"{rel}/{base}.skel", "atlas": f"{rel}/{base}.atlas",
                                                 "textures": [f"{rel}/{p}" for p in pages], "pma": True}}
                break
        ok.append(key)
        print(f"  OK {key}: {stem} → {base}, {len(pages)} pages, skel {len(skel[1])//1024}KB")
    except Exception as e:
        fail.append((key, repr(e)[:120]))

with open(os.path.join(PLUGIN, "plugin.json"), "w", encoding="utf-8") as f:
    json.dump(plugin, f, ensure_ascii=False, indent=2)

print(f"\n== 提取完成: {len(ok)}/{len(keys)} 成功 ==")
if fail:
    print("失败:")
    for k, why in fail: print(f"  {k}: {why}")