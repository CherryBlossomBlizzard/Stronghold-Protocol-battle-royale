// server/match/battleRoyaleRules.js — 卫戍协议：盟约 · 大逃杀：本服与上游 0.3.1 不同的规则集中在这里。
//
// 一局游戏的样子（本服定制）：
//   * 血量上限 30；一回合扣血上限（`lpCapPerRound`，默认 10）可用开关控制，关掉即扣血无限制（runtime/battle-royale.json）；
//   * 卡池角色无限张（保留上游按剩余份数加权的概率，只放大上限）；装备无限量供应，没有共享库存上限；
//   * 出怪：**第 1–13 回合完全按官方规则**（派系 / 回合表 / 波次模板原样），第 `rollWaveFrom`（14）回合起每一波
//     从「全部怪物」里随机抽（骰子；地面与飞行分开抽，保证能放进对应路线）；
//   * 飞行怪频率：第 14 回合起只有 `flySpawnChance` 的飞行槽位真的刷飞行怪（整体降低飞行怪数量）；
//   * 怪物倍率：第 1–13 回合用官方表；第 14 回合起血量在**上一回合数值上再翻 `hpDoubleMul`（2）倍**（复合），
//     攻击仍按官方等比（`atkGrowth`）递增；
//   * 首领战关闭官方的「限伤」（单次 ≥ 30 万的伤害不再被整个抵消）；次数怪（频次器物）不吃回合血量加成；
//   * 亡语 / 召唤产物不进骰子池（只在召唤者被击杀时出现），第 14 回合起次数怪（频次器物）也不再直接进波次；
//   * boss 类只在第 `bossRound`（20）回合的首领战出现，第 14–19 回合的普通波次不出首领本体；
//   * 第 20 回合强制进入首领战（最终攻势）：领袖血量固定**五亿**、限时 2 分钟，战斗结束即结束这一把；
//   * 每 3 滴血换 1 块钱的「扣血加钱」按钮（刚好 3 滴可以用，用完当场淘汰）；
//   * 禁用阵营机制保留（数据里 bans / inactiveBondIds 是上游原值）。
//
// 开关用 `node tools/battle-royale.mjs lp-cap on|off` 或部署用的 .bat 菜单切换，约 1 秒内生效，无需重启。
// i18n-ignore-file: 服务端规则与运维日志，不是玩家界面文本

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../http/config.js';

export const RULES = Object.freeze({
  name: '卫戍协议：盟约 · 大逃杀',
  /** 所有玩家的目标生命值（血量上限）。 */
  startLp: 30,
  /** 无限回合：只要还有人存活就一直进行（数据里只写到第 20 回合，更远的回合由代码续写）。 */
  endless: true,
  /** 最后一个「官方」回合：第 1–13 回合按官方表出怪与数值，不做改动。 */
  normalRoundMax: 13,
  /** 第 1–13 回合的每回合等比（官方绝境表），第 14 回合之后的攻击沿用。 */
  hpGrowth: 1.095445,
  atkGrowth: 1.048809,
  /** 从第 14 回合起：怪物血量在上一回合数值的基础上翻 `hpDoubleMul` 倍（复合）。 */
  hpDoubleFrom: 14, hpDoubleMul: 2,
  /**
   * 限伤（官方 30 万）：本服**关闭**。第 20 回合的首领血量是固定的十亿，开着限伤的话任何单次伤害只要 ≥ 30 万就会被
   * 整个抵消（不是削减，是变成 0），首领基本打不动。关掉之后伤害按实际值结算，仍然照常经过护甲、减伤和护盾。
   */
  bossHitLimit: false,
  /**
   * 次数怪（频次器物）是否吃回合血量加成：本服**关闭** —— 这类怪的「生命值」就是它需要的伤害次数（青铜镜 30 点 = 30 次），
   * 按回合倍率放大就会变成几百上千次，第 14 回合以后基本打不掉，所以它们的次数固定用数据原值。
   */
  timesHpBonus: false,
  /**
   * 第 `timesDropFrom`（14）回合起，**次数怪（频次器物）不再直接出现在波次里**，只会以亡语形态（击杀后召唤 / 分裂出来的
   * 那种）出现 —— 即骰子的候选池里去掉它们，官方模板里被抽中的次数怪也跳过（见 waves.js）。
   */
  timesDropFrom: 14,
  /**
   * 第 `bossDropFrom`（14）回合起，**首领本体不再出现在普通波次里**：骰子候选池去掉所有 rank = BOSS 的敌人，
   * 官方模板里 literal 写的首领也跳过（首领只在第 `bossRound` 回合的首领战出现）。
   */
  bossDropFrom: 14,
  /** 无限回合下休整期 / 作战时限的每回合增量与上限（真实秒）。 */
  prepTimeStep: 10, prepTimeCap: 300,
  combatTimeStep: 10, combatTimeCap: 240,
  /** 数据里续写到第几回合（超出由代码兜底）。 */
  generatedRounds: 40,
  /** 首领战：强制进入的回合、固定血量（**五亿**）、限时（真实秒，到点就结束这一把）。 */
  bossRound: 20, bossHp: 500_000_000, bossTimeLimitSec: 120,
  /** 大逃杀没有隐秘核心：首领战结束就是这一把的结束（GameData.hiddenRound = null）。 */
  noHiddenCore: true,
  /**
   * 出怪：**第 1–13 回合完全按官方规则**（派系 / 回合表原样），第 `rollWaveFrom` 回合起才掷骰子，且**所有怪物**都可能
   * 出现（`rollWaveEarlyRounds: 0` = 不设低难度门槛；这两个分位保留给需要分档时用）。
   */
  rollWaveFrom: 14, rollWaveEarlyRounds: 0, rollWaveLowShare: 0.4, rollWaveMidShare: 0.7,
  /**
   * 飞行怪的出怪频率（0–1）：第 `rollWaveFrom` 回合起的骰子里，飞行槽位只有这个概率真的抽一只**飞行怪**；
   * 其余情况抽一只地面怪 —— 与槽位类别不符的那次刷新会被直接跳过（不刷、不预告），于是整体飞行怪变少。
   * 第 1–13 回合仍按官方出怪（不读这个开关）。
   */
  flySpawnChance: 0.5,
  /** 扣血加钱：花费多少血、换多少钱。 */
  bloodMoneyCost: 3, bloodMoneyGain: 1,
  /** 卡池：每名干员的上限放大倍数（概率不变，只把上限加大）。 */
  infinitePool: true, poolCapMultiplier: 100,
  /** 装备：删除共享库存上限，无限量供应。 */
  infiniteItems: true,
  /** 删除联防：漏怪直接扣血（本服默认不进行联防环节）。 */
  noUnite: true,
  /** 禁用阵营机制保留（数据里 bans / inactiveBondIds 是上游原值）。 */
  allBonds: true,
  /** 一回合扣血上限的默认值（开启时生效）。 */
  lpCapPerRound: 10,
});

export const RULES_FILE = 'battle-royale.json';
const MAX_FILE_BYTES = 4096;
const POLL_MS = 500;

/** <root>/runtime/battle-royale.json */
export function rulesFile(root = ROOT) { return path.join(root, 'runtime', RULES_FILE); }

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { lpCapEnabled: true };
  return { lpCapEnabled: raw.lpCapEnabled !== false };
}

/** 读取规则文件（不存在 / 损坏时返回默认：扣血上限开启）。 */
export function readRules(root = ROOT) {
  try {
    const file = rulesFile(root);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { lpCapEnabled: true };
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch { return { lpCapEnabled: true }; }
}

let cache = { lpCapEnabled: true };
let stamp = -1;
let checkedAt = 0;

/** 当前规则（按 mtime 节流读取，最多每 POLL_MS 检查一次），改开关约 1 秒内对运行中的服务器生效。 */
export function battleRoyalRules(now = Date.now(), root = ROOT) {
  if (now - checkedAt < POLL_MS) return cache;
  checkedAt = now;
  try {
    const stat = fs.statSync(rulesFile(root));
    if (stat.mtimeMs !== stamp) { stamp = stat.mtimeMs; cache = normalize(JSON.parse(fs.readFileSync(rulesFile(root), 'utf8'))); }
  } catch { /* 文件被删除：保留最近的有效规则 */ }
  return cache;
}

/** 扣血上限开关：true = 一回合最多扣 10 点血，false = 扣血无限制。 */
export function lpCapEnabled() { return battleRoyalRules().lpCapEnabled !== false; }

/** 写入开关（原子替换）。返回写入后的规则。 */
export function writeLpCap(enabled, root = ROOT) {
  const dir = path.join(root, 'runtime');
  fs.mkdirSync(dir, { recursive: true });
  const file = rulesFile(root);
  const tmp = path.join(dir, `.battle-royale-rules-${randomUUID()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, lpCapEnabled: !!enabled }, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  stamp = -1; checkedAt = 0;
  cache = { lpCapEnabled: !!enabled };
  return cache;
}
