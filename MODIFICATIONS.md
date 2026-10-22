# 本分发包的改动声明 · Notice of modification（GPL-3.0 第 5 条）

本项目（**卫戍协议：盟约 · Stronghold Protocol**，网页联机复刻）的两代上游：

1. 原作者仓库 **sganggs/Stronghold-Protocol**（<https://github.com/sganggs/Stronghold-Protocol>，本仓库基于 **v0.3.1**）——
   官方规则的实现与整个项目基础（插件系统、公告、素材缓存、服务器设置、测试模式等）；
2. **龙千尘 (LongQianChen) 的「20 人版」分支 `feat/IncreasePlayerCapacity`**
   （<https://github.com/LongQianChen/Stronghold-Protocol/tree/feat/IncreasePlayerCapacity>）——
   最大 20 人房（4 / 8 / 10 / 16 / 20 席位）、玩家分组与分组卡池、紧凑 WebSocket 协议与网络优化等。

本仓库（「卫戍协议：盟约 · 大逃杀」）在两者之上**只改一局的节奏与难度曲线**，其余行为保持上游原样。

**本项目是上述两代上游的修改版，由 [CherryBlossomBlizzard](https://github.com/CherryBlossomBlizzard) 维护并分发，本次修改日期 2026-10-22。**
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
10. **血量上限统一 30**（`startLp: 30`）；卡池角色无限张、装备无限量供应；删除联防环节（漏怪直接扣血）；
   回合数没有上限（第 20 回合首领战后收尾）。

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
