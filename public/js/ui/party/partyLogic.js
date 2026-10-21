// public/js/ui/party/partyLogic.js — 《神人派对》前端的纯逻辑（可在 Node 里单测，不碰 DOM）。
//
// 只做三件事：判断当前该显示哪个派对面板、把服务端帧整理成可渲染的行、以及表单校验。
// 任何"这操作合不合法"的最终判断都在服务端；这里只用于禁用按钮与提示。

import { PARTY_PHASE, FACTION, GULAG, INMATE_STATE } from '../../../../shared/partyRules.js';
import { CARDS, cardDef } from '../../../../shared/partyCards.js';

/** 阵营的中文名。 */
export const FACTION_NAME = Object.freeze({
  [FACTION.LOYAL]: '忠诚派',
  [FACTION.SPLIT]: '裂盟派',
  [FACTION.OPPORTUNIST]: '投机派',
});

/** 阶段中文名（用于标题与进度条）。 */
export const PHASE_LABEL = Object.freeze({
  [PARTY_PHASE.BRIEFING]: '确认本局信息',
  [PARTY_PHASE.REPORT]: '战报与事件',
  [PARTY_PHASE.MARKET]: '抽牌与公共市场',
  [PARTY_PHASE.TRADE]: '谈判与交易',
  [PARTY_PHASE.SECRET]: '同步秘密行动',
  [PARTY_PHASE.RESPONSE]: '响应与反制',
  [PARTY_PHASE.RESOLVE]: '统一结算',
  'PARTY_COMBAT': '共同战役',
  [PARTY_PHASE.SCORE]: '计分与线索',
  [PARTY_PHASE.GULAG]: '古拉格挑战',
  [PARTY_PHASE.ENDED]: '对局结束',
});

/** 古拉格状态的中文名。 */
export const GULAG_LABEL = Object.freeze({
  [GULAG.CLOSED_BEFORE]: '未开放',
  [GULAG.OPEN]: '开放中',
  [GULAG.CHALLENGING]: '挑战进行中',
  [GULAG.AWAITING_RETURN]: '有人待返场',
  [GULAG.PERMANENTLY_CLOSED]: '已永久关闭（暴动）',
});

/** 囚犯状态的中文名。 */
export const INMATE_LABEL = Object.freeze({
  [INMATE_STATE.NONE]: '—',
  [INMATE_STATE.IN_CUSTODY]: '在押',
  [INMATE_STATE.CHALLENGING]: '挑战中',
  [INMATE_STATE.QUALIFIED_USED]: '资格已用',
  [INMATE_STATE.AWAITING_RETURN]: '待返场',
  [INMATE_STATE.RELEASED]: '已释放·待返场',
  [INMATE_STATE.RETURNED]: '已返场',
});

/** 这个阶段玩家能不能出牌。 */
export function canPlayInPhase(phase) {
  return phase === PARTY_PHASE.SECRET;
}

/** 这个阶段玩家能不能提交反制。 */
export function canRespondInPhase(phase) {
  return phase === PARTY_PHASE.RESPONSE;
}

/** 这个阶段能不能买东西/报价。 */
export function canTradeInPhase(phase) {
  return phase === PARTY_PHASE.MARKET;
}

/**
 * 当前该渲染的派对面板。
 * @param {{party?: object, partyPrivate?: object}} match
 * @param {{party?: object}|null} room
 */
export function partyViewState(match, room) {
  const pub = match && match.party ? match.party : null;
  if (!pub) return { kind: room && room.party ? 'waiting' : 'none' };
  const priv = match.partyPrivate || null;
  if (pub.phase === PARTY_PHASE.ENDED || match.partyResult) return { kind: 'result', pub, priv, result: match.partyResult || null };
  switch (pub.phase) {
    case PARTY_PHASE.BRIEFING: return { kind: 'briefing', pub, priv };
    case PARTY_PHASE.MARKET: return { kind: 'market', pub, priv };
    case PARTY_PHASE.TRADE: return { kind: 'trade', pub, priv };
    case PARTY_PHASE.SECRET: return { kind: 'secret', pub, priv };
    case PARTY_PHASE.RESPONSE: return { kind: 'response', pub, priv };
    case PARTY_PHASE.GULAG: return { kind: 'gulag', pub, priv };
    case PARTY_PHASE.REPORT:
    case PARTY_PHASE.RESOLVE:
    case PARTY_PHASE.SCORE:
    case 'PARTY_COMBAT':
      return { kind: 'report', pub, priv };
    default:
      return { kind: 'report', pub, priv };
  }
}

/** 手牌 → 可渲染行（合并同 id 的卡，显示费用与是否买得起）。 */
export function handRows(hand, resources, phase) {
  const list = Array.isArray(hand) ? hand : [];
  const seen = new Map();
  for (const c of list) {
    if (!c || !c.cardId) continue;
    const key = c.cardId;
    if (!seen.has(key)) seen.set(key, { cardId: c.cardId, uids: [], def: cardDef(c.cardId) });
    seen.get(key).uids.push(c.uid);
  }
  const out = [];
  for (const row of seen.values()) {
    const def = row.def;
    if (!def) continue;
    const cost = def.cost || {};
    const affordable = Object.entries(cost).every(([k, v]) => !(v > 0) || (resources && resources[k] >= v));
    const rightTiming = def.timing === 'RESPONSE'
      ? canRespondInPhase(phase)
      : canPlayInPhase(phase);
    out.push({
      cardId: row.cardId, uid: row.uids[0], count: row.uids.length, def,
      cost, affordable, playable: affordable && rightTiming,
    });
  }
  return out;
}

/** 市场格子的可渲染行。 */
export function marketRows(market, privateState, resources) {
  if (!market || !Array.isArray(market.slots)) return [];
  return market.slots.map((s) => {
    const def = cardDef(s.cardId);
    const fixedLeft = privateState ? Math.max(0, (privateState.fixedLimit || 1) - (privateState.fixedBought || 0)) : 0;
    const alreadyBid = !!(privateState && privateState.bidSlot != null);
    return {
      ...s,
      def,
      canBuy: s.mode === 'fixed' && s.remaining > 0 && fixedLeft > 0 && (!resources || resources.tickets >= s.price),
      canBid: s.mode === 'sealed' && s.remaining > 0 && !alreadyBid,
      myBid: privateState && privateState.bidSlot === s.slot ? privateState.bidAmount : null,
    };
  });
}

/** 别人对我的待响应行动（反制阶段用）。 */
export function incomingActions(pub, priv, meId) {
  const log = Array.isArray(pub && pub.log) ? pub.log : [];
  void priv;
  return log.filter((e) => e && e.kind === 'action' && e.targetId === meId);
}

/** 古拉格面板：我还需要什么才能挑战、能否被资助。 */
export function gulagPanel(pub, priv, meId) {
  const g = (pub && pub.gulag) || {};
  const me = priv && priv.gulag ? priv.gulag.me : null;
  const inmates = Array.isArray(g.inmates) ? g.inmates : [];
  const row = inmates.find((r) => r.playerId === meId) || null;
  return {
    state: g.state || GULAG.CLOSED_BEFORE,
    label: GULAG_LABEL[g.state || GULAG.CLOSED_BEFORE] || '',
    permanentlyClosed: !!g.permanentlyClosed,
    openRound: g.openRound || 8,
    cost: g.cost || 3,
    rolls: Array.isArray(g.rolls) ? g.rolls : [],
    inmates,
    me: row,
    canChallenge: !!(me && me.canChallenge),
    pendingReturn: Array.isArray(g.pendingReturn) ? g.pendingReturn : [],
    canBeSponsored: !!row && !g.permanentlyClosed
      && (row.state === INMATE_STATE.IN_CUSTODY || row.state === INMATE_STATE.QUALIFIED_USED),
  };
}

/** 其他玩家（用于选目标）。 */
export function otherPlayers(players, meId) {
  return (Array.isArray(players) ? players : []).filter((p) => p && p.playerId !== meId);
}

/** 剩余秒数（界面上显示倒计时；服务端才是权威）。 */
export function secondsLeft(deadline, nowMs = Date.now()) {
  if (!deadline || !Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
}

/** 房主设置表单 → room.party 载荷（只带改动过的字段）。 */
export function partySettingsPayload(form) {
  const out = {};
  if (typeof form.partyMode === 'boolean') out.partyMode = form.partyMode;
  if (form.splitKnowledge) out.splitKnowledge = form.splitKnowledge;
  if (Number.isInteger(form.extraChanceCost)) out.extraChanceCost = form.extraChanceCost;
  if (Number.isInteger(form.rounds)) out.rounds = form.rounds;
  return out;
}

/** 设置表单的本地校验（与服务端保持一致；服务端仍会再校验一次）。 */
export function validatePartySettings(form) {
  const errors = [];
  if (form.extraChanceCost != null && !(Number.isInteger(form.extraChanceCost) && form.extraChanceCost >= 1 && form.extraChanceCost <= 10)) {
    errors.push('额外挑战机会的价格须为 1–10 张调度券');
  }
  if (form.rounds != null && !(Number.isInteger(form.rounds) && form.rounds >= 4 && form.rounds <= 30)) {
    errors.push('回合数须在 4–30 之间');
  }
  if (form.splitKnowledge && !['ALL', 'PARTIAL', 'NONE'].includes(form.splitKnowledge)) {
    errors.push('裂盟派互认设置无效');
  }
  return errors;
}

/** 是否该显示"派对模式"界面（而非 PvE 的 game 屏幕）。 */
export function isPartyMatch(match, room) {
  if (match && match.party) return true;
  return !!(room && room.party && room.inMatch);
}

export { CARDS, PARTY_PHASE, GULAG, INMATE_STATE, FACTION };
