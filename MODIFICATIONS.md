# 本分发包的改动声明 · Notice of modification（GPL-3.0 第 5 条）

本项目（**卫戍协议：盟约 · Stronghold Protocol**，网页联机复刻）的两代上游：

1. 原作者仓库 **sganggs/Stronghold-Protocol**（<https://github.com/sganggs/Stronghold-Protocol>，本仓库基于 **v0.3.1**）——
   官方规则的实现与整个项目基础（插件系统、公告、素材缓存、服务器设置、测试模式等）；
2. **龙千尘 (LongQianChen) 的「20 人版」分支 `feat/IncreasePlayerCapacity`**
   （<https://github.com/LongQianChen/Stronghold-Protocol/tree/feat/IncreasePlayerCapacity>）——
   最大 20 人房（4 / 8 / 10 / 16 / 20 席位）、玩家分组与分组卡池、紧凑 WebSocket 协议与网络优化等。

本仓库（「卫戍协议：盟约 · 大逃杀」）在两者之上**改一局的节奏与难度曲线**，其余行为保持上游原样。

## 双规则模式：官方原版与大逃杀并存，房主选择

同一台服务器上两种规则**同时存在**，开房的房主在房间设置里选「规则模式」：

* **大逃杀**（默认）：下面的全部改动生效 —— 掷骰子出怪、五亿血首领战 R20、固定 30 血、无限卡池/装备、无联防……、
  扣血加钱、炎盟约 13 层后炎佑吃层数增益。
* **官方原版**：这一局完全按上游 v0.3.1 的官方规则 —— R14 最终攻势 + R15 隐秘核心、首领按血点缩放、按策略 22-45 浮动血量、
  官方出怪表、官方卡池库存、联防回归；**本服的玩法一概关闭**（扣血加钱入口不给、炎佑不吃层数增益、关卡与怪物倍率走官方表）。
  同盟等待室的「交流」（官方表情）与大厅的「搜寻队友」不属于玩法规则，两种模式下都可用（皮肤等外观插件同理）。

切换是**房内设置**（`room.setRulesVariant`，房主操作，开局前可改，切换会让其他真人的准备失效）；
对局创建时变体随房间进入 `Match`（`opts.rulesVariant`）→ `GameData` 的第三参，整局固定。
实现：`server/match/battleRoyaleRules.js` 的 `OFFICIAL_RULES`（官方变体规则集）与 `GameData` 的 per-instance `this.RULES`；
皮肤等外观插件不受规则模式影响，两种模式下都能用。

**两个模式互不影响的支撑点（改动这些地方时要一起检查）**：
1. 凡是读规则的地方都走**每局实例**的 `gd.RULES` / `this.RULES`，**没有任何一处读模块级的 `RULES` 常量**
   （`battleRoyaleRules.js` 导出的那个只是测试/工具与「没有 gd」时的兜底）。
2. 战斗模拟（浏览器与服务端共用）只认 `battle.flags`：`bossHitLimit` / `timesHpBonus` / `yanyouLayerBonusFrom`
   都是 `GameData.battleFlags` 按变体下发，官方变体不下发 → 模拟端自然走官方行为。
3. 每个 fork 专属机制在 `OFFICIAL_RULES` 里都要显式关掉；关掉的方式是「阈值置 0」而不是「猜 key 不存在」——
   `bloodMoneyCost: 0` 即未启用、`yanyouLayerBonusFrom: 0` 即不吃层数、`rollWaveFrom: 0` 即不掷骰子。
4. 客户端按 `room.state.rulesVariant` 决定是否显示本服专属的入口（例如休整期顶栏的「扣血加钱」）。
5. `test/match/rules-variant.test.js` 把上述链条端到端钉住：变体 → `battleFlags` → 战斗模拟，以及 `g.bloodMoney`
   在两个变体下的接受/拒绝。

**本项目是上述两代上游的修改版，由 [CherryBlossomBlizzard](https://github.com/CherryBlossomBlizzard) 维护并分发，本次修改日期 2026-11-04。**
它不是上游发布的版本，也未获上游作者或《明日方舟》权利人的授权或认可。

## 本仓库相对上游 v0.3.1 的改动

规则集中在 `server/match/battleRoyaleRules.js` 的 `RULES`，全部可在代码里核对：

1. **第 1–13 回合完全按官方规则出怪**（派系 / 回合表 / 波次模板 / 数值表全部原样，不做任何改动）。
2. **第 14 回合起出怪掷骰子**：每一波从 `data/enemies.json` 的**全部怪物**里随机抽（召唤物、亡语产物、频次器物本体、
   领袖本体、本局禁用敌人除外；飞行与地面分开抽，保证能放进对应路线）。
   怪物血量在上一回合数值的基础上**每回合翻一倍**（复合，`hpDoubleFrom = 14`、`hpDoubleMul = 2`）；
   攻击仍按前 13 回合的等比（`atkGrowth = 1.048809`）继续。
3. **首领战关闭官方「限伤」**（`bossHitLimit: false`）：官方规则里单次伤害 `ceil(伤害) ≥ 300000` 会被**整个抵消**
   （不是削减，是变成 0），在五亿血的首领身上等于谁都打不动。本服关掉这一条，伤害按实际值结算，
   仍然照常经过护甲 / 减伤 / 护盾（`server/sim/damage.js` 的 `leaderHitCancelled`）。
4. **次数怪（频次器物）不再吃回合血量加成**（`timesHpBonus: false`）：这类怪的「生命值」就是它需要的伤害次数
   （青铜镜 30 点 = 需要 30 次伤害），按回合血量倍率放大后（第 14 回合起每回合 ×2）会变成几百上千次、后期基本打不掉。
   现在它们的次数固定用数据原值；**攻击倍率照常生效**，补给线系效果的那一份仍照官方口径扣掉
   （`server/sim/content/enemies/archetypes.js` 的 `times`），亡语产物（例如 身观 掉落的青铜镜）同样不吃血量加成。
5. **boss 类只在第 20 回合出现**（`bossDropFrom: 14`）：第 14–19 回合的普通波次不再出现首领本体
   （骰子候选池去掉所有 `rank = BOSS` 的敌人，官方模板里 literal 写的首领也跳过）；首领只在第 20 回合的首领战登场。
6. **亡语 / 召唤产物不再直接刷进怪海**（`server/match/waves.js` 的 `spawnProducts`）：只在召唤者被击杀时出现；
   第 14 回合起**次数怪（频次器物）本体**也不再直接进波次（`timesDropFrom: 14`），只保留亡语形态。
7. **整体降低飞行怪频率**（`flySpawnChance: 0.5`）：第 14 回合起只有一半的飞行槽位真的刷飞行怪，
   其余那次刷新会被直接跳过（不刷、不预告），所以飞行怪总量明显下降。第 1–13 回合仍按官方出怪，不读这个开关。
8. **第 20 回合强制首领战**（`bossRound: 20`）：进入「最终攻势」，领袖血量固定 **五亿（500,000,000）**、
   **限时 2 分钟**，战斗结束（打死领袖，或时间到）即**结束这一把**，不再进入隐秘核心（`noHiddenCore`，
   `GameData.hiddenRound` 恒为 `null`）。
9. **20 人房**：沿用龙千尘分支的容量规则（`shared/playerCapacity.js`：4 / 8 / 10 / 16 / 20 席位、固定分组表、
   五人组 III 阶取整、按组数扩展联防）。
10. **血量上限统一 30**（`startLp: 30`，`server/match/gamedata.js` 的 `startLp()` 对所有策略返回 30，
    不按 bands.json 的 totalHp 22–45 浮动）；卡池角色无限张、装备无限量供应；删除联防环节（漏怪直接扣血）；
   回合数没有上限（第 20 回合首领战后收尾）。
11. **炎盟约 13 层后炎佑吃炎层数增益**（`yanyouLayerBonusFrom: 13`）：炎的层数达到 13 层后，**炎佑也吃到玩家的炎层数
    攻击力增益** —— 与成员同一条公式（`base_atk + atk_per_stack·L`，直接乘算，`server/sim/content/bonds/core.js`
    `yanyouLayerBonus`），随层数实时刷新。炎佑登场时（battleStart）补一次，之后每次层数变化（`onLayers`）刷新；层数
    低于阈值时移除该增益。官方原版变体（`OFFICIAL_RULES.yanyouLayerBonusFrom: 0`）不吃层数，保持上游行为。
    [ASSUMED] 增益只作用于攻击力（层的公式本来只有 `atk_per_stack`）；「13 层后」= 层数 ≥ 13 生效。
12. **扣血加钱（`g.bloodMoney`，休整期顶栏）**：花 3 点目标生命值换 1 资金；低于 3 滴不能用；**刚好 3 滴可以用，用完之后
    目标生命值归零、当场淘汰**。这是本服玩法，**只在大逃杀变体启用**（`bloodMoneyCost: 3`）；官方原版把它置 0
    （`OFFICIAL_RULES.bloodMoneyCost: 0`），服务端 `MatchPrep.bloodMoney` 直接回 `WRONG_PHASE`，客户端也按
    `room.state.rulesVariant` 不显示这个按钮 —— 两个模式互不影响。

### 本服新增的社交与外观功能（官方 盟约 有、上游 0.3.1 网页版未复刻的部分）

- **同盟等待室的交流**（`room.emote` / `m.roomEmote`，research 06 §9.1 / §0 fact 16 "Communication is emotes only"）：
  官方 盟约 没有文字聊天，房间内与对局内都用官方表情。房间界面加了和战斗内同一套表情轮盘（`public/js/ui/emotes.js`
  `EmoteWheel`，36 个官方表情、chatCD 1 秒限频、气泡显示 chatTime 3 秒），发一个表情服务端按官方 chatCD 限频并向
  房间广播 `m.roomEmote { playerId, id }`，每位博士头像上弹气泡。观战席只能看不能发（`SPECTATOR`，与对局内一致）。
- **搜寻队友**（`room.search` / `room.searchCancel` / `m.search`，官方 联合模拟 matchmaking，research 06 §3.3）：大厅
  加了官方的匹配入口 —— **精确搜寻**（"更容易搜寻到实力相近的队友"）与**快速搜寻**（"更快速地搜寻队友"），按
  难度 + 房间容量（`ROOM_CAPACITIES` 4/8/10/16/20）分组排队（`server/lobby.js` searchQueue），组内凑满 capacity 个
  真人立即组建同盟（首位为房主），凑不满则超时由 AI 队友补位开局（research 06 §3.3 [ASSUMED] "fill with bots"）。
  本复刻没有官方的奖杯数据，[ASSUMED] 两种搜寻的区别只在等待时长：快速搜寻 `MATCH_FAST_FILL_MS`（15 秒）后补位，
  精确搜寻等满官方 `matchTimeMax`（`MATCH_TIMEOUT_MS` 120 秒）。搜寻中可 `room.searchCancel` 退出；建房 / 加入房间 /
  掉线 / 会话过期都会自动出队；服务端每 `MATCH_POLL_MS`（1 秒）清空队列（仅队列非空时开定时器）。
- **皮肤部署后的战斗小人**：皮肤系统的战斗内 Spine 模型链路（`Unit.skin` → `snapshot.js` → `render/units.js`
  `_modelEntry` → `assets.js` `spineEntry(id, { skin })`）上游已具备，`docs/SKINS.md` 为准绳；本次修复的是 dist 分支
  `official-skins.zip` 皮肤包数据 —— 上一版 zip 里 Spine 文件缺扩展名（`_skel` / `_atlas`）与 `plugin.json` 的引用
  （`.skel` / `.atlas`）对不上、且缺 `plugin.lock.json` 动画数据，导致皮肤只换立绘、部署后战斗里的角色小人仍是原版
  模型。重打包后 64 套皮肤里 62 套带战斗内动态模型（`char_1020_reed2_summer#17` / `char_4058_pepe_sightseer#2` 两套
  骨骼解析失败，暂回退立绘），玩家在设置里开启皮肤插件、干员调配里选皮肤后，战斗中该干员的角色小人即按所选皮肤展示。

### 配套修复（这些偏离会牵动上游的两处假设，已一并修好）

- **首领的「部件」不再被当成普通精英刷进怪海**（`server/match/waves.js` 的 `monsterPools`）：
  `data/bosses.json` 的 `parts`（「破胄之锤」`enemy_9015_acstmb`、「破胄之剑」「御4」…）`rank` 是 `ELITE`
  而不是 `BOSS`，只按 `rank === 'BOSS'` 排除会漏掉它们。第 14 回合起的骰子一度会把它们当普通精英刷出来，
  而战斗模拟本身把它们标成「不计入」，导致**诚实的**客户端结果被服务端判成伪造（`uncounted leak`）。
  现在它们与领袖本体一起被排除，只在首领战里作为首领的一部分出现。
- **客户端结果校验的 `maxTotal` 随本服倍率放宽**（`server/match/fields.js` 的 `specBounds`）：
  `maxTotal` 是「这一场最多可能出现多少个敌人」的经验上界，官方按 `spawnCount × 4 + 100` 估算。
  五亿血的首领战与「第 14 回合起每回合血量翻倍」都会让战斗时长暴涨，同一批敌人的召唤 / 分裂产物自然比官方多
  （实测首领战 169 次击杀 / 官方上界 164；R19 普通场 301 / 272）。不改的话**诚实的**客户端结果会被判成
  `counts` 伪造并触发服务端重算。现在首领战给固定宽余量，普通 / 联防战场随回合数线性放大。

### 关于「寒霜会减速隐匿状态下的干员」——不是 bug

PRTS《作战机制》§隐匿与Buff的关系明确写着：「目前明日方舟中使用能选中隐匿状态单位的 Buff 效果一定是无视隐匿状态
起作用的」，并直接举了官方的例子 **「敌方寒霜的攻速下降Debuff」**。所以寒霜（`enemy_1042_frostd`）的光环会照常
作用于隐匿 / 迷彩状态下的干员，这是**官方机制**，本仓库保持官方实现（`server/sim/content/enemies/archetypes.js`
的 `allyAura`、`server/sim/targeting.js` 的 `auraSelectable` 注释与测试都覆盖了这一点）。

### 运行

用 `node tools/battle-royale.mjs status` 查看当前规则；`lp-cap on|off` 切换「一回合最多扣 10 点血」的开关
（约 1 秒内对运行中的服务器生效，无需重启）。

## 许可证与素材

- 本包内由上游项目编写的代码与文档文字，按 **GNU 通用公共许可证第 3 版或任何更新版本**（GPL-3.0-or-later）授权，
  全文见同目录的 [LICENSE](LICENSE)；另含 NOTICE.md 中 GPL 第 7 条的 Spine Runtimes 组合分发附加许可。
- 本包**不含**任何游戏素材（无 `public/assets/**`、`public/fonts/**`、官方数据表导出的 `data/*.json`），
  因此也不涉及素材的再分发。《明日方舟》相关名称、美术、模型、音频、文本与数据的权利归上海鹰角网络科技有限公司
  及其授权方（Yostar 等）所有，**不属于 GPL 授权范围**，本项目无权就它们授予任何权利。
- 仅限**学习、研究和个人非商业**使用；**严禁任何形式的盈利**（售卖、付费分发、收费开服、广告、打赏、赞助、众筹，
  或打包进收费产品）。完整条款见同目录的 [NOTICE.md](NOTICE.md)。
- 修改版对应的**完整源码**：见发布这个包的仓库对应 tag 的源码归档（GitHub Release 页面的 “Source code”），
  或仓库根目录的源码树。
- 按「原样」提供，不附带任何明示或暗示的担保。权利人如认为有不妥之处，请通过 Issue 联系，我们会立即删除。
