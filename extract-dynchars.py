#!/usr/bin/env python3
"""把 arts/dynchars 里**全部**带骨骼的皮肤提取进 plugins/official-skins。

以前只遍历 plugin.json 里已有的 skin 键（64 套），而 dynchars 目录里其实有 102 套 —— 漏了 38 套，所以
【干员调配】里不少干员的皮肤区是空的。现在改成枚举目录：每个 .ab 就是一套皮肤（key 即文件名）。

骨骼与 atlas 按**同茎**配对（plain 名优先，其次 `_Start`），输出统一写成 plain 名（`<base>.skel` /
`<base>.atlas` / `<base>.webp`），与 plugin.json 的引用、atlas 里的页名行三者对齐 —— 这样
`render/units.js` 的 `spineEntry(id, { skin })` 才能解析到模型，部署后战斗里的角色小人就会按所选皮肤显示。
charId 用 `.cache/gamedata/excel/character_table.json` 里「是 skin key 前缀且最长」的那个算出来。

提取完用 `node tools/plugin.mjs pack official-skins` 生成 plugin.lock.json（骨骼动画数据），`check` 会点出仍读不
出来的皮肤；那些（骨骼本身不是 Spine 3.8）应当只留立绘、去掉 spine 字段，别让整包校验失败。
"""
import sys, os, json, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools", "local-extract"))
import aklz4  # noqa: F401 (LZ4AK decoder)
import UnityPy

ROOT = os.path.dirname(os.path.abspath(__file__))
AB_ROOT = r"D:\Hypergryph Launcher\games\Arknights\Arknights_Data\StreamingAssets\AB\Windows\arts\dynchars"
PLUGIN = os.path.join(ROOT, "plugins", "official-skins")
SPIPE = os.path.join(PLUGIN, "media", "spine")
CHARS_JSON = os.path.join(ROOT, ".cache", "gamedata", "excel", "character_table.json")

plugin = json.loads(open(os.path.join(PLUGIN, "plugin.json"), encoding="utf-8").read())
chars_in_plugin = plugin["assets"]["chars"]
table = json.loads(open(CHARS_JSON, encoding="utf-8").read())
char_ids = sorted(table.keys(), key=len, reverse=True)   # 长的在前 → 最长前缀匹配


def char_id_of(skin_key):
    for cid in char_ids:
        if skin_key == cid or skin_key.startswith(cid + "_"):
            return cid
    return None


def safe_name(k):
    return k.replace("#", "_").replace("/", "_").replace("+", "_").replace(".", "_")


keys = sorted(p[:-3] for p in os.listdir(AB_ROOT) if p.endswith(".ab"))
print(f"dynchars 里共 {len(keys)} 套皮肤")

ok, fail, skipped = [], [], []
for key in keys:
    cid = char_id_of(key)
    if not cid:
        fail.append((key, "找不到对应干员"))
        continue
    skins = chars_in_plugin.setdefault(cid, {}).setdefault("skins", {})
    if (skins.get(key) or {}).get("spine", {}).get("front", {}).get("skel"):
        skipped.append(key)                       # 已经提取过
        continue
    ab = os.path.join(AB_ROOT, key + ".ab")
    try:
        env = UnityPy.load(ab)
        skels, atlases, textures = {}, {}, {}
        for obj in env.objects:
            tname = getattr(getattr(obj, "type", None), "name", "")
            if tname == "TextAsset":
                d = obj.read()
                n = getattr(d, "m_Name", "") or ""
                script = getattr(d, "m_Script", "") or ""
                if isinstance(script, str):
                    script = script.encode("utf-8", "surrogateescape")
                if n.startswith("dyn_portrait_"):
                    continue
                if n.endswith(".atlas"):
                    atlases[n[:-6]] = script
                elif n.endswith(".skel"):
                    skels[n[:-5]] = script
                elif n == f"dyn_illust_{key}":
                    skels[n] = script
            elif tname == "Texture2D":
                d = obj.read()
                n = getattr(d, "m_Name", "") or ""
                try:
                    textures[n] = d.image
                except Exception as e:
                    fail.append((key, f"tex {n}: {e}"))
        plain, start = f"dyn_illust_{key}", f"dyn_illust_{key}_Start"
        stem = next((s for s in (plain, start) if s in skels and s in atlases), None) \
            or next((s for s in sorted(skels) if s in atlases), None)
        if stem is None and len(skels) == 1 and len(atlases) == 1:
            # 少数皮肤骨骼与 atlas 的茎名不一致（例如 char_2014_nian_2：skel 是 dyn_illust_char_2014_nian2、
            # atlas 是 dyn_illust_char_2014_nian）。只有一个骨骼 + 一个 atlas 时就是它们俩，直接配对。
            stem = next(iter(skels))
            atlases[stem] = next(iter(atlases.values()))
        if stem is None:
            fail.append((key, f"skel={sorted(skels)} atlas={sorted(atlases)}"))
            continue
        outdir = os.path.join(SPIPE, safe_name(key))
        os.makedirs(outdir, exist_ok=True)
        base = safe_name(f"dyn_illust_{key}")
        with open(os.path.join(outdir, base + ".skel"), "wb") as f:
            f.write(skels[stem])
        atlas_text = atlases[stem].decode("utf-8", "replace")
        src_pages = re.findall(r"^(\S+)\.png\s*$", atlas_text, re.M)
        atlas_text = re.sub(r"^\S+\.png\s*$", base + ".webp", atlas_text, flags=re.M)
        with open(os.path.join(outdir, base + ".atlas"), "w", encoding="utf-8") as f:
            f.write(atlas_text)
        pages = [base + ".webp"] if src_pages else []
        for src_page in src_pages[:1]:
            img = None
            for tn, im in textures.items():
                if safe_name(tn) == safe_name(src_page):
                    img = im
                    break
            if img is None:
                for tn, im in textures.items():
                    if safe_name(tn).startswith(base):
                        img = im
                        break
            if img is None:
                fail.append((key, f"page {src_page} 没找到"))
                pages = []
                continue
            img.save(os.path.join(outdir, base + ".webp"), "WEBP", lossless=False, quality=70, method=6)
        rel = f"media/spine/{safe_name(key)}"
        skins[key] = {"spine": {"front": {"skel": f"{rel}/{base}.skel", "atlas": f"{rel}/{base}.atlas",
                                          "textures": [f"{rel}/{p}" for p in pages], "pma": True}}}
        ok.append(key)
        print(f"  OK {key} → {cid}（{len(pages)} 页，{len(skels[stem]) // 1024} KB 骨骼）")
    except Exception as e:
        fail.append((key, repr(e)[:140]))

with open(os.path.join(PLUGIN, "plugin.json"), "w", encoding="utf-8") as f:
    json.dump(plugin, f, ensure_ascii=False, indent=2)

print(f"\n== 新提取 {len(ok)} 套；已存在跳过 {len(skipped)} 套；失败 {len(fail)} 套 ==")
for k, why in fail:
    print(f"  失败 {k}: {why}")
total = sum(len(r.get("skins") or {}) for r in chars_in_plugin.values())
print(f"插件现在共有 {len(chars_in_plugin)} 位干员 / {total} 套皮肤")
