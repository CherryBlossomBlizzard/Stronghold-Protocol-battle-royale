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
/** 7 人起分池（6 人及以下仍是一个共享池） */
export const GROUPED_POOL_MIN_PLAYERS = 7;
/** 8 人起一局可以联防两轮 */
export const SECOND_UNITE_MIN_PLAYERS = 8;
export const MAX_UNITE_HELPERS = 4;

/** 这一轮选牌发几张：本局存活人数 + DRAFT_SPARE_CARDS，夹在 [MIN_COOP_DRAFT_CARDS, MAX_DRAFT_CARDS]。 */
export function coopDraftCardCount(players) {
  return Math.min(MAX_DRAFT_CARDS, Math.max(MIN_COOP_DRAFT_CARDS, Math.trunc(players || 0) + DRAFT_SPARE_CARDS));
}

/**
 * 按座位排序的分组人数：7 人起分成 ceil(n / 4) 组、人数尽量均分（5 人 → [5]，9 人 → [5, 4]，20 人 → [5, 5, 5, 5]）。
 * 人数非法时抛 RangeError —— 调用方拿到的永远是能直接 slice 的整数数组。
 */
export function poolGroupSizes(players) {
  if (!Number.isInteger(players) || players < 1 || players > MAX_SEATS) throw new RangeError('invalid player count');
  if (players < GROUPED_POOL_MIN_PLAYERS) return [players];
  const groups = Math.ceil(players / BASE_SEATS);
  const size = Math.floor(players / groups);
  const extra = players % groups;
  return Array.from({ length: groups }, (_, i) => size + (i < extra ? 1 : 0));
}

/** 池子副本数的放大倍数：四人及以下的组用完整的官方副本，5/6 人的共享池按人数等比放大。 */
export const poolCopyScale = (groupSize) => Math.max(1, groupSize / BASE_SEATS);

/** 一局能联防几轮：8 人起两轮，否则一轮。 */
export const uniteRoundLimit = (livingPlayers) => (livingPlayers >= SECOND_UNITE_MIN_PLAYERS ? 2 : 1);

/** 隐秘核心的解锁门槛：四人的基线按「人数 / 4」等比放大（8 人房要两倍的层数）。 */
export const coopHiddenLayerThreshold = (baseline, players) => Math.ceil(baseline * Math.max(1, players / BASE_SEATS));
