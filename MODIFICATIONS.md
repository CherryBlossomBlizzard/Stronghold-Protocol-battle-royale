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

* **大逃杀**（默认）：下面的全部改动生效 —— 掷骰子出怪、五亿血首领战 R20、固定 30 血、无限卡池/装备、无联防……、扣血加钱。
* **官方原版**：这一局完全按上游 v0.3.1 的官方规则 —— R14 最终攻势 + R15 隐秘核心、首领按血点缩放、按策略 22-45 浮动血量、
  官方出怪表、官方卡池库存、联防回归；**本服的玩法一概关闭**（扣血加钱入口不给、关卡与怪物倍率走官方表）。
  同盟等待室的「交流」（官方表情）与大厅的「搜寻队友」不属于玩法规则，两种模式下都可用（皮肤等外观插件同理）。

切换是**房内设置**（`room.setRulesVariant`，房主操作，开局前可改，切换会让其他真人的准备失效）；
对局创建时变体随房间进入 `Match`（`opts.rulesVariant`）→ `GameData` 的第三参，整局固定。
实现：`server/match/battleRoyaleRules.js` 的 `OFFICIAL_RULES`（官方变体规则集）与 `GameData` 的 per-instance `this.RULES`；
皮肤等外观插件不受规则模式影响，两种模式下都能用。

**两个模式互不影响的支撑点（改动这些地方时要一起检查）**：
1. 凡是读规则的地方都走**每局实例**的 `gd.RULES` / `this.RULES`，**没有任何一处读模块级的 `RULES` 常量**
   （`battleRoyaleRules.js` 导出的那个只是测试/工具与「没有 gd」时的兜底）。
2. 战斗模拟（浏览器与服务端共用）只认 `battle.flags`：`bossHitLimit` / `timesHpBonus`
   都是 `GameData.battleFlags` 按变体下发，官方变体不下发 → 模拟端自然走官方行为。
3. 每个 fork 专属机制在 `OFFICIAL_RULES` 里都要显式关掉；关掉的方式是「阈值置 0」而不是「猜 key 不存在」——
   `bloodMoneyCost: 0` 即未启用、`rollWaveFrom: 0` 即不掷骰子。
4. 客户端按 `room.state.rulesVariant` 决定是否显示本服专属的入口（例如休整期顶栏的「扣血加钱」）。
5. `test/match/rules-variant.test.js` 把上述链条端到端钉住：变体 → `battleFlags` → 战斗模拟，以及 `g.bloodMoney`
   在两个变体下的接受/拒绝、炎佑在两个变体下都不进怪海也不吃层数。
6. **我方专属单位绝不进怪海**：`enemy_9012_acloon`（炎佑）的数据记录 `tokenOnly: false`，所以每个「从全部怪物里抽」的
   地方都要显式排除它（`server/match/waves.js` 的 `monsterPools` 与模板抽卡都排除）。它在复刻里只由 `spawnYanyou`
   作为我方召唤单位出现，也**不吃**炎的层数增益（上游行为）；层数只作用于炎干员本身。

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
   五人组 III 阶取整、按组数扩展联防）。**新开同盟房默认就是 20 人**（`DEFAULT_SEATS = MAX_SEATS`，维护者要求）；
   房主在等待室底部的「房间容量」里可改小（4/8/10/16/20）。20 人房是 5 行 × 4 列，座位区自己滚动、卡片自动收紧
   一档（`.seats--many`），不会把底部设置栏顶出屏幕。
10. **血量上限统一 30**（`startLp: 30`，`server/match/gamedata.js` 的 `startLp()` 对所有策略返回 30，
    不按 bands.json 的 totalHp 22–45 浮动）；**干员卡池与装备都无限量**（见下）；
    删除联防环节（漏怪直接扣血，`noUnite: true` → `server/match/match/combat.js` 直接结算扣血）；回合数没有上限
    （`endless: true`，第 20 回合首领战后收尾）。
    * **干员卡池无限张**（`infinitePool: true`、`poolCapMultiplier: 100`）：`SharedPool` 把**每张**的库存放大 100 倍
      （官方 tier 库存 12/14/18/16/8/5 × 2 人以上 co-op ×2 → 大逃杀再 ×100，实测一张 24 → 2400），抽卡仍按上游的
      剩余份数加权，只是几乎抽不空。官方变体（`infinitePool: false`）回到官方库存。
    * **装备无限量供应**（`infiniteItems: true`）：`SharedItemPool.cap()` 返回 `null` = **没有共享库存上限**
      （`left` 为 Infinity、`canGain` 恒真、「牌已售罄」不再出现、没发到手的欠账也不再记）；与干员侧的「放大库存」
      不同，装备这边是**直接取消上限**。官方变体（`infiniteItems: false`）按 data/config.json 的
      `economy.itemPoolCopies`（tier 1–6 各 4/6/7/8/7/3）保持官方共享库存。
      注意：**每回合购买/奖励张数**（`storeCntMax`、`maxArtsPerRound`、整备区容量）仍按官方，取消的只是「共享库存」。
11. **炎佑（`enemy_9012_acloon`）不参与大逃杀的骰子出怪**（`server/match/waves.js` 的 `monsterPools`）：
    它在复刻里**只**是我方盟约的召唤单位（`spawnYanyou`），官方回合表一直是跳过它的
    （`pickRoundEntry` / `templateSpawns` 都排除），但它的数据记录 `tokenOnly: false`，第 14 回合起「从全部怪物里抽」
    的骰子若不多排一次，就会把它当普通精英飞行怪刷进怪海 —— 那会带来「敌方炎佑」这种不存在的单位，还会让它带上
    我方的身份与增益。现在骰子池与模板一样显式跳过它（`docs/history/0.2.1.md`、`tools/build-data.mjs` 的
    「炎佑 is never an enemy」断言由此成立）。炎佑也**不吃**炎的层数增益（上游行为）：层数只作用于炎干员本身。
12. **扣血加钱（`g.bloodMoney`，休整期顶栏）**：花 3 点目标生命值换 1 资金；低于 3 滴不能用；**刚好 3 滴可以用，用完之后
    目标生命值归零、当场淘汰**。这是本服玩法，**只在大逃杀变体启用**（`bloodMoneyCost: 3`）；官方原版把它置 0
    （`OFFICIAL_RULES.bloodMoneyCost: 0`），服务端 `MatchPrep.bloodMoney` 直接回 `WRONG_PHASE`，客户端也按
    `room.state.rulesVariant` 不显示这个按钮 —— 两个模式互不影响。

### 本服新增的社交与外观功能（官方 盟约 有、上游 0.3.1 网页版未复刻的部分）

- **同盟等待室的交流**（`room.emote` / `m.roomEmote`，research 06 §9.1 / §0 fact 16 "Communication is emotes only"）：
  官方 盟约 没有文字聊天，房间内与对局内都用官方表情。房间界面加了和战斗内同一套表情轮盘（`public/js/ui/emotes.js`
  `EmoteWheel`，36 个官方表情、chatCD 1 秒限频、气泡显示 chatTime 3 秒），发一个表情服务端按官方 chatCD 限频并向
  房间广播 `m.roomEmote { playerId, id }`，每位博士头像上弹气泡。观战席只能看不能发（`SPECTATOR`，与对局内一致）。
- **加入同盟 / 搜寻队友（合并成一个模块）**（`room.list` / `m.rooms` + `room.search` / `room.searchCancel` / `m.search`）：
  大厅原先「按密钥加入」和「搜寻队友」是两块，现在合成「加入同盟」一个模块（`public/js/screens/lobby.js`
  `RoomDirectory` + `SearchPanel`）：
  * **服务器上的同盟房列表**（`room.list` → `m.rooms`）：大厅里每 2 秒问一次服务端，列出这台服务器上此刻的同盟房 ——
    密钥、房主名字、难度、`人数/容量`、AI 数、规则模式（大逃杀 / 官方原版）、测试房标记、是否在模拟中，**能加入的
    排前面**，每行一个「加入」按钮（一键 `room.join`）。密钥本来就是公开的邀请码，所以列表里直接给；满员 / 模拟中的
    行灰掉并显示「已满」「模拟中」，自己所在的那间显示「你在里面」。协议见 `docs/design/network.md` §8.1。
  * **按密钥加入**（保留）：输入框 / 粘贴邀请链接 / 最近同盟 / 观战。
  * **搜寻队友**（官方 联合模拟 matchmaking，research 06 §3.3）：**精确搜寻**（"更容易搜寻到实力相近的队友"）与
    **快速搜寻**（"更快速地搜寻队友"），按难度 + 房间容量（`ROOM_CAPACITIES` 4/8/10/16/20）分组排队（`server/lobby.js`
    searchQueue），组内凑满 capacity 个真人立即组建同盟（首位为房主），凑不满则超时由 AI 队友补位开局
    （research 06 §3.3 [ASSUMED] "fill with bots"）。本复刻没有官方的奖杯数据，[ASSUMED] 两种搜寻的区别只在等待时长：
    快速搜寻 `MATCH_FAST_FILL_MS`（15 秒）后补位，精确搜寻等满官方 `matchTimeMax`（`MATCH_TIMEOUT_MS` 120 秒）。
    搜寻中可 `room.searchCancel` 退出；建房 / 加入房间 / 掉线 / 会话过期都会自动出队；服务端每 `MATCH_POLL_MS`
    （1 秒）清空队列（仅队列非空时开定时器）。
- **皮肤部署后的战斗小人**：皮肤系统的战斗内 Spine 模型链路（`Unit.skin` → `snapshot.js` → `render/units.js`
  `_modelEntry` → `assets.js` `spineEntry(id, { skin })`）上游已具备，`docs/SKINS.md` 为准绳；本次修复的是 dist 分支
  `official-skins.zip` 皮肤包数据 —— 上一版 zip 里 Spine 文件缺扩展名（`_skel` / `_atlas`）与 `plugin.json` 的引用
  （`.skel` / `.atlas`）对不上、且缺 `plugin.lock.json` 动画数据，导致皮肤只换立绘、部署后战斗里的角色小人仍是原版
  模型。玩家在设置里开启皮肤插件、干员调配里选皮肤后，战斗中该干员的角色小人即按所选皮肤展示。
  **皮肤覆盖（0.2.0）**：皮肤分三类素材，全部从本机客户端提取：
  1. **战斗内动态模型**：`arts/dynchars` 共 **102 个**骨骼包 —— `extract-dynchars.py` 枚举整个目录（按
     `character_table.json` 的最长前缀算 charId，骨骼与 atlas 按同茎配对，茎名不一致但各只有一个时直接配对）。
  2. **商店时装立绘**：`spritepack/arts_shop_skin_portrait_*.ab`（16 个包）里的 Sprite 名字就是皮肤 id —— 这是
     【干员调配】皮肤格里该显示的图。`extract-skin-portraits.py` 提了 **447 套**。
  3. 名字：官方皮肤名在服务器 gamedata 的 `skin_table.json` 里（本机没有、也拉不到），所以用「**干员名 · 系列**」
     生成（`epoque`→时代、`summer`→夏日、`ambienceSynesthesia`→音律联觉…，`_2` → 精英二；没把握的系列保留原代码，
     不编名字），此前显示的是原始 id。
  三批插件（每套皮肤只出现在一个包里，skinId 不跨包重复）：
  * `official-skins`（80.4 MB）：64 套 —— 62 套带战斗内 Spine 模型 + 2 套仅立绘
    （`char_1020_reed2_summer#17` / `char_4058_pepe_sightseer#2` 的骨骼本身不是 Spine 3.8，回退立绘），全部带立绘。
  * `official-skins-part2`（43.0 MB）：36 套，全部带战斗内 Spine 模型（多为精英二外观）。
  * `official-skins-part3`（15.4 MB）：381 套，仅立绘（其余全部时装）。
  合计 **481 套皮肤**。三个骨骼包进不了包：`char_1001_amiya2_sale#16` / `char_1037_amiya3_sale#13`（本机
  `character_table` 里没有这两位干员，名字用「阿米娅」代）、`char_4058_pepe_2`（只有 atlas，没有骨骼）。
  安装侧：`启动服务器.bat`（以及 `安装皮肤包.bat` / `.sh`）以 **`plugin.lock.json` 是否存在 + `plugin.json` 的
  `version` 是否为 `0.2.0`** 作为「装的是不是新包」的判据（旧包缺 lock 或还是 0.1.0 → 删掉重下）。三批都会自动下载，
  并写一份 `plugins/config.json`（`default` 按实际装上的包拼）让**新房间默认就带皮肤包**，不再需要玩家自己去
  【设置】里找开关。策略文件 `plugins/config.json` 由 PowerShell 生成（字符串拼接会丢引号），读取侧也容忍 UTF-8 BOM。

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
