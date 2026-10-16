// server/match/battleRoyaleRules.js — 卫戍协议：盟约 · 大逃杀：本服与上游 0.2.6 不同的规则集中在这里。
//
// 一局游戏的样子（本服定制）：
//   * 血量上限 30；一回合扣血上限（10 点）可用开关控制，关掉即扣血无限制（runtime/battle-royale.json）；
//   * 卡池角色无限张（保留上游按剩余份数加权的概率，只放大上限）；装备无限量供应，没有共享库存上限；
//   * 没有联防：漏怪直接扣血；
//   * 每 3 滴血换 1 块钱的「扣血加钱」按钮（刚好 3 滴可以用，用完当场淘汰）；
//   * 出怪掷骰子：每一波的敌人从「全部怪物」里随机抽（不再按官方的派系/波次表）；
//   * 第 1–13 回合按官方表；第 14 回合按前 13 回合的比例；第 15 回合起血量在上一回合基础上再翻 4 倍；
//   * 第 20 回合强制进入首领战（最终攻势）：领袖血量固定 10 亿、限时 2 分钟，战斗结束即结束这一把；
//   * 禁用阵营机制保留（上游原值）。
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
  /** 无限回合的倍率基准：最后一个「正常」回合（数据里的官方表到第 13 回合）。 */
  normalRoundMax: 13,
  /** 第 1–13 回合的每回合等比（官方绝境表），第 14 回合沿用。 */
  hpGrowth: 1.095445,
  atkGrowth: 1.048809,
  /** 从第 14 回合起：怪物血量在上一回合数值的基础上翻倍（复合）。 */
  hpDoubleFrom: 14, hpDoubleMul: 2,
  /** 无限回合下休整期 / 作战时限的每回合增量与上限（真实秒）。 */
  prepTimeStep: 10, prepTimeCap: 300,
  combatTimeStep: 10, combatTimeCap: 240,
  /** 数据里续写到第几回合（超出由代码兜底）。 */
  generatedRounds: 40,
  /** 首领战：强制进入的回合、固定血量（十亿）、限时（真实秒，到点就结束这一把）。 */
  bossRound: 20, bossHp: 1_000_000_000, bossTimeLimitSec: 120,
  /** 骰子出怪：每一波从「全部怪物」里随机抽。 */
  rollWaves: true,
  /** 无限回合：一局一直进行到没人存活（配合第 20 回合的强制首领战，实际在首领战后收尾）。 */
  endless: true,
  /**
   * 出怪：**第 1–13 回合完全按官方规则**（派系 / 回合表原样），第 `rollWaveFrom` 回合起才掷骰子，且**所有怪物**都可能出现
   * （`rollWaveEarlyRounds: 0` = 不设低难度门槛；这两个分位保留给需要分档时用）。
   */
  rollWaveFrom: 14, rollWaveEarlyRounds: 0, rollWaveLowShare: 0.4, rollWaveMidShare: 0.7,
  /** 扣血加钱：花费多少血、换多少钱。 */
  bloodMoneyCost: 3, bloodMoneyGain: 1,
  /** 卡池：每名干员的上限放大倍数（概率不变，只把上限加大）。 */
  infinitePool: true, poolCapMultiplier: 100,
  /** 装备：删除共享库存上限，无限量供应。 */
  infiniteItems: true,
  /** 删除联防：漏怪直接扣血。 */
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
