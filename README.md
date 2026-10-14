# 卫戍协议：盟约 · 大逃杀 · Stronghold Protocol: Alliance (Battle Royale)

《明日方舟》季节性自走棋塔防玩法「卫戍协议：盟约」的**非官方同人复刻**的**第三方修改版**：浏览器即开即玩，**最多 20 人**联机合作，一局打到第 20 回合的首领战为止。

本仓库站在**两代上游**之上：原作者 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)（规则实现与整个项目基础），
以及 **[龙千尘 (LongQianChen)/Stronghold-Protocol](https://github.com/LongQianChen/Stronghold-Protocol) 的「20 人版」分支
[`feat/IncreasePlayerCapacity`](https://github.com/LongQianChen/Stronghold-Protocol/tree/feat/IncreasePlayerCapacity)**（20 人房、玩家分组与分组卡池、紧凑线协议与网络优化、素材预缓存、公告、大厅发现、房间管理等）。
本仓库（「卫戍协议：盟约 · 大逃杀」）只改一局的节奏与难度曲线，哪些能力来自哪里见下面的[来源与署名](#来源与署名)。

![version](https://img.shields.io/badge/version-0.2.6--battle-royale-2ea44f)
![license](https://img.shields.io/badge/code%20license-GPL--3.0--or--later-blue)
![node](https://img.shields.io/badge/node-22%20%7C%2024-339933)
![players](https://img.shields.io/badge/co--op-1--20%20players-8957e5)

## 声明

> [!IMPORTANT]
> - **本仓库不是上游官方仓库，也不是《明日方舟》官方内容。** 它基于 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)（v0.2.6）与 [LongQianChen/Stronghold-Protocol](https://github.com/LongQianChen/Stronghold-Protocol) 的 `feat/IncreasePlayerCapacity` 分支（20 人房来源）修改而来，由 [**CherryBlossomBlizzard**](https://github.com/CherryBlossomBlizzard) 维护，**与上游作者、上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方没有任何关系**，未获其授权或认可。
> - 《明日方舟》及「卫戍协议」相关的名称、角色、美术、音乐、音效、文本与数据等素材，版权归原权利人所有。这些素材**不适用**本项目的 GPL-3.0 许可证；GPL 只覆盖本项目自己编写的代码（含本仓库的修改）。本仓库源码**不包含**任何美术与音频素材。
> - **严禁任何形式的盈利**，包括但不限于：售卖本项目或整合包、付费下载或付费分发、收费服务器或收费代开、广告 / 打赏 / 会员等变现方式，以及其他任何商业用途。仅供学习交流与个人非商业使用。
> - [Releases](../../releases/latest) 中的完整包为了方便玩家**附带了游戏素材**，下载即视为同意本声明：**请勿把这些素材用于本项目以外的用途，也不要单独再分发**；不想要素材可以用源码自己装（首次启动从公开镜像下载）。
> - 本仓库相对上游的改动见 [MODIFICATIONS.md](MODIFICATIONS.md)（GPL-3.0 第 5 条要求的改动声明）。再分发时请保留 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md)、[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 与 [MODIFICATIONS.md](MODIFICATIONS.md)，并同样注明**非官方、非商业**。
> - 权利人如认为本项目侵犯其权益，请通过 Issue 联系，我们会**立即删除**相关内容。
> - 本项目按「现状」提供，**不提供任何担保**，使用风险自负（含开服的网络、第三方联机工具与当地法律法规风险）。

English summary: [below](#english).

| 同盟房间 | 策略轮选 | 休整期（商店 / 盟约） |
|---|---|---|
| ![房间](docs/img/room.jpg) | ![策略](docs/img/band-draft.jpg) | ![休整期](docs/img/prep.jpg) |
| **部署方向轮盘** | **作战** | **最终攻势（第 20 回合 · 十亿血 · 限时两分钟）** |
| ![方向](docs/img/facing-wheel.jpg) | ![作战](docs/img/combat.jpg) | ![最终攻势](docs/img/final-assault.jpg) |

## 目录

- [声明](#声明) · [来源与署名](#来源与署名) · [简介](#简介) · [本版规则](#本版规则) · [快速开始](#快速开始) · [系统要求](#系统要求) · [端口与配置](#端口与配置)
- [局域网联机](#局域网联机) · [升级与更新包](#升级与更新包) · [文档](#文档) · [开发与测试](#开发与测试) · [项目结构](#项目结构)
- [许可证](#许可证) · [致谢与数据来源](#致谢与数据来源) · [贡献](#贡献)

## 来源与署名

本仓库是**第三代**：原作者 → 龙千尘的 20 人分支 → 本仓库。哪些能力来自哪里，写清楚：

| 能力 | 来源 |
|---|---|
| 官方规则实现（干员 / 技能 / 盟约 / 敌人 / 地形 / 经济 / 最终攻势 / 结算等）与整个项目基础 | 原作者 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) |
| **最大 20 人房**（4 / 8 / 10 / 16 / 20 席位）、玩家**分组机制**与分组卡池（固定组共享干员池与装备库存、组内轮选、组间并行） | [龙千尘 (LongQianChen)](https://github.com/LongQianChen/Stronghold-Protocol) 的 [`feat/IncreasePlayerCapacity`](https://github.com/LongQianChen/Stronghold-Protocol/tree/feat/IncreasePlayerCapacity) 分支 |
| 网络与体积优化（紧凑 WebSocket 协议、公共状态最高 8 Hz、消息压缩、素材地址内容哈希与预缓存、在线素材补齐与本机素材导入） | 同上 |
| 公告与紧急通知、大厅目录与身份恢复、房间管理、对局聊天、断线重连与 AI 托管、开局重刷 | 同上 |
| 血量统一 30、卡池角色无限张、装备无限量供应、删除联防、出怪掷骰子（前 8 回合只出中低怪）、第 15 回合起怪物血量 ×4、第 20 回合十亿血限时首领战、扣血加钱按钮、4040 启动脚本与自动清端口 | **本仓库**，维护者 [**CherryBlossomBlizzard**](https://github.com/CherryBlossomBlizzard) |

- 龙千尘分支自己的说明（`docs/development/` 里的决定清单 D004–D037、开发记录与 `docs/PLAYER_CAPACITY.md`）**随源码保留在本仓库中**，便于对照每个多人分支行为的来龙去脉；本仓库对**已经实现的多人行为**默认保持其决定，只改上表最后一行的玩法数值。
- 本仓库（「卫戍协议：盟约 · 大逃杀」）的修改与维护：**[CherryBlossomBlizzard](https://github.com/CherryBlossomBlizzard)**。
- 三个仓库都以 **GPL-3.0-or-later** 发布，本仓库的修改也以同一许可证发布；完整的版权与使用声明见 [NOTICE.md](NOTICE.md) 与 [MODIFICATIONS.md](MODIFICATIONS.md)。

## 简介

「卫戍协议：盟约」是自走棋 + 塔防：休整期在调度中心招募干员、摆阵、配装备，作战期干员自动部署，迎击从红门涌来的敌人，漏过去的敌人扣目标生命值。

本仓库在[上游复刻](https://github.com/sganggs/Stronghold-Protocol)的基础上改了**一局的节奏与难度曲线**，做成一个更适合多人大厅（最多 20 人）"大逃杀式"长局：出怪掷骰子、卡池与装备不再限量、没有联防、怪物血量逐回合暴涨，最后在第 20 回合用一场**十亿血的限时首领战**收尾。

- **同盟模拟**：1–20 人**合作**（没有 PvP；空位可以加 AI 队友），卡池按固定分组共享。
- 服务器是一个 Node.js 程序，**战斗在各玩家的浏览器里模拟**（和上游/官方一样），服务器只管经济与回合。
- 上游的实现原则、规则对照与数值来源见 [README-upstream.md](README-upstream.md) 与 `docs/`。

## 本版规则

相对上游 v0.2.6 的改动（完整清单见 [MODIFICATIONS.md](MODIFICATIONS.md)）：

| 项目 | 本版 |
|---|---|
| 目标生命值（血量） | **所有策略、所有玩家上限 30**；一回合扣血上限默认 10 点，**可用开关关掉**（关掉即扣血无限制） |
| 公共卡池 | 角色**无限张**（保留上游按剩余份数加权的抽卡概率，只把每名干员的上限放大 100 倍） |
| 装备 | **无限量供应**（取消共享库存上限） |
| 联防 | **删除**：谁漏怪谁直接扣血，不再有队友帮忙拦截 |
| 出怪 | **掷骰子**：每一波的敌人从全部怪物里随机抽；**前 8 回合只出「中等及以下」**（属性强度 ≤ 全部怪物的 70% 分位），第 9 回合起全开 |
| 怪物数值 | 第 1–13 回合官方表；第 14 回合按前 13 回合比例；**第 15 回合起血量在上一回合基础上翻 4 倍** |
| 首领战 | **第 20 回合强制进入「最终攻势」**：领袖血量固定 **十亿**、**限时 2 分钟**，战斗结束即结束这一把（不进隐秘核心） |
| 扣血加钱 | 休整期顶栏的按钮：**3 滴血换 1 资金**；低于 3 滴不能用；刚好 3 滴可以使用，但用完**当场淘汰** |
| 禁用阵营 | 保留上游原值（被禁的盟约与其干员不出现，开局与对局中都能查看） |
| 端口 | 启动脚本默认 **4040**，与 3000 端口的另一份安装彼此隔离，可同时运行 |

## 快速开始

### 方式一：整合包（推荐）

[Releases](../../releases/latest) 里的完整包 `Stronghold-Protocol-v<版本>-battle-royale-full.zip`（约 500 MB，解压后约 790 MB）：

- 自带全部美术 / 音频（含中文、日文两套干员语音、官方 3D 棋盘贴图与各战场场景）与 `node_modules`，**解压即玩**，不需要再下载任何东西；
- 内含 `MANIFEST.json`（本版本全部程序文件的清单），以后可以用**更新包**增量升级，不用重新下载整个包。

1. **安装 Node.js 22 或 24（LTS）** —— Windows 在 PowerShell 里运行 `winget install OpenJS.NodeJS.LTS`，或到 <https://nodejs.org/zh-cn/download> 下载；macOS `brew install node@22`；Linux 用发行版包管理器。
2. **下载并解压** 完整包到一个路径较短的文件夹（Windows 上建议不要放在 OneDrive 同步目录里）。
3. **启动**：双击包内的 **`启动服务器-4040.bat`**（大逃杀命名的那份是 `启动卫戍协议：盟约 · 大逃杀.bat`），按菜单选 `1`。
   脚本会**先自动检测 4040 端口**：被占用就关掉占用它的进程；**同时监听 3000 的进程一律不动**。
   菜单里选 `2` 可以切换"回合扣血上限"开关，选 `3` 看当前规则。
4. 浏览器打开 `http://localhost:4040`；窗口里会打印局域网地址，直接发给同一网络的朋友即可。

### 方式二：从源码运行

```bash
git clone https://github.com/你的用户名/Stronghold-Protocol-battle-royale.git
cd Stronghold-Protocol-battle-royale
npm install        # 安装依赖（postinstall 会把 pixi / preact / three 复制到 public/vendor）
npm run setup      # 检查环境，并从公开镜像下载约 550 MB 美术 / 音频（可中断，再次运行会续传）
set PORT=4040 && npm start      # Windows；macOS / Linux：PORT=4040 npm start
```

素材下载优先使用 GitHub，失败时自动改用 jsDelivr 镜像。`npm run doctor`（`node tools/doctor.mjs`）可以随时诊断：Node 版本、素材是否完整、端口占用、局域网地址与防火墙。

### 系统要求

| 项目 | 要求 |
|---|---|
| 开服的电脑 | Windows / macOS / Linux，Node.js 22 或 24（LTS）；磁盘约 700–850 MB；内存空闲约 100 MB，每局再加几 MB |
| 玩家 | 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版），电脑、手机或平板（横屏） |
| 网络 | 首次进入游戏时，每位玩家要从开服的电脑下载几十 MB 素材（之后走浏览器缓存）；对局中流量很小 |

显卡较弱时可以在「设置」里调低画质，或在网址后加 `?board=2d`（强制 2D 棋盘）/ `?render=fallback`（不用 WebGL 的简化画面）。

### 端口与配置

上游默认监听 **TCP 3000**；本仓库的启动脚本用 **4040**（两份安装可以同时跑，互不干扰）。换端口：设置环境变量 `PORT`，或 `node server/index.js` 前先 `set "PORT=xxxx"`。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口（本仓库的启动脚本设为 `4040`） |
| `HOST` | `::` | 监听地址。默认 `::` 是双栈：同一端口同时接受 IPv6 与 IPv4；`0.0.0.0` = 只 IPv4；`127.0.0.1` = 只允许本机 |
| `SP_COMBAT` | `client` | `client`：各玩家浏览器模拟自己的战斗（服务器负载极低）；`server`：由服务器模拟并推流 |
| `SP_VERIFY` | `off` | 服务器复算客户端上报的战斗结果：`off` / `sample`（约 1/8 抽查）/ `all` |
| `TRUST_PROXY` | `auto` | 是否信任 `X-Forwarded-For` 等转发头：`auto` 只信任来自本机 / 内网的代理 |
| `SP_SERVER_SETTINGS_DIR` | `runtime` | 服务器自身设置的存放目录（AI 上限、素材准入等） |
| `DEBUG` | 空 | 设为任意值输出详细日志 |
| `SP_NO_BROWSER` | 空 | 设为 `1` 时启动脚本不自动打开浏览器 |

**回合扣血上限开关**（本仓库新增）：默认开启（一回合最多扣 10 点血）。

```bash
node tools/battle-royale.mjs status          # 查看当前规则与开关
node tools/battle-royale.mjs lp-cap off      # 关闭：扣血无限制（漏多少扣多少）
node tools/battle-royale.mjs lp-cap on       # 开启：一回合最多扣 10 点
```

开关写在 `runtime/battle-royale.json`，运行中的服务器约 1 秒内生效，无需重启。

设置方式：macOS / Linux `PORT=8080 npm start`；PowerShell `$env:PORT=8080; npm start`；cmd `set "PORT=8080" && npm start`。健康检查：`GET /healthz`。

### 局域网联机

| 方式 | 怎么做 | 适合 |
|---|---|---|
| **同一局域网直连** | 把启动窗口里的局域网地址发给朋友 | 同一个家、宿舍或网吧 |
| **组网工具（虚拟局域网）** | Tailscale、ZeroTier、EasyTier 等：双方加入同一网络，朋友访问 `http://<虚拟 IP>:4040` | 固定在几个熟人之间，不暴露到公网 |
| **内网穿透 / 隧道** | 只有开服的人运行客户端，例如 `cloudflared tunnel --url http://localhost:4040`（临时地址，每次启动都会变） | 不想改路由器、没有公网 IP |
| **云服务器 / VPS** | 用仓库自带 `Dockerfile` 部署，前面加 Caddy / Nginx 与 HTTPS | 想长期开服、玩家分布在不同地区 |

- 游戏是**单个常驻 Node.js 进程 + WebSocket**（路径 `/ws`），只能跑一个实例，必须部署在域名根路径；Serverless 平台与静态托管不适用，反向代理要转发 WebSocket 升级。
- 游戏没有账号系统，**知道地址的人都能进来**。请只把地址发给朋友，不要公开发布，也不要搭建公开大厅 —— 这同时能降低素材版权方面的风险。

### 升级与更新包

拿到只含改动文件的**更新包**（`Stronghold-Protocol-v<版本>-update.zip`）时：

1. **先停服**（更新包不会自己停服：它只是文件，没有任何守护进程）—— 关掉启动窗口，或双击包内 `先停服再解压.bat`；
2. 把更新包里的文件夹内容**解压覆盖**到安装目录（Windows 资源管理器复制粘贴；macOS 请用 `unzip -o`，不要用访达拖放）；
3. 重新启动。启动时会先核对 `MANIFEST.json` 里的全部程序文件、删除新版本不再用的旧文件，再正常开服；如果这份安装不是对应的版本，服务器会**拒绝启动**并提示下载完整包，以免两个版本混跑。

详见包内 `冷更新说明.md`。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/PLAYING.md](docs/PLAYING.md) | 玩法指南（中文）：一局的流程、经济、招募、盟约、装备、最终攻势等 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 部署、更新包、开机自启、素材与目录说明 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 代码结构与模块地图 |
| [README-upstream.md](README-upstream.md) | 上游项目的 README 原文（本仓库的所有上游说明） |
| [MODIFICATIONS.md](MODIFICATIONS.md) | 本仓库相对上游的改动声明 |
| [NOTICE.md](NOTICE.md) | 版权与使用声明（含本仓库的补充说明） |

## 开发与测试

```bash
npm run dev                 # node --watch：改动服务器代码后自动重启
node --test                 # 单元 + 集成测试（缺少素材 / 浏览器的用例会自动跳过）
node tools/matchrun.mjs --mode coop --difficulty NORMAL --players 4 --humans 2 --seed 7   # 跑一局无头对局看数值
```

无头跑一局很有用：它会打印每回合的 LP、商店等级、击杀 / 漏怪、以及 `match errors / sim errors` 计数 —— 改本仓库的出怪骰子、怪物倍率、首领战之后，用它验证最省事。

## 项目结构

| 目录 | 内容 |
|---|---|
| `server/` | Node.js 服务器：大厅、对局流程、经济、浏览器战斗的校验（`server/match/battleRoyaleRules.js` 是本仓库的规则开关） |
| `shared/` | 前后端共用的常量与网络协议 |
| `public/` | 浏览器客户端（原生 ES 模块，PixiJS + pixi-spine、three.js 3D 棋盘、Preact + htm UI） |
| `data/` | 由官方数据表生成的游戏数据与素材清单（本仓库的改动都在这里，含怪物倍率与回合表） |
| `tools/` | `setup.mjs` / `doctor.mjs`、素材下载、数据构建、以及本仓库的 `battle-royale.mjs` 规则开关 |
| `scripts/` | 启动脚本（Windows / macOS / Linux）、Windows 开机自启 |
| `docs/` | 文档与调研 |
| `启动服务器-4040.bat` / `启动卫戍协议：盟约 · 大逃杀.bat` | 本仓库的启动脚本：设好 4040 端口、自动清理 4040 端口的占用、菜单式切换规则开关 |

## 许可证

- **代码**：本项目自己编写的代码以 **GPL-3.0-or-later** 发布，全文见 [LICENSE](LICENSE)；另附一条 GPL 第 7 条的附加许可，允许与 pixi-spine 中的 Spine Runtimes 组合分发（见 [NOTICE.md](NOTICE.md)）。本仓库的修改同样以 GPL-3.0-or-later 发布。
- **游戏素材不在许可范围内**：《明日方舟》相关的美术、音乐、音效、文本与数据等版权归原权利人所有，不适用 GPL；使用限制见上方[声明](#声明)与 [NOTICE.md](NOTICE.md)。
- **第三方组件**各自遵循其许可证：通过 npm 安装的库、`tools/local-extract/aklz4.py` 的算法（BSD-3-Clause）、字体等，清单见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 致谢与数据来源

- 本仓库的修改与维护：**[CherryBlossomBlizzard](https://github.com/CherryBlossomBlizzard)**。
- 上游项目之一：**原作者 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)** —— 官方规则的实现与整个项目基础。
- 上游项目之二：**「20 人版」分支 [龙千尘 (LongQianChen)/Stronghold-Protocol · `feat/IncreasePlayerCapacity`](https://github.com/LongQianChen/Stronghold-Protocol/tree/feat/IncreasePlayerCapacity)** —— 20 人房、分组卡池、网络优化、素材预缓存、公告、大厅发现、房间管理等。感谢两位作者。
- 游戏数据：[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)。
- 素材来源：[yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)、[fexli/ArknightsResource](https://github.com/fexli/ArknightsResource)、[isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models)、[ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2)；字体来自 [TimWangZi/The-font-of-Arknights](https://github.com/TimWangZi/The-font-of-Arknights) 与 Google Fonts（Noto Sans SC）。
- 规则核对参考：[PRTS 明日方舟中文 Wiki](https://prts.wiki/)。
- 库：[PixiJS](https://pixijs.com/)（MIT）、[pixi-spine](https://github.com/pixijs/spine)（MIT；其中的 Spine Runtime 另受 [Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license) 约束）、[three.js](https://threejs.org/)（MIT）、[Preact](https://preactjs.com/) + [htm](https://github.com/developit/htm)（MIT）、[ws](https://github.com/websockets/ws)（MIT）。

感谢以上项目的作者与维护者，以及鹰角网络带来的这款游戏。

## 贡献

- 如果改动涉及上游的规则实现，请优先向上游项目提 Issue / PR；只属于本仓库的改动（出怪骰子、倍率曲线、首领战、规则开关等）在这里提。
- 提交的代码将以 GPL-3.0-or-later 发布。
- 请不要提交任何游戏素材文件（`public/assets/` 等目录已被 `.gitignore` 排除）。
- 本项目坚持非商业：请不要提交广告、付费、打赏等任何形式的变现功能。

## English

**Battle Royale Stronghold Protocol (third-party modification).** This repository is a modified fork of
[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) (v0.2.6), a browser remake of the
Arknights seasonal auto-chess + tower-defense mode 「卫戍协议：盟约」, with the 20-player room support taken from
[LongQianChen/Stronghold-Protocol](https://github.com/LongQianChen/Stronghold-Protocol) (`feat/IncreasePlayerCapacity`).

What it changes: everyone starts with **30 LP**; the per-round LP loss cap (10) has an on/off switch; the operator
pool and the equipment pool are **unlimited** (roll odds unchanged, only the caps are scaled up); **no joint defence**
(leaks damage you directly); **wave enemies are rolled from the whole enemy table with a dice** (rounds 1–8 draw only
"medium and below"); enemy HP is **×4 per round from round 15 on**; **round 20 is a forced boss fight** with a fixed
**1,000,000,000 HP** leader and a **2-minute limit**; a **blood-for-money button** trades 3 LP for 1 gold (fatal at
exactly 3 LP); port **4040** (isolated from a 3000 install), and the launcher clears any process holding 4040 (never 3000).

**Disclaimer:** unofficial, non-commercial fan work — not affiliated with or endorsed by the upstream authors,
Hypergryph or Yostar. All Arknights names, art, models, audio, text and data are © their respective owners and are
**not** covered by this project's GPL-3.0 licence; the full release bundle ships those assets only for the
convenience of running the server — do not reuse them elsewhere or redistribute them separately. No monetisation of
any kind. Content will be removed on request of the rights holders. Provided "as is", without warranty.
The project's own code (including this fork's changes) is GPL-3.0-or-later — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
