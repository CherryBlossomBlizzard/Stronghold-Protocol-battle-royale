// server/match/party/roles.js — 身份分配、裂盟派互认、秘密任务抽取、个人秘密视图。
//
// 设计稿 §2：房主开局前设置「裂盟派是否互相认识」（ALL / PARTIAL / NONE），开局后不得更改。
// 服务端权威：身份、任务、线索与彼此可见关系只存在这里，**绝不**整包发给客户端；
// 每个玩家只拿到自己的 m.partyPrivate（见 privateViewFor）。
//
// 抽签用注入的确定性 rng（server/sim/rng.js 的 createRng），因此同一 seed 可复现。

import { FACTION, SPLIT_KNOWLEDGE, factionCounts } from '../../../shared/partyRules.js';
import {
  PERSONAL_CHALLENGES, objectivesFor, objectiveDef, challengeDef,
} from '../../../shared/partyCards.js';

/**
 * 座位 → 身份。座位顺序打乱后按 factionCounts 的数量切分，保证每次人数都一致。
 * @param {string[]} playerIds 按座位排序
 * @param {{shuffle: (arr:any[]) => void}|null} rng 可注入的确定性随机源（null = 保持座位顺序，测试用）
 * @param {object} cfg
 * @returns {Map<string, string>} playerId → FACTION
 */
export function assignFactions(playerIds, rng, cfg) {
  const ids = playerIds.slice();
  const counts = factionCounts(ids.length, cfg.factionTable);
  const pool = [];
  for (const f of [FACTION.LOYAL, FACTION.SPLIT, FACTION.OPPORTUNIST]) {
    for (let i = 0; i < (counts[f] || 0); i++) pool.push(f);
  }
  if (pool.length !== ids.length) throw new Error(`faction pool mismatch: ${pool.length} vs ${ids.length}`);
  if (rng && typeof rng.shuffle === 'function') rng.shuffle(pool);
  const out = new Map();
  ids.forEach((id, i) => out.set(id, pool[i]));
  return out;
}

/**
 * 裂盟派互认关系（设计稿 §2.2）。返回 playerId → 可见的裂盟派 playerId 数组（**不含自己**）。
 * NONE：谁都看不见；ALL：全部裂盟派互认；PARTIAL：每人只认识一个「指定队友」（环形配对）。
 */
export function splitKnownMap(factions, playerIds, mode) {
  const splits = playerIds.filter((id) => factions.get(id) === FACTION.SPLIT);
  const out = new Map();
  for (const id of playerIds) out.set(id, []);
  if (mode === SPLIT_KNOWLEDGE.NONE) return out;
  if (mode === SPLIT_KNOWLEDGE.ALL) {
    for (const id of splits) out.set(id, splits.filter((o) => o !== id));
    return out;
  }
  // PARTIAL：环形配对，偶数位认后一位，奇数位认前一位；只有 1 名裂盟派时无队友
  if (splits.length < 2) return out;
  splits.forEach((id, i) => {
    const other = i % 2 === 0 ? splits[(i + 1) % splits.length] : splits[(i - 1 + splits.length) % splits.length];
    if (other !== id) out.set(id, [other]);
  });
  return out;
}

/**
 * 抽秘密任务：每名玩家一张主任务（按阵营过滤的池里抽），再抽一张个人挑战。
 * 任务池不够时允许重复（8–12 人 < 13 张任务，实际够用；不足时按比例放宽）。
 * @returns {Map<string, { objectiveId: string, challengeId: string|null }>}
 */
export function assignObjectives(factions, playerIds, rng) {
  const out = new Map();
  const used = new Set();
  for (const id of playerIds) {
    const faction = factions.get(id);
    let pool = objectivesFor(faction).filter((o) => !used.has(o.id));
    if (!pool.length) pool = objectivesFor(faction); // 池子用尽：允许重复，但绝不跨阵营
    const pick = pool.length ? pool[rng.int(pool.length)] : null;
    if (pick) used.add(pick.id);
    out.set(id, { objectiveId: pick ? pick.id : null });
  }
  // 个人挑战：低分值，尽量不重复
  const challengeIds = Object.keys(PERSONAL_CHALLENGES);
  const usedChallenges = new Set();
  for (const id of playerIds) {
    let pool = challengeIds.filter((c) => !usedChallenges.has(c));
    if (!pool.length) pool = challengeIds;
    const c = pool[rng.int(pool.length)];
    usedChallenges.add(c);
    const rec = out.get(id);
    if (rec) rec.challengeId = c;
  }
  return out;
}

/** 某玩家自己的身份 / 任务 / 已知队友（只给本人）。 */
export function privateRoleView(playerId, factions, objectives, knownMap) {
  const faction = factions.get(playerId) || FACTION.LOYAL;
  const obj = objectives.get(playerId) || { objectiveId: null, challengeId: null };
  const objective = objectiveDef(obj.objectiveId);
  const challenge = challengeDef(obj.challengeId);
  return {
    faction,
    knownSplits: (knownMap.get(playerId) || []).slice(),
    objective: objective
      ? { id: objective.id, kind: objective.kind, name: objective.name, text: objective.text, points: objective.points }
      : null,
    challenge: challenge
      ? { id: challenge.id, name: challenge.name, text: challenge.text, points: challenge.points }
      : null,
  };
}
