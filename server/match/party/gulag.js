// server/match/party/gulag.js — 《神人派对》古拉格监狱：入狱、小游戏挑战、额外挑战机会、D20 暴动、返场。
//
// 这是设计稿 §9、§10、§13 与「必须遵循的规则」的权威实现，服务端独占。全部公开方法都只接受
// **服务端已验证**的参数；任何来自客户端的数字都先过这里再做校验。
//
// 已确定的硬规则（改动前请先看 docs/PARTY_MODE.md）：
//   1. 古拉格用派对小游戏挑战。
//   2. 挑战成功者在下一次主战场结算时返场（不在战斗中途加入）。
//   3. 队友只能用调度券购买一次额外挑战机会，不能直接替别人复活。
//   4. 每名玩家正常情况下只能进入古拉格一次；额外机会价格是配置项（测试值 3 调度券）。
//   5. 古拉格正常情况下在第 8 回合开放。
//   6. 第 6 回合掷一次 D20，恰好 6 才触发暴动。
//   7. 第 6 回合没触发、且古拉格仍开放时，第 8 回合小游戏开始前再掷一次，仍然只有恰好 6 才触发。
//   8. 触发后所有在押者立即获释、下一次主战场结算返场，古拉格永久关闭（不再收新囚犯、不能买/用新机会）。
//   9. 第 6 回合已触发暴动时，第 8 回合不再检定。
//  10. D20 是二十面骰；触发条件是「恰好等于 6」，不是「大于等于 6」，也不是 D6。

import { GULAG, INMATE_STATE } from '../../../shared/partyRules.js';

/** 囚犯记录里允许的合法状态迁移（防止重复释放、重复返场）。 */
const TRANSITIONS = Object.freeze({
  [INMATE_STATE.IN_CUSTODY]: [INMATE_STATE.CHALLENGING, INMATE_STATE.RELEASED],
  [INMATE_STATE.CHALLENGING]: [INMATE_STATE.QUALIFIED_USED, INMATE_STATE.AWAITING_RETURN, INMATE_STATE.RELEASED],
  [INMATE_STATE.QUALIFIED_USED]: [INMATE_STATE.CHALLENGING, INMATE_STATE.RELEASED],
  [INMATE_STATE.AWAITING_RETURN]: [INMATE_STATE.RETURNED, INMATE_STATE.RELEASED],
  [INMATE_STATE.RELEASED]: [INMATE_STATE.RETURNED],
  [INMATE_STATE.RETURNED]: [],
});

/**
 * 古拉格模块。一个 PartyMatch 持有一个实例。
 *
 * @param {object} opts
 * @param {object} opts.cfg           本局配置（shared/partyRules.js 的 normalizePartyConfig 结果）
 * @param {{next:() => number}} opts.rng  二十面骰用的随机源（整数 1..dieSides）
 * @param {(event: object) => void} [opts.onEvent] 事件回调（写日志 / 公告 / 广播）
 */
export class Gulag {
  constructor({ cfg, rng, onEvent = () => {} }) {
    this.cfg = cfg;
    this.rng = rng;
    this.onEvent = onEvent;
    /** 古拉格状态（GULAG） */
    this.state = GULAG.CLOSED_BEFORE;
    /** 本局是否已永久关闭（暴动后） */
    this.permanentlyClosed = false;
    /** 本局是否开放过 */
    this.everOpened = false;
    /** 暴动检定记录：[{ round, when, roll, sides, triggered }] */
    this.rolls = [];
    /** 是否已触发过暴动 */
    this.riotTriggered = false;
    /** 玩家状态：playerId → { playerId, state, joinedRound, chancesUsed, extraChances, extraChancesBought,
     *                        sponsoredBy[], challenge, lastRoll, awaitingSince, returnedRound } */
    this.records = new Map();
    /** 累计资助记录（审计）：[{ payerId, beneficiaryId, cost, round, at }] */
    this.sponsorships = [];
    /** 已释放但还没处理的（幂等保护）：playerId Set */
    this._releasedPending = new Set();
    /** 本回合是否已做过「第 8 回合开始前」的检定 */
    this._secondRollDone = false;
    /** 每回合的小游戏场次（实验/审计用） */
    this.challengeLog = [];
  }

  // ── 查询 ────────────────────────────────────────────────────────────────────────────
  record(playerId) {
    let r = this.records.get(playerId);
    if (!r) {
      r = {
        playerId, state: INMATE_STATE.NONE, joinedRound: 0, chancesUsed: 0, extraChances: 0,
        extraChancesBought: 0, sponsoredBy: [], challenge: null, lastRoll: null,
        awaitingSince: 0, returnedRound: 0,
      };
      this.records.set(playerId, r);
    }
    return r;
  }

  isInCustody(playerId) {
    const r = this.records.get(playerId);
    if (!r) return false;
    return r.state === INMATE_STATE.IN_CUSTODY || r.state === INMATE_STATE.CHALLENGING
      || r.state === INMATE_STATE.QUALIFIED_USED || r.state === INMATE_STATE.AWAITING_RETURN
      || r.state === INMATE_STATE.RELEASED;
  }

  /** 还「关」着、尚且能挑战的玩家（在押 / 挑战中）。 */
  activeInmates() {
    const out = [];
    for (const r of this.records.values()) {
      if (r.state === INMATE_STATE.IN_CUSTODY || r.state === INMATE_STATE.CHALLENGING) out.push(r);
    }
    return out.sort((a, b) => String(a.playerId).localeCompare(String(b.playerId)));
  }

  /** 所有尚未返场的人（释放的、待返场的、在押的都算）。 */
  pendingReturn() {
    const out = [];
    for (const r of this.records.values()) {
      if (r.state === INMATE_STATE.AWAITING_RETURN || r.state === INMATE_STATE.RELEASED) out.push(r);
    }
    return out.sort((a, b) => String(a.playerId).localeCompare(String(b.playerId)));
  }

  /** 公开视图（不含任何秘密信息：古拉格信息本来就是公开的）。 */
  view() {
    return {
      state: this.state,
      permanentlyClosed: this.permanentlyClosed,
      everOpened: this.everOpened,
      openRound: this.cfg.gulag.openRound,
      riotTriggered: this.riotTriggered,
      rolls: this.rolls.map((r) => ({ round: r.round, when: r.when, roll: r.roll, sides: r.sides, triggered: r.triggered })),
      cost: this.cfg.gulag.extraChanceCost,
      inmates: [...this.records.values()]
        .filter((r) => r.state !== INMATE_STATE.NONE)
        .map((r) => ({
          playerId: r.playerId, state: r.state, joinedRound: r.joinedRound,
          chancesUsed: r.chancesUsed, extraChances: r.extraChances,
          canChallenge: this.canChallenge(r.playerId),
          awaitingSince: r.awaitingSince, returnedRound: r.returnedRound,
        })),
      pendingReturn: this.pendingReturn().map((r) => r.playerId),
    };
  }

  // ── 入狱 ────────────────────────────────────────────────────────────────────────────
  /**
   * 淘汰后进入古拉格。古拉格已永久关闭、还没到开放回合、或本局早已关闭时不收人。
   * 返回 { jailed, reason }。
   */
  jail(playerId, round) {
    const r = this.record(playerId);
    if (r.state !== INMATE_STATE.NONE) {
      // 重复入狱请求：幂等，不重置任何资格（待返场 / 已释放的人也不会被"降级"）
      return { jailed: this.isInCustody(playerId), reason: 'already-recorded' };
    }
    const g = this.cfg.gulag;
    // 古拉格永久关闭后不再收新囚犯；已有的等待返场记录绝不能被这次请求抹掉
    if (this.permanentlyClosed) return { jailed: false, reason: 'closed' };
    // 更早被淘汰的人先记「在押」，等开放回合才有挑战资格（canChallenge 会检查开放状态）。
    r.joinedRound = round;
    r.state = INMATE_STATE.IN_CUSTODY;
    r.chancesUsed = 0;
    r.extraChances = 0;
    r.extraChancesBought = 0;
    this.onEvent({ type: 'gulag.jail', playerId, round, awaitingOpen: round < g.openRound });
    return { jailed: true, reason: 'jailed' };
  }

  // ── 开放与暴动 ──────────────────────────────────────────────────────────────────────
  /**
   * 回合开始时调用（在玩家的回合开始之前）。负责：
   *   * 第 6 回合：第一次 D20 检定；
   *   * 第 8 回合：如果第 6 回合没触发且古拉格仍开放，再检定一次（小游戏开始前）；
   *   * 第 8 回合：开放古拉格。
   *
   * 第六回合已触发暴动时，第八回合**不再掷骰**（规则 9）。
   * 返回本回合发生的事件数组。
   */
  beginRound(round, { hasInmates = false } = {}) {
    const events = [];
    const g = this.cfg.gulag;

    // 第 6 回合的检定
    if (round === g.firstRollRound && !this._hasRolled(round, 'FIRST')) {
      events.push(this._roll(round, 'FIRST'));
    }

    // 第 8 回合：如果第 6 回合没触发且古拉格仍开放，小游戏开始前再掷一次
    if (round === g.secondRollRound && !this.permanentlyClosed) {
      const first = this.rolls.find((r) => r.when === 'FIRST');
      const firstTriggered = !!(first && first.triggered);
      if (!firstTriggered && !this._hasRolled(round, 'SECOND')) {
        events.push(this._roll(round, 'SECOND'));
      }
    }

    // 开放（暴动后永久关闭则不再开放）
    if (round >= g.openRound && !this.permanentlyClosed && !this.everOpened) {
      this.everOpened = true;
      this.state = GULAG.OPEN;
      events.push({ type: 'gulag.open', round });
    }
    void hasInmates;
    return events.filter(Boolean);
  }

  _hasRolled(round, when) {
    return this.rolls.some((r) => r.round === round && r.when === when);
  }

  /** 掷一次 D20。二十面骰：1..20 均匀；只有恰好等于 riotFace 才触发。 */
  _roll(round, when) {
    const g = this.cfg.gulag;
    const sides = g.dieSides;
    const roll = this.rng.next(sides);
    // 防御：随机源若给出界外值，视为不触发（绝不放宽成 >=）
    const valid = Number.isInteger(roll) && roll >= 1 && roll <= sides;
    const triggered = valid && roll === g.riotFace;
    const rec = { round, when, roll: valid ? roll : null, sides, triggered };
    this.rolls.push(rec);
    const ev = { type: 'gulag.roll', round, when, roll: rec.roll, sides, triggered };
    this.onEvent(ev);
    if (triggered) this._riot(round);
    return ev;
  }

  /** 暴动：所有在押者立即获释、古拉格永久关闭、本局不再收新囚犯、不能买/用新的额外机会。 */
  _riot(round) {
    if (this.riotTriggered) return; // 幂等：同一局最多暴动一次
    this.riotTriggered = true;
    this.permanentlyClosed = true;
    this.state = GULAG.PERMANENTLY_CLOSED;
    this._releasedPending.clear();
    for (const r of this.records.values()) {
      if (r.state === INMATE_STATE.IN_CUSTODY || r.state === INMATE_STATE.CHALLENGING || r.state === INMATE_STATE.QUALIFIED_USED) {
        // 「正在进行的古拉格挑战取消」
        if (r.challenge) r.challenge.cancelled = true;
        this._setState(r, INMATE_STATE.RELEASED, round);
        r.awaitingSince = round;
        this._releasedPending.add(r.playerId);
      } else if (r.state === INMATE_STATE.AWAITING_RETURN) {
        // 已在等返场的人保持待返场，不会因为暴动获得第二份奖励
        r.awaitingSince = r.awaitingSince || round;
      }
    }
    this.onEvent({ type: 'gulag.riot', round, released: [...this._releasedPending] });
  }

  _setState(r, next, round = 0) {
    const allowed = TRANSITIONS[r.state] || [];
    // 同一状态的重复设置是幂等的；非法迁移直接拒绝，避免重复释放 / 重复返场
    if (next === r.state) return false;
    if (!allowed.includes(next)) return false;
    r.state = next;
    if (next === INMATE_STATE.RELEASED || next === INMATE_STATE.AWAITING_RETURN) r.awaitingSince = round || r.awaitingSince;
    return true;
  }

  // ── 额外挑战机会（队友购买）────────────────────────────────────────────────────────
  /**
   * 队友（payer）为囚犯（beneficiary）购买一次额外挑战机会。
   * * 只扣 payer 的调度券（由调用方传入已校验的 affordability 结果，这里只做规则判断）；
   * * 不直接复活：受益者必须本人参加并获胜；
   * * 同一购买请求只能处理一次（调用方用 requestId 去重，这里再用计数器兜底）；
   * * 古拉格永久关闭后不得再购买。
   *
   * 返回 { ok, reason?, cost? }。
   */
  canSponsor(payerId, beneficiaryId, round) {
    if (this.permanentlyClosed) return { ok: false, reason: 'gulag-closed' };
    if (payerId === beneficiaryId) return { ok: false, reason: 'self' };
    const r = this.records.get(beneficiaryId);
    if (!r) return { ok: false, reason: 'not-in-gulag' };
    if (r.state !== INMATE_STATE.IN_CUSTODY && r.state !== INMATE_STATE.QUALIFIED_USED && r.state !== INMATE_STATE.CHALLENGING) {
      return { ok: false, reason: 'not-in-custody' };
    }
    const g = this.cfg.gulag;
    if (r.extraChancesBought >= g.maxExtraChancesPerPlayer) return { ok: false, reason: 'already-sponsored' };
    void round;
    return { ok: true, cost: g.extraChanceCost };
  }

  /** 记入一次已付款的资助（调用方负责真正扣券，且必须已调用 canSponsor）。 */
  applySponsorship(payerId, beneficiaryId, round, now = 0) {
    const r = this.record(beneficiaryId);
    r.extraChances += 1;
    r.extraChancesBought += 1;
    r.sponsoredBy.push(payerId);
    const rec = { payerId, beneficiaryId, cost: this.cfg.gulag.extraChanceCost, round, at: now, status: 'settled' };
    this.sponsorships.push(rec);
    this.onEvent({ type: 'gulag.sponsor', ...rec });
    return rec;
  }

  // ── 挑战 ────────────────────────────────────────────────────────────────────────────
  /**
   * 本人能否挑战：古拉格开放中、本人还在押（或有未用的额外机会）、本回合还没挑战过。
   * 永久关闭后一律不能挑战。
   */
  canChallenge(playerId) {
    if (this.permanentlyClosed) return false;
    if (this.state !== GULAG.OPEN && this.state !== GULAG.CHALLENGING) return false;
    const r = this.records.get(playerId);
    if (!r) return false;
    if (r.state === INMATE_STATE.CHALLENGING) return false;
    if (r.challenge && r.challenge.round === (r.challenge.round ?? -1) && r.challenge.outcome === 'pending') return false;
    const g = this.cfg.gulag;
    if (r.state === INMATE_STATE.IN_CUSTODY) return r.chancesUsed < g.normalChances || r.extraChances > 0;
    if (r.state === INMATE_STATE.QUALIFIED_USED) return r.extraChances > 0;
    return false;
  }

  /** 开始一次挑战。返回 { ok, challenge? , reason? }。 */
  startChallenge(playerId, round, questionCount = 0) {
    if (!this.canChallenge(playerId)) return { ok: false, reason: this.permanentlyClosed ? 'gulag-closed' : 'not-eligible' };
    const r = this.record(playerId);
    // 先记「本回合已挑战」，重复点击不会开第二场
    const challenge = {
      playerId, round, questions: questionCount, correct: 0, wrong: 0, startedAt: 0,
      outcome: 'pending', cancelled: false, isExtra: r.state === INMATE_STATE.QUALIFIED_USED || r.chancesUsed >= this.cfg.gulag.normalChances,
    };
    r.challenge = challenge;
    this._setState(r, INMATE_STATE.CHALLENGING);
    this.state = GULAG.CHALLENGING;
    this.challengeLog.push({ playerId, round, at: 0 });
    this.onEvent({ type: 'gulag.challenge.start', playerId, round, isExtra: challenge.isExtra });
    return { ok: true, challenge: { playerId, round, isExtra: challenge.isExtra } };
  }

  /**
   * 提交挑战结果（由服务端的小游戏判定得出；客户端不能决定输赢）。
   * 返回 { ok, chanceUsed, awaitingReturn, reason? }。
   */
  submitChallenge(playerId, { won }, round) {
    const r = this.records.get(playerId);
    if (!r) return { ok: false, reason: 'not-in-gulag' };
    if (!r.challenge || r.challenge.outcome !== 'pending') return { ok: false, reason: 'no-challenge' };
    if (this.permanentlyClosed || r.challenge.cancelled) {
      // 暴动优先：挑战被取消，资格不算已用（但也不给新机会）
      r.challenge.outcome = 'cancelled';
      return { ok: false, reason: 'cancelled' };
    }
    const ch = r.challenge;
    if (ch.isExtra && r.extraChances > 0) r.extraChances -= 1;
    r.chancesUsed += 1;
    ch.outcome = won ? 'won' : 'lost';
    if (won) {
      this._setState(r, INMATE_STATE.AWAITING_RETURN, round);
      r.awaitingSince = round;
      this.state = GULAG.AWAITING_RETURN;
      this.onEvent({ type: 'gulag.challenge.won', playerId, round, isExtra: ch.isExtra });
      return { ok: true, chanceUsed: true, awaitingReturn: true };
    }
    this._setState(r, INMATE_STATE.QUALIFIED_USED);
    this.onEvent({ type: 'gulag.challenge.lost', playerId, round, isExtra: ch.isExtra });
    if (this.state === GULAG.CHALLENGING) this.state = GULAG.OPEN;
    return { ok: true, chanceUsed: true, awaitingReturn: false };
  }

  /** 本回合是否还有人在挑战（CHALLENGING 且未完）。 */
  challengesPending() {
    for (const r of this.records.values()) {
      if (r.state === INMATE_STATE.CHALLENGING && r.challenge && r.challenge.outcome === 'pending' && !r.challenge.cancelled) return true;
    }
    return false;
  }

  /**
   * 主战场结算时取走「本回合应返场」的人：挑战成功的（AWAITING_RETURN）与暴动释放的（RELEASED）。
   * 同一玩家只会被返回一次（返场后状态变为 RETURNED）。
   * 返回 playerId 数组。
   */
  drainReturns(round) {
    const out = [];
    for (const r of this.records.values()) {
      if (r.state !== INMATE_STATE.AWAITING_RETURN && r.state !== INMATE_STATE.RELEASED) continue;
      if (!this._setState(r, INMATE_STATE.RETURNED, round)) continue;
      r.returnedRound = round;
      this._releasedPending.delete(r.playerId);
      out.push(r.playerId);
    }
    out.sort();
    return out;
  }

  /** 本回合开盘结束后：若没人还关着，回到 OPEN。 */
  settleRound(round) {
    if (this.permanentlyClosed) { this.state = GULAG.PERMANENTLY_CLOSED; return; }
    if (this.activeInmates().length) { if (this.state !== GULAG.CHALLENGING) this.state = GULAG.OPEN; return; }
    if (this.pendingReturn().length) { this.state = GULAG.AWAITING_RETURN; return; }
    if (this.everOpened) this.state = GULAG.OPEN;
    void round;
  }
}

/**
 * D20 掷骰器的确定性随机源：注入 rng（server/sim/rng.js 的 createRng 包装）。
 * @param {{next:()=>number}} [rng] 返回 [0,1) 的确定性随机源；缺省时用 Math.random（仅测试/调试）
 */
export function d20Source(rng) {
  const pick = rng || Math.random;
  return {
    /** 返回 1..sides 的整数。 */
    next(sides = 20) {
      const n = Number.isInteger(sides) && sides > 1 ? sides : 20;
      let v;
      try { v = pick(); } catch { v = 0; }
      const x = typeof v === 'function' ? v() : v;
      const f = Number(x);
      const idx = Math.floor((Number.isFinite(f) ? f : 0) * n);
      return Math.min(n, Math.max(1, idx + 1));
    },
  };
}
