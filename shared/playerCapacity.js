// shared/playerCapacity.js — 卫戍协议 · 20 人房：容量规则（服务端与浏览器共用）。
//
// 来自 龙千尘 (LongQianChen) 的 feat/IncreasePlayerCapacity 分支，重放到 0.3 的代码结构上。官方房最多 4 人；
// 这里把规模扩展到 MAX_SEATS（20），并规定「人多之后每档规则怎么变」：
//   * 抽卡池：1–6 人共享一个池（5/6 人时按人数放大副本数），7 人起按座位均分成若干组、每组不超过 4 人，
//     组内共享一个池（createPoolGroups / poolGroupSizes / poolCopyScale）；
//   * 策略 / 机变选牌：人数 + 2 张，至少 6 张，上限 MAX_DRAFT_CARDS；
//   * 联防：8 人起一局可以联防两轮；最多 4 名帮手；
//   * 隐秘核心解锁：基线层数按人数 / 4 等比放大。
// 四人及以下的规模与官方完全一致（这几条在 4 人时都退化成原值）。

import { BASE_SEATS, MAX_SEATS, MAX_DRAFT_CARDS } from './constants.js';

export const MIN_COOP_DRAFT_CARDS = 6;
export const DRAFT_SPARE_CARDS = 2;
/**
 * 固定分组表（维护者确认）：6 人起按座位依次切分。3/4 人的组保留完整官方池，只有 5 人的组放大副本数。
 * 每一项都是新数组，调用方改不动下一次对局。
 */
const POOL_GROUP_LAYOUTS = Object.freeze({
  6: Object.freeze([3, 3]),
  7: Object.freeze([4, 3]),
  8: Object.freeze([4, 4]),
  9: Object.freeze([4, 5]),
  10: Object.freeze([4, 3, 3]),
  11: Object.freeze([4, 4, 3]),
  12: Object.freeze([4, 4, 4]),
  13: Object.freeze([5, 4, 4]),
  14: Object.freeze([4, 4, 3, 3]),
  15: Object.freeze([4, 4, 4, 3]),
  16: Object.freeze([4, 4, 4, 4]),
  17: Object.freeze([5, 4, 4, 4]),
  18: Object.freeze([4, 4, 4, 3, 3]),
  19: Object.freeze([4, 4, 4, 4, 3]),
  20: Object.freeze([4, 4, 4, 4, 4]),
});
/** 6 人起分池（1–5 人仍是一个共享池，见 POOL_GROUP_LAYOUTS） */
export const GROUPED_POOL_MIN_PLAYERS = 6;
/** 联防一局最多几名帮手（每轮 2 名，跨轮不重复） */
export const MAX_UNITE_HELPERS = 4;

/** 这一轮选牌发几张：本局存活人数 + DRAFT_SPARE_CARDS，夹在 [MIN_COOP_DRAFT_CARDS, MAX_DRAFT_CARDS]。 */
export function coopDraftCardCount(players) {
  return Math.min(MAX_DRAFT_CARDS, Math.max(MIN_COOP_DRAFT_CARDS, Math.trunc(players || 0) + DRAFT_SPARE_CARDS));
}

/**
 * 按座位排序的分组人数：1–5 人共用一个池；6 人起使用固定的分组表（3/4/5 人的组合，由维护者确认）——
 * 7 人 4+3、8 人 4+4、9 人 4+5、10 人 4+3+3、16 人 4×4、20 人 4×5。人数非法时抛 RangeError。
 */
export function poolGroupSizes(players) {
  if (!Number.isInteger(players) || players < 1 || players > MAX_SEATS) throw new RangeError('invalid player count');
  if (players < GROUPED_POOL_MIN_PLAYERS) return [players];
  return POOL_GROUP_LAYOUTS[players].slice();
}

/** 池子副本数的放大倍数：四人及以下的组用完整的官方副本，五人组的共享池按人数放大（×1.25）。 */
export const poolCopyScale = (groupSize) => Math.max(1, groupSize / BASE_SEATS);

/**
 * 一局最多联防几轮 = 开局的固定卡池组数（1–5 轮），所以 4 人及以下永远只有 1 轮，20 人最多 5 轮。
 * 参数是「组数」，不是人数（Match.poolGroups.length）。
 */
export const uniteRoundLimit = (groups) => Math.max(1, Math.min(5, Math.trunc(groups || 1)));

/** 隐秘核心的解锁门槛：四人的基线按「人数 / 4」等比放大（8 人房要两倍的层数）。 */
export const coopHiddenLayerThreshold = (baseline, players) => Math.ceil(baseline * Math.max(1, players / BASE_SEATS));
