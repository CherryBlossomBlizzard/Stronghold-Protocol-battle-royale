// server/match/party/cards.js — 卡牌效果执行器（服务端权威）。
//
// 客户端只提交 { cardId, targetId, extra }；这里按服务端自己的 CARDS 表查定义、校验资源与目标，
// 再生成「待结算的行动」（pending action）。真正的资源变动在统一结算时按固定优先级发生，
// 因此同一回合内的行动互相看不到、也不能抢跑（设计稿 §3「不依网络抵达顺序决定胜负」）。
//
// 每个效果的执行函数签名：
//   (ctx, action) => { ok: true, ...effects } | { ok: false, reason }
// ctx 见 PartyMatch 的 cardContext()。

import { cardDef, CARD_KIND, CARD_TARGET, SPLIT_ACTION_EFFECTS, INVESTIGATION_CARDS } from '../../../shared/partyCards.js';
import { clampPvpLoss } from '../../../shared/partyRules.js';

/** 资源名 → 玩家字段。 */
export const RESOURCE_FIELD = Object.freeze({ tickets: 'tickets', intel: 'intel', influence: 'influence' });

/** 卡牌费用能否支付。 */
export function canPay(player, cost) {
  if (!cost) return true;
  for (const [k, v] of Object.entries(cost)) {
    if (!(v > 0)) continue;
    const field = RESOURCE_FIELD[k];
    if (!field) return false;
    if (!(player[field] >= v)) return false;
  }
  return true;
}

/** 扣除费用（调用方必须已 canPay）。 */
export function pay(player, cost) {
  if (!cost) return;
  for (const [k, v] of Object.entries(cost)) {
    if (!(v > 0)) continue;
    const field = RESOURCE_FIELD[k];
    if (field) player[field] -= v;
  }
}

/** 目标是否合法（服务端再次校验，不信任客户端）。 */
export function validateTarget(action, actorId, playersById) {
  const def = cardDef(action.cardId);
  if (!def) return { ok: false, reason: 'unknown-card' };
  switch (def.target) {
    case CARD_TARGET.NONE:
      return { ok: true };
    case CARD_TARGET.SELF:
      if (action.targetId && action.targetId !== actorId) return { ok: false, reason: 'bad-target' };
      return { ok: true, targetId: actorId };
    case CARD_TARGET.PLAYER: {
      const t = action.targetId;
      if (!t || t === actorId) return { ok: false, reason: 'bad-target' };
      const ps = playersById.get(t);
      if (!ps) return { ok: false, reason: 'no-such-target' };
      if (ps.left) return { ok: false, reason: 'target-left' };
      return { ok: true, targetId: t, target: ps };
    }
    case CARD_TARGET.CHALLENGE: {
      // 反制卡的目标是「本轮挑战我的那张行动」，由 PartyMatch 提供上下文
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'bad-target' };
  }
}

/**
 * 效果表。每个函数只产出效果描述，不改状态（结算阶段统一应用）。
 * 返回的 `apply` 由 settle 调用，拿到真正的玩家对象。
 */
export const EFFECTS = Object.freeze({
  // ── 互坑整活 ──────────────────────────────────────────────────────────────
  /** 军需乌龙：让目标下一轮少拿 `amount` 张 `resource`。 */
  stripIncome(ctx, a) {
    const amount = a.def.params?.amount || 1;
    const resource = a.def.params?.resource || 'tickets';
    return {
      ok: true,
      effects: [{ type: 'stripIncome', targetId: a.targetId, resource, amount }],
      publicLog: { kind: 'supply', actorId: a.actorId, targetId: a.targetId },
      trace: { key: 'supply-abnormal', actorId: a.actorId, targetId: a.targetId, round: ctx.round },
    };
  },

  /** 会议跑题：提出荒诞议案；通过则得情报。 */
  motion(ctx, a) {
    const gain = a.def.params?.gainIntel || 2;
    return {
      ok: true,
      effects: [{ type: 'motion', actorId: a.actorId, gainIntel: gain, round: ctx.round }],
      publicLog: { kind: 'motion', actorId: a.actorId },
    };
  },

  /** 假警报：给目标一条模糊线索 + 嫌疑度。被验证为假时施卡者暴露一条真实行动记录。 */
  falseClue(ctx, a) {
    const suspicion = a.def.params?.suspicion || 2;
    return {
      ok: true,
      effects: [
        { type: 'addClue', targetId: a.targetId, clue: { kind: 'fake', source: 'unknown', text: '有人在你的调度记录里留下了可疑痕迹', round: ctx.round } },
        { type: 'addSuspicion', targetId: a.targetId, amount: suspicion },
      ],
      publicLog: { kind: 'clue', targetId: a.targetId },
      trace: { key: 'fake-alarm', actorId: a.actorId, targetId: a.targetId, round: ctx.round, fake: true },
    };
  },

  /** 临时换班：交换本轮一个可选秘密行动目标（双方都要有目标才生效）。 */
  swapTarget(ctx, a) {
    const mine = ctx.actor.pendingAction;
    const theirs = a.target?.pendingAction;
    if (!mine || !theirs || !mine.targetId || !theirs.targetId) {
      return { ok: false, reason: 'no-targets-to-swap' };
    }
    return {
      ok: true,
      effects: [{ type: 'swapTarget', actorId: a.actorId, targetId: a.targetId }],
      publicLog: { kind: 'swap', actorId: a.actorId, targetId: a.targetId },
    };
  },

  /** 补给抽签：双方各押 stake 张调度券，随机决定归属。 */
  lottery(ctx, a) {
    const stake = Math.min(a.def.params?.stake || 2, ctx.actor.tickets, a.target ? a.target.tickets : 0);
    if (stake < 1) return { ok: false, reason: 'cannot-afford-stake' };
    const winner = ctx.rng.chance(0.5) ? a.actorId : a.targetId;
    return {
      ok: true,
      effects: [{ type: 'lottery', actorId: a.actorId, targetId: a.targetId, stake, winner }],
      publicLog: { kind: 'lottery', actorId: a.actorId, targetId: a.targetId, winner },
    };
  },

  /** 全员反着来：公共二选一，多数派选错则少数派得功绩。 */
  reverseVote(ctx, a) {
    const merit = a.def.params?.merit || 4;
    return {
      ok: true,
      effects: [{ type: 'reverseVote', actorId: a.actorId, merit, round: ctx.round }],
      publicLog: { kind: 'reverse-vote', actorId: a.actorId },
    };
  },

  /** 乌龙悬赏：给目标挂公开悬赏。 */
  bounty(ctx, a) {
    const merit = a.def.params?.merit || 6;
    const intel = a.def.params?.intel || 1;
    return {
      ok: true,
      effects: [{ type: 'bounty', actorId: a.actorId, targetId: a.targetId, merit, intel, round: ctx.round }],
      publicLog: { kind: 'bounty', actorId: a.actorId, targetId: a.targetId },
    };
  },

  /** 锅从天降：把一条未验证的负面线索转交给另一名玩家。 */
  transferBlame(ctx, a) {
    const suspicion = a.def.params?.suspicion || 3;
    return {
      ok: true,
      effects: [
        { type: 'addClue', targetId: a.targetId, clue: { kind: 'unverified', source: 'unknown', text: '有人把一口锅放到了你的名下', round: ctx.round } },
        { type: 'addSuspicion', targetId: a.targetId, amount: suspicion },
      ],
      publicLog: { kind: 'blame', targetId: a.targetId },
      trace: { key: 'blame-shift', actorId: a.actorId, targetId: a.targetId, round: ctx.round },
    };
  },

  // ── 派对挑战 ──────────────────────────────────────────────────────────────
  councilSupport(ctx, a) {
    return {
      ok: true,
      effects: [{ type: 'partyVote', kind: 'council', actorId: a.actorId, round: ctx.round, params: a.def.params || {} }],
      publicLog: { kind: 'council', actorId: a.actorId },
    };
  },
  suspicionVote(ctx, a) {
    return {
      ok: true,
      effects: [{ type: 'partyVote', kind: 'suspicion', actorId: a.actorId, round: ctx.round, params: a.def.params || {} }],
      publicLog: { kind: 'suspect', actorId: a.actorId },
    };
  },
  miniAuction(ctx, a) {
    return {
      ok: true,
      effects: [{ type: 'partyVote', kind: 'auction', actorId: a.actorId, round: ctx.round, params: a.def.params || {} }],
      publicLog: { kind: 'auction', actorId: a.actorId },
    };
  },
  blindSupport(ctx, a) {
    const risky = a.extra === 'risky';
    const merit = risky ? (a.def.params?.meritRisky || 7) : (a.def.params?.meritSafe || 3);
    const failCost = a.def.params?.failCost || 1;
    // 激进：3/8 概率失败，只产生小额损失（设计稿「失败只产生小额损失」）
    const failed = risky && !ctx.rng.chance(0.625);
    return {
      ok: true,
      effects: [{ type: 'grantMerit', playerId: a.actorId, merit: failed ? 0 : merit, costTickets: failed ? failCost : 0, note: risky ? 'risky' : 'safe' }],
      publicLog: { kind: 'support', actorId: a.actorId, risky },
    };
  },
  distinctSupport(ctx, a) {
    return {
      ok: true,
      effects: [{ type: 'partyVote', kind: 'distinct', actorId: a.actorId, round: ctx.round, params: a.def.params || {} }],
      publicLog: { kind: 'distinct', actorId: a.actorId },
    };
  },
  sharedBlame(ctx, a) {
    return {
      ok: true,
      effects: [{ type: 'partyVote', kind: 'sharedBlame', actorId: a.actorId, round: ctx.round, params: a.def.params || {} }],
      publicLog: { kind: 'blame-team', actorId: a.actorId },
    };
  },

  // ── 社交推理 ──────────────────────────────────────────────────────────────
  /** 暗线监听：目标本轮是否执行过裂盟行动 → 是 / 否 / 无法确认。 */
  checkSplitAction(ctx, a) {
    const blocked = !!(a.target && a.target.darklisteningBlocked);
    const did = ctx.splitActionsThisRound.has(a.targetId);
    const answer = blocked ? 'UNCERTAIN' : (did ? 'YES' : 'NO');
    return {
      ok: true,
      effects: [{ type: 'privateIntel', toId: a.actorId, key: 'wiretap', subjectId: a.targetId, answer }],
      publicLog: { kind: 'investigate', targetId: a.targetId },
      trace: { key: 'investigation', actorId: a.actorId, targetId: a.targetId, round: ctx.round },
    };
  },

  /** 证据链：交叉验证自己的两条线索，一致则提升可信度。 */
  verifyClues(ctx, a) {
    const clues = (ctx.actor.clues || []).slice(-2);
    if (clues.length < 2) return { ok: false, reason: 'need-two-clues' };
    const same = clues[0].kind === clues[1].kind;
    return {
      ok: true,
      effects: [{ type: 'verifyClues', playerId: a.actorId, same, note: same ? 'cross-check agrees' : 'cross-check differs' }],
      publicLog: { kind: 'evidence', actorId: a.actorId },
    };
  },

  /** 公开质询：询问目标是否执行过 PvP / 交易 / 整活；目标可拒答（拒答提高嫌疑）。 */
  queryAction(ctx, a) {
    const kinds = ['pvp', 'trade', 'prank'].filter((k) => (ctx.actionLog.get(a.targetId) || new Set()).has(k));
    return {
      ok: true,
      effects: [{ type: 'privateIntel', toId: a.actorId, key: 'query', subjectId: a.targetId, answer: kinds.length ? kinds : ['NONE'] }],
      publicLog: { kind: 'account', targetId: a.targetId },
      trace: { key: 'account', actorId: a.actorId, targetId: a.targetId, round: ctx.round },
    };
  },

  /** 匿名告密：提交一条经系统验证的行动事实，隐藏举报者。 */
  anonymousTip(ctx, a) {
    const cats = [...(ctx.actionLog.get(a.targetId) || [])];
    const fact = cats.length ? cats[cats.length - 1] : 'NOTHING';
    return {
      ok: true,
      effects: [{ type: 'publicFact', subjectId: a.targetId, fact, round: ctx.round }],
      publicLog: { kind: 'tip', subjectId: a.targetId, fact },
      trace: { key: 'anonymous-tip', actorId: a.actorId, targetId: a.targetId, round: ctx.round, anonymous: true },
    };
  },

  /** 双面交易：双方各付 1 情报，互看一条线索。 */
  clueSwap(ctx, a) {
    if (!a.target) return { ok: false, reason: 'no-target' };
    if (!(ctx.actor.intel >= 1) || !(a.target.intel >= 1)) return { ok: false, reason: 'cannot-afford' };
    return {
      ok: true,
      effects: [{ type: 'clueSwap', actorId: a.actorId, targetId: a.targetId }],
      publicLog: { kind: 'deal', actorId: a.actorId, targetId: a.targetId },
      trace: { key: 'double-deal', actorId: a.actorId, targetId: a.targetId, round: ctx.round },
    };
  },

  /** 最后通牒：目标付 toll 张调度券，或接受一次公开调查（嫌疑+）。 */
  ultimatum(ctx, a) {
    const toll = a.def.params?.toll || 2;
    const paid = !!(a.target && a.target.tickets >= toll);
    return {
      ok: true,
      effects: paid
        ? [{ type: 'transfer', fromId: a.targetId, toId: a.actorId, resource: 'tickets', amount: toll }]
        : [{ type: 'addSuspicion', targetId: a.targetId, amount: 3 }, { type: 'publicFact', subjectId: a.targetId, fact: 'REFUSED', round: ctx.round }],
      publicLog: { kind: 'ultimatum', actorId: a.actorId, targetId: a.targetId, paid },
      trace: { key: 'ultimatum', actorId: a.actorId, targetId: a.targetId, round: ctx.round },
    };
  },

  // ── 反制（响应阶段）────────────────────────────────────────────────────────
  /** 当场拆穿：抵消伪造证据 / 假警报，并公开施卡者的行动类别。 */
  cancelFake(ctx, a) {
    return {
      ok: true,
      effects: [{ type: 'counter', againstId: a.againstId, mode: 'fake', actorId: a.actorId, revealCategory: true }],
      publicLog: { kind: 'expose', actorId: a.actorId },
      trace: { key: 'counter', actorId: a.actorId, targetId: a.againstId, round: ctx.round },
    };
  },
  cancelSwap(ctx, a) {
    return {
      ok: true,
      effects: [{ type: 'counter', againstId: a.againstId, mode: 'swap', actorId: a.actorId }],
      publicLog: { kind: 'refuse', actorId: a.actorId },
    };
  },
  cancelTransfer(ctx, a) {
    return {
      ok: true,
      effects: [{ type: 'counter', againstId: a.againstId, mode: 'transfer', actorId: a.actorId }],
      publicLog: { kind: 'audit', actorId: a.actorId },
      trace: { key: 'audit', actorId: a.actorId, targetId: a.againstId, round: ctx.round },
    };
  },
  cancelCampaignMalus(ctx, a) {
    return {
      ok: true,
      effects: [{ type: 'counter', againstId: a.againstId, mode: 'campaign', actorId: a.actorId }],
      publicLog: { kind: 'hold', actorId: a.actorId },
    };
  },
});

/** 取卡牌的效果执行函数（未知效果一律 null）。 */
export function effectFor(def) {
  if (!def) return null;
  return Object.prototype.hasOwnProperty.call(EFFECTS, def.effect) ? EFFECTS[def.effect] : null;
}

/** 这张卡的结算优先级（设计稿 §3：防护/反制 → 侦查 → 交易 → 高风险 → 破坏）。越小越先。 */
export function resolvePriority(def) {
  if (!def) return 99;
  if (def.timing === 'RESPONSE') return 0;
  switch (def.effect) {
    case 'checkSplitAction': case 'queryAction': case 'verifyClues': case 'anonymousTip': return 1;
    case 'clueSwap': case 'lottery': case 'swapTarget': return 2;
    case 'ultimatum': case 'bounty': case 'transferBlame': return 3;
    case 'stripIncome': case 'falseClue': case 'miniAuction': return 4;
    case 'grantMerit': return 5; // 纯收益最后结算，避免抢跑影响
    default: return 6;
  }
}

/** 这张卡属于哪一类行动日志（用于「是否执行过 PvP / 交易 / 整活」的查询）。 */
export function actionCategory(def) {
  if (!def) return null;
  if (def.kind === CARD_KIND.PRANK) return 'prank';
  if (def.target === CARD_TARGET.PLAYER && def.highRisk) return 'pvp';
  if (def.effect === 'clueSwap') return 'trade';
  return 'action';
}

/** 是否算「裂盟行动」（设计稿：裂盟派拥有破坏行动）。 */
export function isSplitAction(def) {
  return !!def && SPLIT_ACTION_EFFECTS.includes(def.effect);
}

/** 是否调查类卡牌。 */
export function isInvestigationCard(cardId) {
  return INVESTIGATION_CARDS.includes(cardId);
}

export { clampPvpLoss };
