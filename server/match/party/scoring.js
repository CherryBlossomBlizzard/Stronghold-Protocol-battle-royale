// server/match/party/scoring.js — 个人计分、秘密任务进度检查、阵营胜负判定（服务端权威）。
//
// 设计稿 §8 的硬原则：
//   * 共同战役胜负、阵营胜负、个人排名**分开计算**；
//   * 不能只因战役失败就让裂盟派自动获胜；也不能让个人刷分完全抵消团队失败。
// 设计稿表 12 的结局表在这里落实为 judgeOutcome()。

import { FACTION } from '../../../shared/partyRules.js';
import { objectiveDef, challengeDef } from '../../../shared/partyCards.js';

/**
 * 任务 / 挑战的进度检查表。签名 (player, ctx) => boolean。
 * ctx = { campaign, allPlayers, round, outcome }
 */
const CHECKS = Object.freeze({
  endTicketsAtLeast: (p, _ctx, params) => p.tickets >= (params.amount || 0),
  intelAtLeast: (p, _ctx, params) => p.intel >= (params.amount || 0) && !p.stats.audited,
  campaignTopFraction: (p, ctx, params) => {
    const ranked = ctx.allPlayers.slice().sort((a, b) => (b.stats.campaignScore || 0) - (a.stats.campaignScore || 0));
    const cut = Math.max(1, Math.ceil(ranked.length * (params.fraction || 0.4)));
    return ranked.slice(0, cut).some((x) => x.playerId === p.playerId);
  },
  perfectRoundsAtLeast: (p, _ctx, params) => p.stats.perfectRounds >= (params.amount || 0),
  pranksPlayedAtLeast: (p, _ctx, params) => p.stats.pranksPlayed >= (params.amount || 0),
  suspicionAtMost: (p, _ctx, params) => p.suspicion <= (params.amount || 0),
  correctAccusationsAtLeast: (p, _ctx, params) => p.stats.correctAccusations >= (params.amount || 0),
  sponsoredExtraAtLeast: (p, _ctx, params) => p.stats.sponsoredExtra >= (params.amount || 0),
  neverJailedOrReturned: (p) => p.stats.jailed === 0 || p.stats.reentered === true,
  tradesAtLeast: (p, _ctx, params) => p.stats.trades >= (params.amount || 0),
  splitActionsAtLeast: (p, _ctx, params) => p.stats.splitActions >= (params.amount || 0),
  motionsPassedAtLeast: (p, _ctx, params) => p.stats.motionsPassed >= (params.amount || 0),
  // 个人挑战
  usedInvestigationOnce: (p) => p.stats.investigations >= 1,
  wonSealedAtLeastOnce: (p) => p.stats.bidWins >= 1,
  neverJailed: (p) => p.stats.jailed === 0,
  partyChallengeAtLeastOnce: (p) => p.stats.partyChallenges >= 1,
});

/**
 * 检查单个玩家的一项任务 / 挑战。返回 { done, def, points }。
 */
export function checkObjective(player, objectiveId, ctx) {
  const def = objectiveDef(objectiveId);
  if (!def) return { done: false, def: null, points: 0 };
  const fn = CHECKS[def.check];
  let done;
  try { done = fn ? !!fn(player, ctx, def.params || {}) : false; } catch { done = false; }
  return { done, def, points: done ? def.points : 0 };
}

export function checkChallenge(player, challengeId, ctx) {
  const def = challengeDef(challengeId);
  if (!def) return { done: false, def: null, points: 0 };
  const fn = CHECKS[def.check];
  let done;
  try { done = fn ? !!fn(player, ctx, def.params || {}) : false; } catch { done = false; }
  return { done, def, points: done ? def.points : 0 };
}

/**
 * 个人计分（总分封顶 score.cap）。五项分量各有上限（设计稿表 13）。
 * @returns {{ total, parts: object, breakdown: object[] }}
 */
export function scorePlayer(player, ctx, cfg) {
  const max = cfg.score.maximums;
  const clamp = (v, m) => Math.max(0, Math.min(m, Math.round(v)));

  // 战役贡献 0–35：漏怪少、击杀与伤害、完美回合
  const s = player.stats;
  const campaignRaw = (s.perfectRounds || 0) * 2 + Math.min(15, (s.kills || 0) * 0.5) + Math.min(10, (s.dmgDealt || 0) / 20000);
  const campaign = clamp(campaignRaw, max.campaign);

  // 秘密目标 0–25：主任务 + 个人挑战
  const obj = checkObjective(player, player.objectiveId, ctx);
  const chal = checkChallenge(player, player.challengeId, ctx);
  const secret = clamp(obj.points + chal.points, max.secret);

  // 团队关键贡献 0–25：资助、救援、关键决策
  const teamRaw = (s.sponsoredExtra || 0) * 8 + (s.motionsPassed || 0) * 5 + Math.min(6, (s.trades || 0) * 2);
  const team = clamp(teamRaw, max.team);

  // 派对挑战与交易 0–10：参与本身不得分
  const partyRaw = (s.partyChallenges || 0) * 2 + (s.bidWins || 0) * 2 + (s.motionsPassed || 0) * 1;
  const party = clamp(partyRaw, max.party);

  // 风险与反制 0–5
  const risk = clamp((s.countersWon || 0) * 2 + (s.correctAccusations || 0) * 2, max.risk);

  const parts = { campaign, secret, team, party, risk };
  const sum = campaign + secret + team + party + risk;
  const total = Math.min(cfg.score.cap, sum);
  return {
    total,
    parts,
    breakdown: [
      { id: 'campaign', points: campaign, max: max.campaign },
      { id: 'secret', points: secret, max: max.secret, objectiveDone: obj.done, challengeDone: chal.done },
      { id: 'team', points: team, max: max.team },
      { id: 'party', points: party, max: max.party },
      { id: 'risk', points: risk, max: max.risk },
    ],
    objectiveDone: obj.done,
    challengeDone: chal.done,
  };
}

/**
 * 结局判定（设计稿表 12）。
 * @param {object} input
 * @param {{victory:boolean, reason:string}} input.campaign  PvE 战役结果
 * @param {Array} input.players                PartyPlayer[]
 * @param {object} input.cfg
 * @param {boolean} [input.teamGuardUsed]      全队背锅等团队防护是否生效
 * @returns {{ campaign, factions: object, winner: object, rows: object[] }}
 */
export function judgeOutcome({ campaign, players, cfg, ctx = {} }) {
  // 离场的人也计分：他们的迟到/退出不该抹掉已经获得的战果记录
  const allPlayers = players.slice();
  const scored = new Map();
  for (const p of allPlayers) scored.set(p.playerId, scorePlayer(p, { ...ctx, campaign, allPlayers }, cfg));

  const byFaction = { [FACTION.LOYAL]: [], [FACTION.SPLIT]: [], [FACTION.OPPORTUNIST]: [] };
  for (const p of allPlayers) {
    const f = p.faction || FACTION.LOYAL;
    if (!byFaction[f]) byFaction[f] = [];
    byFaction[f].push(p);
  }

  // 忠诚派：战役胜利且无人背叛成功
  const campaignWon = !!campaign.victory;
  // 裂盟派：各自的破坏任务完成 + 终局门槛。设计稿明确「不能只因战役失败就让裂盟派自动获胜」。
  const splits = byFaction[FACTION.SPLIT] || [];
  const splitQualified = splits.filter((p) => scored.get(p.playerId)?.objectiveDone);
  const splitThreat = splits.length ? splitQualified.length / splits.length : 0;
  // 渗透成功：过半裂盟派完成破坏任务，并且（战役失败 或 破坏行动显著）
  const splitWins = splits.length > 0 && splitThreat >= 0.5 && (!campaignWon || splits.some((p) => (p.stats.splitActions || 0) >= 2));

  const factions = {
    [FACTION.LOYAL]: {
      won: campaignWon && !splitWins,
      campaignWon,
      qualified: (byFaction[FACTION.LOYAL] || []).length,
    },
    [FACTION.SPLIT]: {
      won: splitWins,
      qualified: splitQualified.length,
      total: splits.length,
    },
    [FACTION.OPPORTUNIST]: {
      won: false, // 投机派不继承阵营胜利
      qualified: (byFaction[FACTION.OPPORTUNIST] || []).filter((p) => scored.get(p.playerId)?.objectiveDone).length,
      total: (byFaction[FACTION.OPPORTUNIST] || []).length,
    },
  };

  // 个人排名：阵营胜利加成 + 个人胜利（任务完成）
  const rows = allPlayers.map((p) => {
    const sc = scored.get(p.playerId);
    const faction = p.faction || FACTION.LOYAL;
    const factionWon = !!factions[faction]?.won;
    const personalWin = !!sc.objectiveDone;
    const bonus = (factionWon ? cfg.score.factionWinBonus : 0) + (personalWin ? cfg.score.personalWinBonus : 0);
    return {
      playerId: p.playerId,
      seat: p.seat,
      name: p.name,
      faction,
      score: sc.total,
      parts: sc.parts,
      primaryObjective: { id: p.objectiveId, done: sc.objectiveDone },
      personalChallenge: { id: p.challengeId, done: sc.challengeDone },
      factionWon,
      personalWin,
      bonus,
      finalScore: Math.min(cfg.score.cap * 2, sc.total + bonus),
    };
  }).sort((a, b) => (b.finalScore - a.finalScore) || (a.seat - b.seat));

  rows.forEach((r, i) => { r.rank = i + 1; });

  // 结局名（表 12）
  const outcomeId = campaignWon && splitWins ? 'coup_success'
    : campaignWon ? 'perfect_guard'
      : splitWins ? 'infiltration_success'
        : 'line_collapse';

  const top = rows[0] || null;
  return {
    campaign: { victory: campaignWon, reason: campaign.reason || '' },
    outcome: outcomeId,
    factions,
    winner: { playerId: top ? top.playerId : null, name: top ? top.name : null, finalScore: top ? top.finalScore : 0 },
    rows,
  };
}
