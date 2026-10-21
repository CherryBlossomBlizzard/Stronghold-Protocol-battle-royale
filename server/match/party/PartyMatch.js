// server/match/party/PartyMatch.js — 《卫戍协议·神人派对》的回合引擎（服务端权威）。
//
// 这是一个**独立的对局引擎**，不修改 PvE 战斗（server/sim/）的任何一行：它复用同一份游戏数据、
// 同一套房间/网络/断线重连，负责派对层的全部规则。回合流程（设计稿 §3、表 5）：
//
//   1. 战报与事件   REPORT    公开上一轮战果、战役状态、可公开的线索
//   2. 抽牌与市场   MARKET    抽牌、买固定价卡、提交密封竞价
//   3. 谈判与交易   TRADE     资源/线索交易，双方确认后生效
//   4. 同步秘密行动 SECRET    所有玩家同时提交卡牌+目标（超时取安全默认值）
//   5. 响应与反制   RESPONSE  被影响者可提交反制（超时视为不响应）
//   6. 统一结算     RESOLVE   按固定优先级结算，产出公开战报与私人信息
//   7. 主战场       COMBAT    共同 PvE 战役（由外部战役钩子提供结果）
//   8. 计分与线索   SCORE     贡献、任务进度、嫌疑度、战役损失、公开线索
//   古拉格小游戏    GULAG     第 8 回合开放（第 6/8 回合两次 D20 暴动检定）
//
// 平台契约与 Match 相同（见 server/match/Match.js 顶部）：start / handle / onDisconnect / onReconnect /
// onLeave / dispose，消息是 m.* 帧；本引擎新增 m.party.* 公共帧与 m.partyPrivate 私有帧。

import { createRng, deriveSeed } from '../../sim/rng.js';
import { ERR } from '../../../shared/constants.js';
import { normalizePartyConfig, PARTY_PHASE, PARTY_MIN_PLAYERS, PARTY_MAX_PLAYERS, FACTION } from '../../../shared/partyRules.js';
import { cardDef, CARD_TIMING, CARD_TARGET } from '../../../shared/partyCards.js';
import { PartyPlayer } from './PartyPlayer.js';
import { Gulag, d20Source } from './gulag.js';
import { Market } from './market.js';
import { assignFactions, assignObjectives, splitKnownMap, privateRoleView } from './roles.js';
import { effectFor, validateTarget, canPay, pay, resolvePriority, actionCategory, isSplitAction, isInvestigationCard } from './cards.js';
import { checkObjective, checkChallenge, judgeOutcome } from './scoring.js';
import { runChallenge, createChallengeInstance } from './minigames.js';

const OK = { ok: true };
/**
 * 拒绝结果。平台（server/net.js / server/match/Match.js）认 `{ error }`；派对引擎的测试与内部调用
 * 同时看 `ok`，所以两者都带上，避免"拒绝被当成成功"的歧义。
 */
const fail = (error, detail) => {
  const r = { ok: false, error };
  if (detail) r.detail = detail;
  return r;
};

/** 阶段默认时限（秒）——【测试值】，随人数与配置调整。 */
export const PARTY_TIMERS = Object.freeze({
  REPORT: 8,
  MARKET: 45,
  TRADE: 40,
  SECRET: 45,
  RESPONSE: 25,
  RESOLVE: 3,
  SCORE: 8,
  GULAG: 40,
  BRIEFING: 20,
});

/** 引擎内部使用的时限表；opts.timerScale 可整体缩放（测试与快速联调用）。 */
function timerTable(scale) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (s === 1) return PARTY_TIMERS;
  const out = {};
  for (const [k, v] of Object.entries(PARTY_TIMERS)) out[k] = Math.max(0.05, v * s);
  return out;
}

export class PartyMatch {
  /**
   * @param {object} opts 与 Match 的平台契约一致，另加：
   * @param {object} [opts.partyConfig]      房主的派对设置（会被 normalizePartyConfig 合法化）
   * @param {number} [opts.rounds]           主战场回合数上限（默认沿用战斗数据的首领回合前一轮）
   * @param {object} [opts.campaign]         战役钩子：{ roundInfo(round) } 或由外部调用 setCampaignResult
   */
  constructor(opts) {
    if (!opts || !Array.isArray(opts.seats) || !opts.seats.length) throw new TypeError('PartyMatch: seats required');
    if (typeof opts.send !== 'function' || typeof opts.broadcast !== 'function' || typeof opts.onEnd !== 'function') {
      throw new TypeError('PartyMatch: send/broadcast/onEnd callbacks required');
    }
    this.opts = opts;
    this.roomCode = opts.roomCode ?? '----';
    this.seed = (Number(opts.seed) >>> 0) || 1;
    this.log = opts.log || { info() {}, warn() {}, error() {}, debug() {} };
    this.sendFn = opts.send;
    this.broadcastFn = opts.broadcast;
    this.onEndFn = opts.onEnd;
    this.now = typeof opts.now === 'function' ? opts.now : Date.now;
    this.cfg = normalizePartyConfig(opts.partyConfig);
    /** 主战场回合数 */
    this.maxRounds = Number.isInteger(opts.rounds) && opts.rounds > 0 ? opts.rounds : 12;
    /** 阶段时限（秒），opts.timerScale 可整体缩放 */
    this.timers = timerTable(opts.timerScale);

    // 随机源：全部确定性，同一 seed 可复现
    const rngOf = (salt) => createRng(deriveSeed(this.seed, salt));
    this.rng = rngOf('party');
    this.rngMarket = rngOf('party-market');
    this.rngDice = d20Source(rngOf('party-dice'));
    this.rngMini = rngOf('party-mini');

    this.phase = PARTY_PHASE.BRIEFING;
    this.round = 0;
    this.ended = false;
    this.disposed = false;
    this.startedAt = this.now();
    this.deadline = 0;
    this._timers = new Set();
    this._phaseTimer = null;
    /** 幂等：请求 id → 结果（跨阶段防重复提交/重复扣费） */
    this._requests = new Map();
    /** 公开战报（本轮） */
    this.publicLog = [];
    /** 内部审计日志（绝不外发） */
    this.auditLog = [];
    /** 本轮行动（结算前） */
    this.roundActions = [];
    /** 玩家行动类别记录：playerId → Set<'pvp'|'trade'|'prank'|'action'> */
    this.actionLog = new Map();
    /** 本轮是否有裂盟行动的玩家 */
    this.splitActionsThisRound = new Set();
    /** 玩家配对互刷冷却：`a|b` → 最后一次计入的回合 */
    this._pairCooldown = new Map();
    /** 本轮目标承受的高风险次数：targetId → count */
    this._highRiskCount = new Map();
    /** 待生效的团队防护/议案等 */
    this.pendingMotions = [];
    this.teamGuard = 0;
    /** 本局战役状态 */
    this.campaign = { victory: false, reason: '', history: [] };
    /** 结算结果 */
    this.outcome = null;
    this.roundScores = [];

    // 玩家
    this.players = new Map();
    const order = [];
    for (const s of opts.seats) {
      if (!s || typeof s.playerId !== 'string' || this.players.has(s.playerId)) continue;
      order.push(s);
    }
    order.sort((a, b) => (a.seat || 0) - (b.seat || 0));
    for (const s of order) {
      this.players.set(s.playerId, new PartyPlayer({
        playerId: s.playerId, seat: s.seat || 0, name: s.name || s.playerId,
        isBot: !!s.isBot, cfg: this.cfg, rng: this.rng,
      }));
    }
    if (!this.players.size) throw new TypeError('PartyMatch: seats required');
    // 人数下限：服务端与协议、前端座位界面保持一致（PARTY_MIN_PLAYERS）
    if (this.players.size < PARTY_MIN_PLAYERS) {
      throw new TypeError(`PartyMatch: at least ${PARTY_MIN_PLAYERS} seats required (got ${this.players.size})`);
    }
    if (this.players.size > PARTY_MAX_PLAYERS) {
      throw new TypeError(`PartyMatch: at most ${PARTY_MAX_PLAYERS} seats allowed (got ${this.players.size})`);
    }
    this.order = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    for (const p of this.order) this.actionLog.set(p.playerId, new Set());

    // 古拉格
    this.gulag = new Gulag({
      cfg: this.cfg,
      rng: this.rngDice,
      onEvent: (e) => this._onGulagEvent(e),
    });
    // 市场
    this.market = new Market({
      cfg: this.cfg,
      rng: this.rngMarket,
      onEvent: (e) => this._audit(e),
    });
  }

  // ── 平台契约 ────────────────────────────────────────────────────────────────────────

  start() {
    this._assignRoles();
    this.enterBriefing();
  }

  handle(playerId, msg) {
    if (this.ended) return fail(ERR.WRONG_PHASE, 'match ended');
    const ps = this.players.get(playerId);
    if (!ps) return fail(ERR.NOT_IN_ROOM);
    try {
      return this._route(playerId, ps, msg);
    } catch (e) {
      this.log.error?.(`PartyMatch.handle ${playerId}`, e);
      return fail(ERR.INTERNAL, String(e && e.message ? e.message : e));
    }
  }

  onDisconnect(playerId) {
    const ps = this.players.get(playerId);
    if (!ps) return;
    ps.connected = false;
    this.markPublic();
  }

  onReconnect(playerId) {
    const ps = this.players.get(playerId);
    if (!ps) return;
    ps.connected = true;
    this.sendPrivate(ps);
    this.sendPublic(ps.playerId);
  }

  onLeave(playerId) {
    const ps = this.players.get(playerId);
    if (!ps) return;
    ps.connected = false;
    ps.markLeft();
    // 中途退出：已提交的行动作废，但古拉格资格与计分记录保留
    ps.pendingActions = [];
    ps.pendingResponses = [];
    this.markPublic();
    this.maybeAdvance();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._clearTimer();
    for (const t of this._timers) { try { clearTimeout(t); } catch { /* ignore */ } }
    this._timers.clear();
  }

  // ── 路由 ────────────────────────────────────────────────────────────────────────────

  _route(playerId, ps, msg) {
    const t = msg && msg.t;
    switch (t) {
      case 'g.party': return this._intent(ps, msg);
      case 'g.partyChallenge': return this._challengeIntent(ps, msg);
      default: return fail(ERR.BAD_MSG, `unknown party intent ${t}`);
    }
  }

  /**
   * g.party { op, ...payload } —— 全部派对操作都走这一个消息，op 决定语义。
   * requestId 用于幂等（同一 id 只处理一次；返回第一次的结果）。
   */
  _intent(ps, msg) {
    const op = msg.op;
    const requestId = msg.requestId ? String(msg.requestId).slice(0, 64) : '';
    if (requestId) {
      const key = `${ps.playerId}:${op}:${requestId}`;
      if (this._requests.has(key)) return this._requests.get(key);
    }
    let result;
    switch (op) {
      case 'ready': result = this._opReady(ps); break;
      case 'draw': result = this._opDraw(ps); break;
      case 'buy': result = this._opBuy(ps, msg); break;
      case 'bid': result = this._opBid(ps, msg); break;
      case 'tradeOffer': result = this._opTradeOffer(ps, msg); break;
      case 'tradeAccept': result = this._opTradeAccept(ps, msg); break;
      case 'tradeCancel': result = this._opTradeCancel(ps, msg); break;
      case 'play': result = this._opPlay(ps, msg); break;
      case 'respond': result = this._opRespond(ps, msg); break;
      case 'pass': result = this._opPass(ps); break;
      case 'sponsor': result = this._opSponsor(ps, msg); break;
      case 'accuse': result = this._opAccuse(ps, msg); break;
      default: result = fail(ERR.BAD_MSG, `unknown party op ${op}`);
    }
    if (requestId && result && result.ok) this._requests.set(`${ps.playerId}:${op}:${requestId}`, result);
    return result;
  }

  // ── 身份分配 ────────────────────────────────────────────────────────────────────────

  _assignRoles() {
    const ids = this.order.map((p) => p.playerId);
    const factions = assignFactions(ids, this.rng, this.cfg);
    const objectives = assignObjectives(factions, ids, this.rng);
    const known = splitKnownMap(factions, ids, this.cfg.splitKnowledge);
    this.factions = factions;
    this.objectives = objectives;
    this.knownSplits = known;
    for (const p of this.order) {
      p.faction = factions.get(p.playerId);
      const o = objectives.get(p.playerId) || {};
      p.objectiveId = o.objectiveId || null;
      p.challengeId = o.challengeId || null;
      p.knownSplits = (known.get(p.playerId) || []).slice();
      p.connected = p.connected !== false;
    }
  }

  // ── 阶段推进 ────────────────────────────────────────────────────────────────────────

  enterBriefing() {
    this.phase = PARTY_PHASE.BRIEFING;
    this._setDeadline(this.timers.BRIEFING, () => this.enterRound());
    this.markPublic();
    this.flush(true);
    this.maybeAdvance();
  }

  /** 开始一轮（round 从 1 开始）。 */
  enterRound() {
    this._clearTimer();
    this.round += 1;
    if (this.round > this.maxRounds) { this.finish({ victory: this.campaign.victory, reason: 'rounds-exhausted' }); return; }
    this.roundActions = [];
    this.pendingMotions = [];
    this.splitActionsThisRound = new Set();
    this._highRiskCount.clear();
    this.publicLog = [];
    this.teamGuard = 0;

    // 回合开始：发收入（先于古拉格检定，保证资助时有钱可花）
    for (const p of this.order) {
      p.beginRound(this.round);
      if (p.left) continue;
      p.collectIncome();
      p.trimHand();
    }

    // 古拉格：第 6 回合 D20 检定；第 8 回合第二次检定 + 开放
    this._gulagRoundEvents = this.gulag.beginRound(this.round);

    this.enterReport();
  }

  enterReport() {
    this.phase = PARTY_PHASE.REPORT;
    // 公开上一轮战果与可公开线索
    this._setDeadline(this.timers.REPORT, () => this.enterMarket());
    this.markPublic();
    this.markAllPrivate();
    this.maybeAdvance();
  }

  enterMarket() {
    this.phase = PARTY_PHASE.MARKET;
    const alive = this.order.filter((p) => !p.left).map((p) => p.playerId);
    this.market.openRound(this.round, alive);
    // 抽牌
    for (const p of this.order) {
      if (p.left) continue;
      p.drewThisRound = p.draw(this.cfg.deck.drawPerRound, this.rng).length;
      p.trimHand();
    }
    this.ready = new Set();
    this._setDeadline(this.timers.MARKET, () => this.enterTrade());
    this.markPublic();
    this.markAllPrivate();
    this.maybeAdvance();
  }

  enterTrade() {
    this.phase = PARTY_PHASE.TRADE;
    this.trades = new Map();
    this._tradeSeq = 0;
    this.ready = new Set();
    this._setDeadline(this.timers.TRADE, () => this.enterSecret());
    this.markPublic();
    this.markAllPrivate();
    this.maybeAdvance();
  }

  enterSecret() {
    this.phase = PARTY_PHASE.SECRET;
    this.ready = new Set();
    this._setDeadline(this.timers.SECRET, () => this.endSecret());
    this.markPublic();
    this.markAllPrivate();
    this.maybeAdvance();
  }

  /** 秘密行动截止 → 进入响应阶段（按结算优先级生成待响应列表）。 */
  endSecret() {
    this._clearTimer();
    this._autoDefaultActions();
    // 冻结本轮行动（客户端不再能改）
    this._frozenActions = this.roundActions.slice();
    this.phase = PARTY_PHASE.RESPONSE;
    this.ready = new Set();
    this._responses = [];
    this._setDeadline(this.timers.RESPONSE, () => this.resolveRound());
    this.markPublic();
    this.markAllPrivate();
    this.maybeAdvance();
  }

  /** 统一结算。 */
  resolveRound() {
    this._clearTimer();
    const entries = this._frozenActions || this.roundActions.slice();
    // 固定优先级：反制 → 侦查 → 交易 → 高风险 → 破坏 → 纯收益
    const sorted = entries
      .map((a) => ({ a, prio: resolvePriority(cardDef(a.cardId), a) }))
      .sort((x, y) => (x.prio - y.prio) || (x.a.seq - y.a.seq));
    const counters = new Map(); // againstId → 反制列表
    for (const r of this._responses || []) {
      const key = r.againstId;
      if (!counters.has(key)) counters.set(key, []);
      counters.get(key).push(r);
    }

    const results = [];
    for (const { a } of sorted) {
      // 被反制掉的行动：不生效
      const cs = counters.get(a.id) || [];
      if (cs.length) {
        const applier = cs[0];
        this._applyCounter(a, applier, results);
        continue;
      }
      // 重复/失效的目标：直接跳过
      const target = a.targetId ? this.players.get(a.targetId) : null;
      if (a.targetId && (!target || target.left)) {
        results.push({ actionId: a.id, actorId: a.actorId, cardId: a.cardId, applied: false, reason: 'target-invalid' });
        continue;
      }
      const outcome = this._applyAction(a, target);
      results.push({ actionId: a.id, actorId: a.actorId, cardId: a.cardId, ...outcome });
    }

    // 密封竞价结算（统一比较，最高有效出价者获卡）
    const sealed = this.market.settleSealed(this.order.map((p) => p.playerId), this.players);
    for (const s of sealed) {
      if (!s.winnerId) continue;
      const w = this.players.get(s.winnerId);
      if (w) this._grantCard(w, s.cardId, 'sealed');
    }

    // 公共议案 / 派对挑战投票的结算
    this._settleVotes();

    this._resolveResults = results;
    this._resolveSealed = sealed;
    this.phase = PARTY_PHASE.RESOLVE;
    this._setDeadline(this.timers.RESOLVE, () => this.enterCombat());
    this.markPublic();
    this.markAllPrivate();
    this.maybeAdvance();
  }

  /** 进入主战场（共同 PvE 战役）。战役结果由外部钩子提供（或自动按回合推演）。 */
  enterCombat() {
    this._clearTimer();
    // 主战场结算前：先处理"上一次主战场结算时返场"的古拉格名单
    this._returnPendingInmates();
    this.phase = 'PARTY_COMBAT';
    this.campaignPending = true;
    this._setDeadline(0); // 不限时：等战役钩子回调 setCampaignResult
    this.markPublic();
    this.markAllPrivate();
    this._requestCampaignResult();
  }

  /**
   * 战役钩子：战役结果回来（true = 守住，false = 失守）。
   * 也接受 reason 说明（用于计分与战报）。**幂等**：同一回合只认第一次。
   */
  setCampaignResult(round, victory, reason = '') {
    if (this.ended || !this.campaignPending || round !== this.round) return false;
    this.campaignPending = false;
    const entry = { round, victory: !!victory, reason: String(reason || '') };
    this.campaign.history.push(entry);
    if (!victory) this.campaign.reason = entry.reason || 'line-lost';
    this.campaign.victory = this.campaign.victory || !!victory;
    // 战役生命（用失守次数近似）
    this.campaignLosses = (this.campaignLosses || 0) + (victory ? 0 : 1);
    if (victory) for (const p of this.order) if (!p.left) p.stats.perfectRounds += 1;
    // 主战场结算：在此之后才处理淘汰 → 入狱
    this._applyEliminations();
    this.phase = 'PARTY_SCORE';
    this._setDeadline(this.timers.SCORE, () => this.enterGulagOrNext());
    this.markPublic();
    this.markAllPrivate();
    this.maybeAdvance();
    return true;
  }

  /** 战役结算后：如果第 8 回合（含）之后且有在押者，进入古拉格小游戏。 */
  enterGulagOrNext() {
    this._clearTimer();
    const hasInmates = this.gulag.activeInmates().length > 0;
    const opened = this.cfg.gulag.openRound;
    if (hasInmates && !this.gulag.permanentlyClosed && this.round >= opened) {
      this._enterGulag();
      return;
    }
    this.gulag.settleRound(this.round);
    this._nextRoundOrEnd();
  }

  _enterGulag() {
    this.phase = PARTY_PHASE.GULAG;
    this._challenges = new Map();
    // 给人机囚犯自动挑战（服务端判定，结果与小游戏同一套判定）
    this._setDeadline(this.timers.GULAG, () => this._closeGulag());
    this.markPublic();
    this.markAllPrivate();
    this._autoBotChallenges();
    this.maybeAdvance();
  }

  _closeGulag() {
    // 超时：未挑战的按未参与处理（不能自动获胜）
    for (const r of this.gulag.activeInmates()) {
      if (r.challenge && r.challenge.outcome === 'pending') {
        this._submitChallengeResult(r.playerId, false);
      }
    }
    this.gulag.settleRound(this.round);
    this._nextRoundOrEnd();
  }

  _nextRoundOrEnd() {
    // 全员被淘汰 / 回合用尽 → 结束
    const alive = this.order.filter((p) => !p.left);
    if (!alive.length) { this.finish({ victory: false, reason: 'all-eliminated' }); return; }
    if (this.round >= this.maxRounds) { this.finish({ victory: this.campaign.victory, reason: 'rounds-exhausted' }); return; }
    this.enterRound();
  }

  /** 主战场结算：把战役失守记到玩家身上，并按古拉格规则安排入狱。 */
  _applyEliminations() {
    const last = this.campaign.history[this.campaign.history.length - 1];
    if (!last || last.victory) return;
    // 失守：每名存活玩家损失一定战役生命（这里用失守次数表示，不模拟具体数值）
    for (const p of this.order) {
      if (p.left) continue;
      p.stats.campaignLosses = (p.stats.campaignLosses || 0) + 1;
    }
  }

  /** 每名玩家手动「认输」/被淘汰的入口（由战役钩子或测试调用）。 */
  eliminatePlayer(playerId, reason = 'campaign') {
    const p = this.players.get(playerId);
    if (!p || p.left || p.eliminated) return false;
    p.eliminated = true;
    p.stats.jailed += 1;
    const res = this.gulag.jail(playerId, this.round);
    this._publicEvent({ kind: 'eliminated', playerId, reason, jailed: res.jailed });
    this._audit({ type: 'eliminate', playerId, round: this.round, reason, jailed: res.jailed });
    this.markPublic();
    return res.jailed;
  }

  /** 主战场结算时统一返场（幂等：drainReturns 保证每人只返一次）。 */
  _returnPendingInmates() {
    const ids = this.gulag.drainReturns(this.round);
    for (const id of ids) {
      const p = this.players.get(id);
      if (!p) continue;
      p.eliminated = false;
      p.stats.reentered = true;
      this._publicEvent({ kind: 'gulag.return', playerId: id, round: this.round });
    }
    if (ids.length) this.markPublic();
  }

  // ── 操作：通用 ──────────────────────────────────────────────────────────────────────

  _opReady(ps) {
    if (!this.ready) this.ready = new Set();
    this.ready.add(ps.playerId);
    this.markPublic();
    this.maybeAdvance();
    return OK;
  }

  _opPass(ps) {
    if (this.phase === PARTY_PHASE.SECRET) {
      ps.ready = true;
      this.ready.add(ps.playerId);
    }
    this.maybeAdvance();
    return OK;
  }

  // ── 操作：抽牌 / 市场 ───────────────────────────────────────────────────────────────

  _opDraw(ps) {
    if (this.phase !== PARTY_PHASE.MARKET) return fail(ERR.WRONG_PHASE);
    if (ps.left) return fail(ERR.ELIMINATED);
    const n = this.cfg.deck.drawPerRound;
    const got = ps.draw(n, this.rng);
    ps.trimHand();
    this.markPrivate(ps);
    return { ok: true, drawn: got.length };
  }

  _opBuy(ps, msg) {
    if (this.phase !== PARTY_PHASE.MARKET) return fail(ERR.WRONG_PHASE);
    if (ps.left) return fail(ERR.ELIMINATED);
    const res = this.market.buyFixed(ps.playerId, msg.slot, msg.requestId || '', ps);
    if (!res.ok) return fail(this._marketErr(res.reason), res.reason);
    this._grantCard(ps, res.cardId, 'fixed');
    this.markPrivate(ps);
    this.markPublic();
    return { ok: true, cardId: res.cardId, price: res.price };
  }

  _opBid(ps, msg) {
    if (this.phase !== PARTY_PHASE.MARKET) return fail(ERR.WRONG_PHASE);
    if (ps.left) return fail(ERR.ELIMINATED);
    const res = this.market.placeBid(ps.playerId, msg.slot, msg.amount, msg.requestId || '', ps);
    if (!res.ok) return fail(this._marketErr(res.reason), res.reason);
    this._audit({ type: 'bid', playerId: ps.playerId, slot: msg.slot, amount: res.amount, round: this.round });
    this.markPrivate(ps);
    this.markPublic();
    return { ok: true, slot: res.slot, amount: res.amount };
  }

  _marketErr(reason) {
    switch (reason) {
      case 'cannot-afford': return ERR.NO_FUNDS;
      case 'sold-out': return ERR.SOLD_OUT;
      case 'fixed-limit-reached': case 'already-bid': return ERR.ALREADY;
      case 'no-such-slot': case 'not-fixed-price': case 'not-sealed':
      case 'bid-too-low': return ERR.BAD_TARGET;
      default: return ERR.BAD_TARGET;
    }
  }

  _grantCard(ps, cardId, via) {
    if (!cardId) return null;
    const { nextCardUid } = this._uidModule || {};
    void nextCardUid;
    const card = { uid: `p${++this._cardSeq || (this._cardSeq = 1, this._cardSeq)}`, cardId };
    const replaced = ps.addCard(card);
    this._audit({ type: 'grant-card', playerId: ps.playerId, cardId, via, round: this.round });
    if (replaced) this.markPrivate(ps);
    return card;
  }

  // ── 操作：交易 ──────────────────────────────────────────────────────────────────────

  _opTradeOffer(ps, msg) {
    if (this.phase !== PARTY_PHASE.TRADE) return fail(ERR.WRONG_PHASE);
    if (ps.left) return fail(ERR.ELIMINATED);
    const target = this.players.get(msg.targetId);
    if (!target || target.playerId === ps.playerId || target.left) return fail(ERR.BAD_TARGET);
    const give = this._validTradeAssets(msg.give);
    const want = this._validTradeAssets(msg.want);
    if (give === null || want === null) return fail(ERR.BAD_TARGET, 'bad trade assets');
    if (!give.length && !want.length) return fail(ERR.BAD_TARGET, 'empty trade');
    // 身份、秘密任务与核心战斗阵容默认不可交易（设计稿 §5.1）：资产只接受 tickets/intel/influence/clue
    if (!this._ownsAssets(ps, give)) return fail(ERR.BAD_TARGET, 'give assets not owned');
    if (!this._ownsAssets(target, want)) return fail(ERR.BAD_TARGET, 'want assets not owned');
    const id = `t${++this._tradeSeq}`;
    this.trades.set(id, { id, fromId: ps.playerId, toId: target.playerId, give, want, round: this.round, status: 'pending' });
    this._audit({ type: 'trade-offer', id, fromId: ps.playerId, toId: target.playerId, round: this.round });
    this.sendPrivate(target);
    return { ok: true, tradeId: id };
  }

  _validTradeAssets(list) {
    if (list == null) return [];
    if (!Array.isArray(list) || list.length > 6) return null;
    const out = [];
    for (const a of list) {
      if (!a || typeof a !== 'object') return null;
      if (!['tickets', 'intel', 'influence'].includes(a.resource)) return null;
      const amount = Math.floor(Number(a.amount));
      if (!Number.isInteger(amount) || amount <= 0 || amount > 20) return null;
      out.push({ resource: a.resource, amount });
    }
    return out;
  }

  _ownsAssets(p, list) {
    const sum = { tickets: 0, intel: 0, influence: 0 };
    for (const a of list) sum[a.resource] += a.amount;
    for (const [k, v] of Object.entries(sum)) if (p[k] < v) return false;
    return true;
  }

  _opTradeAccept(ps, msg) {
    if (this.phase !== PARTY_PHASE.TRADE) return fail(ERR.WRONG_PHASE);
    const tr = this.trades && this.trades.get(msg.tradeId);
    if (!tr) return fail(ERR.BAD_TARGET, 'no such trade');
    if (tr.toId !== ps.playerId) return fail(ERR.BAD_TARGET, 'not your trade');
    if (tr.status !== 'pending') return fail(ERR.ALREADY);
    const from = this.players.get(tr.fromId);
    if (!from || from.left) { tr.status = 'failed'; return fail(ERR.BAD_TARGET, 'offerer left'); }
    if (!this._ownsAssets(from, tr.give) || !this._ownsAssets(ps, tr.want)) return fail(ERR.NO_FUNDS, 'assets changed');
    // 双方确认后生效：一次转账，对称扣与加
    for (const a of tr.give) { from[a.resource] -= a.amount; ps[a.resource] += a.amount; }
    for (const a of tr.want) { ps[a.resource] -= a.amount; from[a.resource] += a.amount; }
    tr.status = 'settled';
    from.stats.trades += 1;
    ps.stats.trades += 1;
    this.actionLog.get(from.playerId)?.add('trade');
    this.actionLog.get(ps.playerId)?.add('trade');
    this._audit({ type: 'trade-settled', id: tr.id, fromId: tr.fromId, toId: tr.toId, give: tr.give, want: tr.want, round: this.round });
    this._publicEvent({ kind: 'trade', fromId: tr.fromId, toId: tr.toId, round: this.round });
    this.markPrivate(from);
    this.markPrivate(ps);
    this.markPublic();
    return { ok: true, tradeId: tr.id };
  }

  _opTradeCancel(ps, msg) {
    const tr = this.trades && this.trades.get(msg.tradeId);
    if (!tr) return fail(ERR.BAD_TARGET);
    if (tr.fromId !== ps.playerId && tr.toId !== ps.playerId) return fail(ERR.BAD_TARGET);
    if (tr.status !== 'pending') return fail(ERR.ALREADY);
    tr.status = 'cancelled';
    this._audit({ type: 'trade-cancelled', id: tr.id, by: ps.playerId, round: this.round });
    return OK;
  }

  // ── 操作：秘密行动 / 响应 ───────────────────────────────────────────────────────────

  _opPlay(ps, msg) {
    if (this.phase !== PARTY_PHASE.SECRET) return fail(ERR.WRONG_PHASE);
    if (ps.left) return fail(ERR.ELIMINATED);
    if (ps.playsThisRound >= this.cfg.deck.maxPlaysPerRound) return fail(ERR.ALREADY, 'play limit');
    const card = ps.hand.find((c) => c.uid === msg.uid);
    if (!card) return fail(ERR.BAD_TARGET, 'card not in hand');
    const def = cardDef(card.cardId);
    if (!def) return fail(ERR.BAD_MSG, 'unknown card');
    if (def.timing === CARD_TIMING.RESPONSE) return fail(ERR.WRONG_PHASE, 'counter cards go to the response phase');
    // 每局/每轮限制
    if (def.perGameLimit && (ps.stats[`used_${def.id}`] || 0) >= def.perGameLimit) return fail(ERR.ALREADY);
    if (def.perRoundLimit && (ps.stats[`usedR_${def.id}`] || 0) >= def.perRoundLimit) return fail(ERR.ALREADY);
    if (!canPay(ps, def.cost)) return fail(ERR.NO_FUNDS);
    const tv = validateTarget({ cardId: def.id, targetId: msg.targetId }, ps.playerId, this.players);
    if (!tv.ok) return fail(ERR.BAD_TARGET, tv.reason);
    if (def.target === CARD_TARGET.PLAYER && def.highRisk) {
      const n = this._highRiskCount.get(tv.targetId) || 0;
      if (n >= this.cfg.pvp.maxHighRiskPerTargetPerRound) return fail(ERR.ALREADY, 'target already hit by a high-risk effect this round');
      this._highRiskCount.set(tv.targetId, n + 1);
    }
    const ctx = this._cardContext(ps.playerId);
    const exec = effectFor(def);
    if (!exec) return fail(ERR.BAD_MSG, 'card has no effect');
    const res = exec(ctx, {
      actorId: ps.playerId, targetId: tv.targetId, target: tv.target || (tv.targetId ? this.players.get(tv.targetId) : null),
      def, extra: msg.extra,
    });
    if (!res.ok) return fail(ERR.BAD_TARGET, res.reason);

    // 扣费与出手：只有通过全部校验后才发生
    pay(ps, def.cost);
    ps.takeFromHand(card.uid);
    ps.discard.push(card);
    ps.playsThisRound += 1;
    if (def.perGameLimit) ps.stats[`used_${def.id}`] = (ps.stats[`used_${def.id}`] || 0) + 1;
    if (def.perRoundLimit) ps.stats[`usedR_${def.id}`] = (ps.stats[`usedR_${def.id}`] || 0) + 1;
    if (def.kind === 'PRANK') ps.stats.pranksPlayed += 1;
    if (isInvestigationCard(def.id)) ps.stats.investigations += 1;
    const cat = actionCategory(def);
    if (cat) this.actionLog.get(ps.playerId)?.add(cat);
    const action = {
      id: `a${this.roundActions.length + 1}`, seq: this.roundActions.length, actorId: ps.playerId,
      cardId: def.id, targetId: tv.targetId || null, round: this.round, effects: res.effects || [], trace: res.trace || null,
      publicLog: res.publicLog || null, split: isSplitAction(def),
    };
    this.roundActions.push(action);
    ps.pendingActions.push(action.id);
    if (action.split) this.splitActionsThisRound.add(ps.playerId);
    if (action.split && ps.faction === FACTION.SPLIT) ps.stats.splitActions += 1;
    this._audit({ type: 'play', ...action, round: this.round });
    if (action.publicLog) this._publicEvent({ kind: 'action', ...action.publicLog, round: this.round });
    this.markPrivate(ps);
    this.markPublic();
    return { ok: true, actionId: action.id };
  }

  /** 响应阶段：提交一张反制卡，抵消针对自己的某个行动。 */
  _opRespond(ps, msg) {
    if (this.phase !== PARTY_PHASE.RESPONSE) return fail(ERR.WRONG_PHASE);
    if (ps.left) return fail(ERR.ELIMINATED);
    if (ps.responsesThisRound >= 1) return fail(ERR.ALREADY, 'one response per round');
    const card = ps.hand.find((c) => c.uid === msg.uid);
    if (!card) return fail(ERR.BAD_TARGET, 'card not in hand');
    const def = cardDef(card.cardId);
    if (!def || def.timing !== CARD_TIMING.RESPONSE) return fail(ERR.BAD_TARGET, 'not a counter card');
    const against = (this._frozenActions || []).find((a) => a.id === msg.againstActionId);
    if (!against) return fail(ERR.BAD_TARGET, 'no such action');
    // 只能反制针对自己的行动（或影响全队的行动）
    const affectsMe = against.targetId === ps.playerId || (!against.targetId);
    if (!affectsMe) return fail(ERR.BAD_TARGET, 'not targeting you');
    if (def.perRoundLimit && (ps.stats[`usedR_${def.id}`] || 0) >= def.perRoundLimit) return fail(ERR.ALREADY);
    if (!canPay(ps, def.cost)) return fail(ERR.NO_FUNDS);
    const exec = effectFor(def);
    if (!exec) return fail(ERR.BAD_MSG);
    const res = exec(this._cardContext(ps.playerId), {
      actorId: ps.playerId, againstId: against.actorId, actionId: against.id, targetId: against.targetId, def, extra: msg.extra,
    });
    if (!res.ok) return fail(ERR.BAD_TARGET, res.reason);
    pay(ps, def.cost);
    ps.takeFromHand(card.uid);
    ps.discard.push(card);
    ps.responsesThisRound += 1;
    if (def.perRoundLimit) ps.stats[`usedR_${def.id}`] = (ps.stats[`usedR_${def.id}`] || 0) + 1;
    this._responses.push({ id: `r${this._responses.length + 1}`, againstId: against.id, againstActorId: against.actorId, byId: ps.playerId, cardId: def.id, effects: res.effects || [] });
    this._audit({ type: 'response', againstId: against.id, by: ps.playerId, cardId: def.id, round: this.round });
    this.markPrivate(ps);
    this.markPublic();
    return { ok: true };
  }

  /** 秘密行动超时：替未提交的玩家取安全默认值（不做事），不代替他们出牌。 */
  _autoDefaultActions() {
    // 安全默认：不提交任何行动；牌留在手里。这是设计稿「超时按安全默认值处理」的最保守实现。
    for (const p of this.order) {
      if (p.left) continue;
      p.ready = true;
    }
  }

  /** 卡牌效果执行上下文（一次性快照；actor 是发起这次行动的玩家）。 */
  _cardContext(actorId = null) {
    return {
      round: this.round,
      actor: actorId ? this.players.get(actorId) : null,
      actorById: this.players,
      players: this.players,
      rng: this.rng,
      splitActionsThisRound: this.splitActionsThisRound,
      actionLog: this.actionLog,
      cfg: this.cfg,
    };
  }

  /** 应用一个未被反制的行动。 */
  _applyAction(a, target) {
    const out = { applied: true };
    for (const eff of a.effects || []) {
      switch (eff.type) {
        case 'stripIncome': {
          const t = this.players.get(eff.targetId);
          if (t) t.incomeStrips.push({ resource: eff.resource, amount: eff.amount, round: this.round + 1 });
          break;
        }
        case 'motion':
          this.pendingMotions.push({ actorId: eff.actorId, gainIntel: eff.gainIntel, round: this.round, kind: 'motion' });
          break;
        case 'addClue': {
          const t = this.players.get(eff.targetId);
          if (t) t.addClue({ ...eff.clue, round: this.round });
          break;
        }
        case 'addSuspicion': {
          const t = this.players.get(eff.targetId);
          if (t) t.suspicion += eff.amount;
          break;
        }
        case 'swapTarget': {
          const actor = this.players.get(eff.actorId);
          const other = this.players.get(eff.targetId);
          if (actor && other && actor.pendingActions.length && other.pendingActions.length) {
            const mine = this.roundActions.find((x) => x.id === actor.pendingActions[0]);
            const theirs = this.roundActions.find((x) => x.id === other.pendingActions[0]);
            if (mine && theirs) { const tmp = mine.targetId; mine.targetId = theirs.targetId; theirs.targetId = tmp; }
          }
          break;
        }
        case 'lottery': {
          const winner = this.players.get(eff.winner);
          if (winner) winner.tickets = Math.min(this.cfg.resources.tickets.cap, winner.tickets + eff.stake);
          break;
        }
        case 'reverseVote':
          this.pendingMotions.push({ actorId: eff.actorId, merit: eff.merit, round: this.round, kind: 'reverse' });
          break;
        case 'bounty': {
          const t = this.players.get(eff.targetId);
          if (t) t.suspicion += 1;
          this.pendingMotions.push({ actorId: eff.actorId, targetId: eff.targetId, merit: eff.merit, intel: eff.intel, round: this.round, kind: 'bounty' });
          break;
        }
        case 'privateIntel': {
          const to = this.players.get(eff.toId);
          if (to) to.addClue({ kind: 'reliable', source: 'investigation', text: `调查结果：${eff.key}=${JSON.stringify(eff.answer)}`, round: this.round, secret: true });
          break;
        }
        case 'publicFact':
          this.pendingMotions.push({ kind: 'fact', subjectId: eff.subjectId, fact: eff.fact, round: this.round });
          break;
        case 'verifyClues': {
          const p = this.players.get(eff.playerId);
          if (p) { for (const c of p.clues.slice(-2)) c.verified = true; }
          break;
        }
        case 'clueSwap': {
          const a1 = this.players.get(eff.actorId);
          const a2 = this.players.get(eff.targetId);
          if (a1 && a2) {
            a1.intel = Math.max(0, a1.intel - 1); a2.intel = Math.max(0, a2.intel - 1);
            const last = a2.clues[a2.clues.length - 1];
            if (last) a1.addClue({ ...last, source: 'trade' });
          }
          a1 && (a1.stats.trades += 1); if (a2) a2.stats.trades += 1;
          break;
        }
        case 'transfer': {
          const from = this.players.get(eff.fromId);
          const to = this.players.get(eff.toId);
          if (from && to) {
            const amt = Math.min(from[eff.resource] || 0, eff.amount);
            from[eff.resource] -= amt;
            to[eff.resource] = Math.min(this.cfg.resources[eff.resource]?.cap || 99, to[eff.resource] + amt);
          }
          break;
        }
        case 'grantMerit': {
          const p = this.players.get(eff.playerId);
          if (p) { p.merit += eff.merit; if (eff.costTickets) p.tickets = Math.max(0, p.tickets - eff.costTickets); }
          break;
        }
        case 'partyVote':
          this.pendingMotions.push({ kind: `vote:${eff.kind}`, actorId: eff.actorId, round: this.round, params: eff.params || {} });
          if (this.players.get(eff.actorId)) this.players.get(eff.actorId).stats.partyChallenges += 1;
          break;
        case 'counter':
          // 结算阶段的 counter 只应该出现在响应里；这里忽略
          break;
        default:
          break;
      }
    }
    if (a.trace) this._audit({ type: 'trace', ...a.trace });
    void target;
    return out;
  }

  /** 反制生效：被反制的行动不产生任何效果。 */
  _applyCounter(action, counter, results) {
    const def = cardDef(counter.cardId);
    const okMode = {
      cancelFake: ['falseClue'],
      cancelSwap: ['swapTarget'],
      cancelTransfer: ['transfer', 'ultimatum', 'stripIncome'],
      cancelCampaignMalus: ['partyVote', 'grantMerit'],
    }[def?.effect] || [];
    const actDef = cardDef(action.cardId);
    const effective = okMode.includes(actDef?.effect);
    if (effective) {
      this.players.get(counter.byId).stats.countersWon += 1;
      this._publicEvent({ kind: 'countered', by: counter.byId, actionId: action.id, round: this.round });
    }
    this._audit({ type: 'counter-result', actionId: action.id, by: counter.byId, cardId: counter.cardId, effective, round: this.round });
    results.push({ actionId: action.id, actorId: action.actorId, cardId: action.cardId, applied: false, countered: true, by: counter.byId, effective });
  }

  /** 公共议案 / 投票的结算（服务端按队列固定顺序处理）。 */
  _settleVotes() {
    for (const m of this.pendingMotions) {
      if (m.kind === 'motion') {
        // 荒诞议案：本实现默认通过（设计稿：提出即获得情报点），并记录谁提出了它
        const p = this.players.get(m.actorId);
        if (p) {
          p.intel = Math.min(this.cfg.resources.intel.cap, p.intel + (m.gainIntel || 2));
          p.stats.motionsPassed += 1;
        }
        this._publicEvent({ kind: 'motion-passed', actorId: m.actorId, round: this.round });
      } else if (m.kind === 'fact') {
        this._publicEvent({ kind: 'fact', subjectId: m.subjectId, fact: m.fact, round: this.round });
      } else if (m.kind === 'bounty') {
        this._publicEvent({ kind: 'bounty-open', subjectId: m.targetId, round: this.round });
      } else if (m.kind === 'vote:suspicion') {
        // 得票第一者公开一条行动类别线索；本实现按「嫌疑度最高的玩家」等价处理
        const top = [...this.players.values()].filter((p) => !p.left).sort((a, b) => b.suspicion - a.suspicion)[0];
        if (top) this._publicEvent({ kind: 'suspicion-top', playerId: top.playerId, round: this.round });
      } else {
        this._publicEvent({ kind: 'party', sub: m.kind, actorId: m.actorId, round: this.round });
      }
    }
    this.pendingMotions = [];
    // 团队防护：全队背锅通过后，本回合的战役失守不扣个人战役分
    if (this.teamGuard > 0) this._publicEvent({ kind: 'team-guard', round: this.round });
  }

  // ── 古拉格操作 ──────────────────────────────────────────────────────────────────────

  /** 队友为囚犯购买一次额外挑战机会（只能花调度券，不能直接复活）。 */
  _opSponsor(ps, msg) {
    if (ps.left) return fail(ERR.ELIMINATED);
    const beneficiaryId = msg.playerId;
    const can = this.gulag.canSponsor(ps.playerId, beneficiaryId, this.round);
    if (!can.ok) return fail(this._sponsorErr(can.reason), can.reason);
    if (!(ps.tickets >= can.cost)) return fail(ERR.NO_FUNDS);
    // 唯一扣费点：只有通过 canSponsor 与余额检查之后才扣
    ps.tickets -= can.cost;
    ps.stats.sponsoredExtra += 1;
    const rec = this.gulag.applySponsorship(ps.playerId, beneficiaryId, this.round, this.now());
    this._audit({ type: 'sponsor', ...rec });
    this._publicEvent({ kind: 'sponsor', payerId: ps.playerId, beneficiaryId, cost: can.cost, round: this.round });
    this.markPrivate(this.players.get(beneficiaryId));
    this.markPrivate(ps);
    this.markPublic();
    return { ok: true, cost: can.cost };
  }

  _sponsorErr(reason) {
    switch (reason) {
      case 'gulag-closed': return ERR.WRONG_PHASE;
      case 'self': case 'not-in-gulag': case 'not-in-custody': return ERR.BAD_TARGET;
      case 'already-sponsored': return ERR.ALREADY;
      default: return ERR.BAD_TARGET;
    }
  }

  /** 玩家本人参加古拉格小游戏。 */
  _challengeIntent(ps, msg) {
    const op = msg.op;
    if (op === 'start') {
      if (this.phase !== PARTY_PHASE.GULAG) return fail(ERR.WRONG_PHASE);
      if (!this.gulag.canChallenge(ps.playerId)) return fail(ERR.WRONG_PHASE, 'not eligible');
      const inst = createChallengeInstance(this.rngMini, this.cfg.gulag);
      this._challenges = this._challenges || new Map();
      this._challenges.set(ps.playerId, { inst, answers: [], startedAt: this.now(), round: this.round });
      this.gulag.startChallenge(ps.playerId, this.round, inst.questions.length);
      // 只把题目发给本人（答案留在服务端）
      return { ok: true, challenge: { kind: inst.kind, questions: inst.publicQuestions(), seconds: this.cfg.gulag.quizSeconds } };
    }
    if (op === 'answer') {
      if (this.phase !== PARTY_PHASE.GULAG) return fail(ERR.WRONG_PHASE);
      const c = this._challenges && this._challenges.get(ps.playerId);
      if (!c) return fail(ERR.BAD_TARGET, 'no challenge running');
      const idx = Math.floor(Number(msg.index));
      const choice = Math.floor(Number(msg.choice));
      if (!Number.isInteger(idx) || idx < 0 || idx >= c.inst.questions.length) return fail(ERR.BAD_TARGET);
      if (!Number.isInteger(choice) || choice < 0) return fail(ERR.BAD_TARGET);
      // 重复作答同一个序号：幂等（保留第一次）
      if (c.answers[idx] != null) return fail(ERR.ALREADY);
      c.answers[idx] = choice;
      return { ok: true, index: idx };
    }
    if (op === 'finish') {
      if (this.phase !== PARTY_PHASE.GULAG) return fail(ERR.WRONG_PHASE);
      const c = this._challenges && this._challenges.get(ps.playerId);
      if (!c) return fail(ERR.BAD_TARGET, 'no challenge running');
      const correct = runChallenge(c.inst, c.answers);
      const passed = correct >= c.inst.passLine;
      const sub = this._submitChallengeResult(ps.playerId, passed);
      return { ok: true, passed, correct, total: c.inst.questions.length, awaitingReturn: !!sub.awaitingReturn };
    }
    return fail(ERR.BAD_MSG, `unknown challenge op ${op}`);
  }

  _submitChallengeResult(playerId, passed) {
    const res = this.gulag.submitChallenge(playerId, { won: passed }, this.round);
    if (res.ok) this.markPublic();
    return res;
  }

  /** 人机囚犯自动挑战（服务端判定，不经过客户端）。 */
  _autoBotChallenges() {
    for (const p of this.order) {
      if (!p.isBot || p.left || !this.gulag.canChallenge(p.playerId)) continue;
      this.gulag.startChallenge(p.playerId, this.round, this.cfg.gulag.quizQuestions);
      // 人机按固定 60% 通过率（服务端随机）
      const pass = this.rng.chance(0.6);
      this._submitChallengeResult(p.playerId, pass);
    }
  }

  // ── 线索与指控 ──────────────────────────────────────────────────────────────────────

  /** 公开指控：可要求支付影响力；指对被证实则计分（错误指控有小代价）。 */
  _opAccuse(ps, msg) {
    if (ps.left) return fail(ERR.ELIMINATED);
    const target = this.players.get(msg.targetId);
    if (!target || target.playerId === ps.playerId || target.left) return fail(ERR.BAD_TARGET);
    if (ps.influence < 1) return fail(ERR.NO_FUNDS, 'accusation costs 1 influence');
    ps.influence -= 1;
    const correct = target.faction === FACTION.SPLIT;
    if (correct) { ps.stats.correctAccusations += 1; target.suspicion += 2; } else { ps.suspicion += 1; }
    this.actionLog.get(ps.playerId)?.add('action');
    this._publicEvent({ kind: 'accusation', by: ps.playerId, targetId: target.playerId, correct: correct ? 'YES' : 'NO', round: this.round });
    this._audit({ type: 'accusation', by: ps.playerId, targetId: target.playerId, correct, round: this.round });
    this.markPrivate(ps);
    this.markPublic();
    return { ok: true, correct };
  }

  // ── 自动推进 ────────────────────────────────────────────────────────────────────────

  /** 所有人都已就绪（或全部离场/超时）时提前进入下一阶段。 */
  maybeAdvance() {
    if (this.ended || this.disposed) return;
    const live = this.order.filter((p) => !p.left);
    if (!live.length) { if (!this.ended) this.finish({ victory: false, reason: 'all-left' }); return; }
    const everyone = (set) => live.every((p) => set.has(p.playerId) || p.isBot);
    switch (this.phase) {
      case PARTY_PHASE.BRIEFING: {
        // 简讯：所有人 ready（或全是 bot）即开始，否则等时限
        this.ready = this.ready || new Set();
        if (everyone(this.ready)) { this._clearTimer(); this.enterRound(); }
        break;
      }
      case PARTY_PHASE.MARKET:
      case PARTY_PHASE.TRADE:
      case PARTY_PHASE.SECRET:
        if (this.ready && everyone(this.ready)) {
          this._clearTimer();
          if (this.phase === PARTY_PHASE.MARKET) this.enterTrade();
          else if (this.phase === PARTY_PHASE.TRADE) this.enterSecret();
          else this.endSecret();
        }
        break;
      case PARTY_PHASE.RESPONSE:
        // 没有需要响应的目标（本轮没人被打）→ 直接结算；否则等所有被影响者响应或超时
        if (this._allResponded()) { this._clearTimer(); this.resolveRound(); }
        break;
      default:
        break;
    }
  }

  /** 所有被影响者都已响应（或本身就是机器人/已离场）；没有人被指定目标时立即为真。 */
  _allResponded() {
    const targeted = new Set();
    for (const a of this._frozenActions || []) if (a.targetId) targeted.add(a.targetId);
    if (!targeted.size) return true;
    const responded = new Set((this._responses || []).map((r) => r.byId));
    const live = this.order.filter((p) => !p.left);
    return live.every((p) => !targeted.has(p.playerId) || responded.has(p.playerId) || p.isBot);
  }

  // ── 结束 ────────────────────────────────────────────────────────────────────────────

  finish({ victory = false, reason = 'defeat' } = {}) {
    if (this.ended || this.disposed) return;
    this._clearTimer();
    this.ended = true;
    this.phase = PARTY_PHASE.ENDED;
    this.deadline = 0;
    const result = judgeOutcome({ campaign: { victory, reason }, players: this.order, cfg: this.cfg, ctx: { round: this.round } });
    this.outcome = result;
    this.resultMsg = { t: 'm.partyResult', ...result, roundsPassed: this.round, roomCode: this.roomCode };
    this.markPublic();
    this.markAllPrivate();
    this.flush(true);
    for (const p of this.order) {
      if (!p.connected === false && !p.left) this.sendFn(p.playerId, { ...this.resultMsg, playerId: p.playerId });
    }
    const summary = { ended: true, victory, reason, rounds: this.round, outcome: result.outcome, winner: result.winner };
    try { this.onEndFn(summary); } catch (e) { this.log.error?.('onEnd', e); }
  }

  // ── 视图 ────────────────────────────────────────────────────────────────────────────

  /** 公共视图（所有人可见；**不含**身份、任务、他人手牌、私密线索、报价金额）。 */
  publicView() {
    return {
      t: 'm.party',
      roomCode: this.roomCode,
      phase: this.phase,
      round: this.round,
      maxRounds: this.maxRounds,
      deadline: this.deadline,
      players: this.order.map((p) => p.publicRow()),
      market: this.market.view(),
      gulag: this.gulag.view(),
      campaign: {
        victory: this.campaign.victory,
        reason: this.campaign.reason,
        losses: this.campaignLosses || 0,
        history: this.campaign.history.slice(-3),
      },
      log: this.publicLog.slice(-40),
      ready: [...(this.ready || [])],
      config: {
        splitKnowledge: this.cfg.splitKnowledge,
        extraChanceCost: this.cfg.gulag.extraChanceCost,
        openRound: this.cfg.gulag.openRound,
      },
    };
  }

  /** 私人视图（只发给本人）。 */
  privateViewFor(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    const role = privateRoleView(playerId, this.factions, this.objectives, this.knownSplits);
    const obj = checkObjective(p, p.objectiveId, { allPlayers: this.order, campaign: this.campaign });
    const chal = checkChallenge(p, p.challengeId, { allPlayers: this.order, campaign: this.campaign });
    return {
      t: 'm.partyPrivate',
      playerId,
      role: {
        faction: role.faction,
        knownSplits: role.knownSplits,
        objective: role.objective,
        challenge: role.challenge,
        objectiveDone: obj.done,
        challengeDone: chal.done,
      },
      resources: { tickets: p.tickets, intel: p.intel, influence: p.influence, merit: p.merit },
      hand: p.handView(),
      clues: p.clues.slice(-10),
      suspicion: p.suspicion,
      market: this.market.privateView(playerId),
      trades: this._tradesFor(playerId),
      gulag: this._gulagPrivate(playerId),
      playsThisRound: p.playsThisRound,
      playsLimit: this.cfg.deck.maxPlaysPerRound,
      responsesThisRound: p.responsesThisRound,
      pendingActions: p.pendingActions.slice(),
      canAct: this._canAct(p),
    };
  }

  _tradesFor(playerId) {
    if (!this.trades) return [];
    const out = [];
    for (const t of this.trades.values()) {
      if (t.fromId !== playerId && t.toId !== playerId) continue;
      out.push({ id: t.id, fromId: t.fromId, toId: t.toId, give: t.give, want: t.want, status: t.status });
    }
    return out.slice(-8);
  }

  _gulagPrivate(playerId) {
    const r = this.gulag.records.get(playerId);
    const v = this.gulag.view();
    return {
      ...v,
      me: r ? {
        state: r.state, chancesUsed: r.chancesUsed, extraChances: r.extraChances,
        canChallenge: this.gulag.canChallenge(playerId),
        challenge: r.challenge ? { round: r.challenge.round, outcome: r.challenge.outcome, isExtra: r.challenge.isExtra } : null,
      } : null,
    };
  }

  _canAct(p) {
    if (p.left) return false;
    switch (this.phase) {
      case PARTY_PHASE.MARKET: return true;
      case PARTY_PHASE.TRADE: return true;
      case PARTY_PHASE.SECRET: return p.playsThisRound < this.cfg.deck.maxPlaysPerRound;
      case PARTY_PHASE.RESPONSE: return p.responsesThisRound < 1;
      case PARTY_PHASE.GULAG: return this.gulag.canChallenge(p.playerId);
      default: return false;
    }
  }

  // ── 发送 ────────────────────────────────────────────────────────────────────────────

  markPublic() { this._pubDirty = true; this.flush(false); }

  markPrivate(p) { this._privDirty = this._privDirty || new Set(); this._privDirty.add(p.playerId); }

  markAllPrivate() { for (const p of this.order) this.markPrivate(p); this.flush(false); }

  sendPublic(playerId) {
    const msg = this.publicView();
    if (playerId) this.sendFn(playerId, msg);
    else this.broadcastFn(msg);
  }

  sendPrivate(p) {
    if (!p || p.left) return;
    const v = this.privateViewFor(p.playerId);
    if (v) this.sendFn(p.playerId, v);
  }

  /** 把累积的公开/私有视图发出去（apply=true 时立即发送）。 */
  flush(apply = false) {
    if (this.disposed) return;
    if (this._pubDirty || apply) {
      this._pubDirty = false;
      try { this.sendPublic(null); } catch (e) { this.log.error?.('party broadcast', e); }
    }
    const dirty = this._privDirty;
    this._privDirty = null;
    const ids = apply ? this.order.map((p) => p.playerId) : [...(dirty || [])];
    for (const id of ids) {
      const p = this.players.get(id);
      if (!p || p.left) continue;
      try { this.sendPrivate(p); } catch (e) { this.log.error?.('party private', e); }
    }
  }

  // ── 事件 / 审计 / 定时 ───────────────────────────────────────────────────────────────

  _publicEvent(ev) {
    this.publicLog.push({ ...ev, seq: this.publicLog.length + 1 });
    if (this.publicLog.length > 200) this.publicLog.shift();
    this.markPublic();
  }

  _audit(ev) {
    this.auditLog.push({ ...ev, at: this.now() });
    if (this.auditLog.length > 2000) this.auditLog.shift();
  }

  _onGulagEvent(e) {
    this._audit({ type: 'gulag-event', ...e });
    const map = {
      'gulag.jail': (x) => ({ kind: 'jail', playerId: x.playerId, round: x.round }),
      'gulag.roll': (x) => ({ kind: 'riot-roll', round: x.round, when: x.when, roll: x.roll, sides: x.sides, triggered: x.triggered }),
      'gulag.riot': (x) => ({ kind: 'riot', round: x.round, released: x.released }),
      'gulag.open': (x) => ({ kind: 'gulag-open', round: x.round }),
      'gulag.challenge.won': (x) => ({ kind: 'challenge-won', playerId: x.playerId, round: x.round }),
      'gulag.challenge.lost': (x) => ({ kind: 'challenge-lost', playerId: x.playerId, round: x.round }),
      'gulag.sponsor': (x) => ({ kind: 'sponsor', payerId: x.payerId, beneficiaryId: x.beneficiaryId, cost: x.cost, round: x.round }),
    };
    const fn = map[e.type];
    if (fn) this._publicEvent(fn(e));
  }

  _setDeadline(seconds, fn) {
    this._clearTimer();
    if (!(seconds > 0)) { this.deadline = 0; return; }
    this.deadline = this.now() + seconds * 1000;
    this._phaseTimer = setTimeout(() => {
      this._phaseTimer = null;
      if (this.ended || this.disposed) return;
      try { fn(); } catch (e) { this.log.error?.('party timer', e); }
    }, seconds * 1000);
    if (this._phaseTimer.unref) this._phaseTimer.unref();
    this._timers.add(this._phaseTimer);
  }

  _clearTimer() {
    if (this._phaseTimer) {
      try { clearTimeout(this._phaseTimer); } catch { /* ignore */ }
      this._timers.delete(this._phaseTimer);
      this._phaseTimer = null;
    }
    this.deadline = 0;
  }

  /** 战役钩子：请求一次战役结果。外部通过 setCampaignResult 回答；没钩子时装 1.5 秒后自动结束本回合。 */
  _requestCampaignResult() {
    const hook = this.opts.campaign && typeof this.opts.campaign.roundInfo === 'function' ? this.opts.campaign : null;
    if (hook) {
      try {
        const info = hook.roundInfo(this.round);
        if (info && typeof info.victory === 'boolean') { this.setCampaignResult(this.round, info.victory, info.reason || ''); return; }
      } catch (e) { this.log.error?.('party campaign hook', e); }
    }
    // 无钩子：自动推演（供无战役系统的联调/测试使用）
    this._setDeadline(1.5, () => {
      if (!this.campaignPending) return;
      const win = this.rng.chance(0.78);
      this.setCampaignResult(this.round, win, win ? 'auto-hold' : 'auto-leak');
    });
  }
}
