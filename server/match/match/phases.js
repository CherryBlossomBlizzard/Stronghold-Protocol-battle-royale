// server/match/match/phases.js — Match methods: the round flow up to the prep — INFO_CHECK, the strategy draft
// (BAND_DRAFT: one countdown of BAND_TURN_SECONDS per turn, 队友已选, the highlighted strategy on a timeout, skips),
// BATTLE_CHECK and ROUND_START (the round's enemies — a normal wave or the boss pairing — planned before the players'
// round start).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { buildNormalWave, buildBossWave } from '../waves.js';
import { pairPlayers } from '../finalAssault.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { botPickBand } from '../bot.js';
import { OK, fail, DELAYS, BAND_TURN_SECONDS } from './common.js';

export class MatchPhases {
  enterInfoCheck() {
    this.phase = PHASE.INFO_CHECK;
    for (const ps of this.order) if (ps.botControlled) ps.infoReady = true;
    // solo: no time limit (the player confirms); co-op: the official 25 s guard
    this.setDeadline(this.soloUntimed ? 0 : this.gd.timer('infoCheck'), () => this.enterBandDraft());
    this.markPublic();
    for (const ps of this.order) this.markPrivate(ps);
    this.flush(true);
    this.maybeEndInfo();
  }

  maybeEndInfo() {
    if (this.phase !== PHASE.INFO_CHECK || this.setupVote || this._infoAdvanceTimer) return;
    if (this.order.every((p) => p.isBot || p.left || p.infoReady)) {
      this.setDeadline(0);
      this._infoAdvanceTimer = this.later(0, () => {
        this._infoAdvanceTimer = null;
        if (this.phase === PHASE.INFO_CHECK && !this.setupVote) this.enterBandDraft();
      });
    }
  }

  /**
   * The strategy draft (user playtest #4 item 4) — 卫戍协议 · 20 人房（龙千尘）: 按【卡池组】独立轮选。
   * 4 人一组（Match.poolGroups；≤6 人整房一组），各组独立轮转、独立判重（队友已选只在组内生效）、
   * 独立卡池（Match.playerPools 本就按组）——20 人房里 8 个策略每组自选自用，跨组可以重复。
   * ONE countdown per turn still holds: every group's turn shares the same clock (BAND_TURN_SECONDS),
   * a turn that runs out assigns every still-pending group's current picker at once.
   * 向后兼容：draft.order / picks / skipsLeft 是全房投影（各组的拼接）；draftTurn() 无参返回第一个
   * 未完成组的当前玩家（bots / 视图）；d.groups 是轮转的真相。
   */
  enterBandDraft() {
    if (this.phase !== PHASE.INFO_CHECK) return;
    this.phase = PHASE.BAND_DRAFT;
    const skips = this.isSolo ? 0 : this.gd.bandDraft.skipsPerPlayer;
    const untimed = this.soloUntimed;
    const bot = (pid) => !!this.players.get(pid)?.isBot;
    const parts = this.poolGroups?.length ? this.poolGroups.map((g) => g.playerIds.slice()) : [this.order.map((p) => p.playerId)];
    const groups = parts.map((ids) => {
      let order = ids.slice();
      if (!this.isSolo) this.rngDraft.shuffle(order);
      order = this.humansFirst(order);
      return {
        playerIds: new Set(ids), order, idx: 0,
        picks: {}, skipsLeft: Object.fromEntries(order.map((pid) => [pid, skips])), focus: new Map(), turnDeadline: 0,
      };
    });
    this.draft = {
      groups,
      order: groups.flatMap((g) => g.order),
      picks: {}, skipsLeft: Object.fromEntries(groups.flatMap((g) => g.order.map((pid) => [pid, skips]))),
      untimed, turnDeadline: 0, focus: new Map(),
    };
    this.setDeadline(0);
    this.startDraftTurn();
    this.markPublic();
  }

  humansFirst(order) {
    if (!this.aiPicksLast) return order;
    const bot = (pid) => !!this.players.get(pid)?.isBot;
    return [...order.filter((pid) => !bot(pid)), ...order.filter(bot)];
  }
  /** The pool group a seat drafts in (this.draft.groups), or null. */
  draftGroupOf(pid) {
    return this.draft?.groups?.find((g) => g.playerIds.has(pid)) || null;
  }

  /**
   * The current picker. Without `pid`: the first group still to pick (the projection's single turn, what the view
   * shows). With `pid`: that seat's own group's current picker — the check pickBand / skipBand / bandFocus run.
   */
  draftTurn(pid = null) {
    const d = this.draft;
    if (!d) return null;
    if (pid != null) {
      const g = this.draftGroupOf(pid);
      return g ? g.order[g.idx] ?? null : null;
    }
    for (const g of d.groups) if (g.idx < g.order.length && !d.picks[g.order[g.idx]]) return g.order[g.idx];
    return null;
  }

  /** Real ms of one strategy-draft turn (BAND_TURN_SECONDS × timerScale). */
  bandTurnMs() { return this.scaled(BAND_TURN_SECONDS * 1000); }

  startDraftTurn() {
    const d = this.draft;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    // 推进每组 idx 越过已选座位；记录有没有组还没选完
    let pending = false;
    for (const g of d.groups) {
      while (g.idx < g.order.length && d.picks[g.order[g.idx]]) g.idx++;
      if (g.idx < g.order.length) pending = true;
    }
    if (!pending) {
      d.turnDeadline = 0;
      this.deadline = 0;
      this.later(0, () => this.finishBandDraft(false));
      return;
    }
    const token = ++this._turnToken;
    if (!d.untimed) {
      const ms = this.bandTurnMs();
      d.turnDeadline = this.sched.now() + ms;
      this.deadline = d.turnDeadline;
      // 各组同钟：一轮超时给【每个未完成组的当前玩家】自动分配
      const expire = () => {
        if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
        for (const g of d.groups) {
          const pid = g.order[g.idx];
          if (pid && !d.picks[pid]) this._applyBand(this.players.get(pid), this.timeoutBand(pid));
        }
      };
      if (this.test) { this.setDeadline(ms / 1000 / (this.timerScale || 1), expire); d.turnDeadline = this.deadline; }
      else this._turnTimer = this.later(ms, expire);
    } else {
      d.turnDeadline = 0;
      this.deadline = 0;
    }
    for (const g of d.groups) {
      const pid = g.order[g.idx];
      const cur = this.players.get(pid);
      if (cur && cur.botControlled) this.scheduleBandBot(g);
    }
    this.markPublic();
  }

  scheduleBandBot(g = null) {
    const token = this._turnToken;
    this.later(0, () => {
      if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
      // 卫戍协议 · 20 人房：AI 隶属自己的组 —— 用该组的当前玩家（draftTurn() 无参只给第一未完成组）
      const pid = g ? g.order[g.idx] : this.draftTurn();
      const ps = this.players.get(pid);
      if (!ps || !ps.botControlled) return;
      // 组内队友已选：AI 重抽，否则组内第一个空的
      let id = botPickBand(this, ps);
      for (let k = 0; k < 8 && this.bandTaken(id, pid); k++) id = botPickBand(this, ps);
      if (this.bandTaken(id, pid)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, pid)) || id;
      this._applyBand(ps, id, { dedupe: true });
    });
  }

  /**
   * Whether `bandId` was already picked by another player of `playerId`'s POOL GROUP（组内队友已选 —— 跨组可以重复）.
   * Research 09 §5 / DESIGN §14 corrections apply within the group; automatic assignments obey the same rule
   * (timeoutBand / defaultBand).
   */
  bandTaken(bandId, playerId) {
    const g = this.draftGroupOf(playerId);
    const picks = g ? g.picks : (this.draft?.picks || {});
    for (const [pid, id] of Object.entries(picks)) if (pid !== playerId && id === bandId) return true;
    return false;
  }

  /**
   * The strategy an automatic assignment gives `playerId` (a departing seat; a timed-out turn without a usable
   * highlight, timeoutBand): the official default 「华法琳」 (bandDraft.timeoutBandId) while no group-mate holds it,
   * else the first strategy of the mode (sortId order, gd.bandIds) that nobody in the group picked — never a
   * duplicate within the group (组内队友已选; the client shows the same choice). Solo drafts have no teammates, so
   * it is always the default.
   * @param {string} playerId
   */
  defaultBand(playerId) {
    const def = this.gd.bandDraft.timeoutBandId;
    if (!this.bandTaken(def, playerId)) return def;
    return this.gd.bandIds().find((b) => !this.bandTaken(b, playerId)) || def;
  }

  /**
   * What a turn that runs out assigns (user playtest #4 item 4): the strategy the player has highlighted in the
   * draft screen (g.bandFocus — the detail pane's band, the one 确认选择 would take) while it is allowed and no
   * group-mate holds it, else defaultBand.
   * @param {string} playerId
   */
  timeoutBand(playerId) {
    const g = this.draftGroupOf(playerId);
    const f = g && g.focus instanceof Map ? g.focus.get(playerId) : null;
    if (typeof f === 'string' && this.gd.bandAllowed(f) && !this.bandTaken(f, playerId)) return f;
    return this.defaultBand(playerId);
  }

  /**
   * g.bandFocus { bandId? }: the strategy the player highlights in the draft screen (any time before its pick; also
   * while waiting for its turn). A missing / null bandId clears it. Only a timed-out turn reads it (timeoutBand).
   */
  bandFocus(ps, bandId) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const g = this.draftGroupOf(ps.playerId);
    if (!g) return fail(ERR.WRONG_PHASE);
    if (g.picks[ps.playerId] || this.draft.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (!(g.focus instanceof Map)) g.focus = new Map();
    if (bandId == null) { g.focus.delete(ps.playerId); return OK; }
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    g.focus.set(ps.playerId, bandId);
    return OK;
  }

  pickBand(ps, bandId) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const g = this.draftGroupOf(ps.playerId);
    if (!g) return fail(ERR.WRONG_PHASE);
    if (g.picks[ps.playerId] || this.draft.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (g.order[g.idx] !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    if (this.bandTaken(bandId, ps.playerId)) return fail(ERR.BAD_TARGET, '队友已选'); // i18n-ignore: developer detail (players see ERR_TEXT)
    this._applyBand(ps, bandId);
    return OK;
  }

  _applyBand(ps, bandId, { dedupe = false } = {}) {
    const d = this.draft;
    if (!d || !ps || d.picks[ps.playerId]) return;
    const g = this.draftGroupOf(ps.playerId);
    if (!g) return;
    let id = this.gd.bandAllowed(bandId) ? bandId : this.defaultBand(ps.playerId);
    if (dedupe && this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
    d.picks[ps.playerId] = id;
    g.picks[ps.playerId] = id;
    ps.bandId = id;
    ps.lp = this.gd.startLp(id);
    this.markPrivate(ps);
    this.markPublic();
    this.startDraftTurn();
  }

  skipBand(ps) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (this.isSolo) return fail(ERR.WRONG_PHASE, 'no skip in solo');
    const g = this.draftGroupOf(ps.playerId);
    if (!g) return fail(ERR.WRONG_PHASE);
    if (g.picks[ps.playerId] || d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (g.order[g.idx] !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!(g.skipsLeft[ps.playerId] > 0)) return fail(ERR.ALREADY, 'no skip left');
    if (g.order.length - g.idx <= 1) return fail(ERR.BAD_TARGET, 'nobody to pass to');
    g.skipsLeft[ps.playerId]--;
    g.order.splice(g.idx, 1);
    // the skipper goes to the end of ITS group; with 「AI 队友最后选择」 to the end of the humans still to pick
    // [ASSUMED: the option's intent, humans before AI, kept through a skip; no source, a remake option]
    let at = g.order.length;
    if (this.aiPicksLast) {
      for (let j = g.order.length - 1; j >= g.idx; j--) {
        if (!this.players.get(g.order[j])?.isBot) { at = j + 1; break; }
      }
    }
    g.order.splice(at, 0, ps.playerId);
    d.order = d.groups.flatMap((x) => x.order); // 全房投影同步组内顺序
    this.startDraftTurn();
    return OK;
  }

  finishBandDraft(timeout) {
    if (this.phase !== PHASE.BAND_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    for (const ps of this.order) {
      if (!this.draft.picks[ps.playerId]) {
        // one after another in seat order, so each default sees the ones assigned before it (no duplicates, in-group)
        const id = this.defaultBand(ps.playerId);
        this.draft.picks[ps.playerId] = id;
        const g = this.draftGroupOf(ps.playerId);
        if (g) g.picks[ps.playerId] = id;
        ps.bandId = id;
        ps.lp = this.gd.startLp(id);
      }
      this.markPrivate(ps);
    }
    void timeout;
    this.enterBattleCheck();
  }
  enterBattleCheck() {
    this.phase = PHASE.BATTLE_CHECK;
    this.setDeadline(this.gd.timer('battleCheck'), () => this.afterBattleCheck(), { silent: this.soloUntimed });
    this.markPublic();
  }

  /**
   * BATTLE_CHECK is over: R1 is about to begin. A plugin window declared at `battleCheck` for this round opens here —
   * "before the round begins", the host's own step first (docs/PLUGINS.md §10b) — and holds R1 back until it closes; a
   * content set without a window continues exactly as before (`openOfferWindow` returns before it touches anything).
   */
  afterBattleCheck() {
    this.startRound(1);
  }

  startRound(r, afterStart = null) {
    // Every round, including boss rounds. [ASSUMED] Expire nonblocking windows at the next round.
    for (const w of this.offerWin) this._closeOffer(w);
    this.offersDispose(); // A test-console round jump must discard the older continuation too.
    const step = () => { this._startRoundAfterOffers(r); afterStart?.(); };
    if (this.openOfferWindow('battleCheck', r) !== 'open') { step(); return; }
    this._offerResume = step;
  }

  _startRoundAfterOffers(r) {
    this.phase = PHASE.ROUND_START;
    this.round = r;
    this.fields = [];
    this.watchers.clear();
    this.unitePlan = null;
    this.uniteResultView = null;
    this.sp = null;
    this.wave = null;
    this.bossWaves = null;
    const alive = this.alivePlayers();
    // the round's enemies (shared composition, generated now so the prep preview is exact). Planned BEFORE the players'
    // round start: its recompute() checks the board on the field the player deploys on this round (deployFieldOf reads
    // the boss pairing), so R14 → R15 never re-checks a boss-field board against the normal field (user playtest #5
    // item 7). rngWaves is used only here, so the order leaves every random stream unchanged.
    const isBoss = r === this.gd.bossRound || r === this.gd.hiddenRound;
    if (isBoss) {
      this._planBossWaves();
    } else {
      this.wave = buildNormalWave(this.gd, this.rngWaves, this.factions, r);
    }
    for (const ps of alive) ps.startRound(r);
    for (const ps of alive) this.dispatch(ps, 'onRoundStart', { round: r });
    // an eliminated player's pending 信标 gift still goes to its teammate (effects flagged afterElimination; GitHub #86)
    for (const ps of this.order) {
      if (ps.alive) continue;
      try { this.dispatcher.dispatchEliminated(ps, 'onRoundStart', { round: r }); } catch (e) { this.reportError('dispatch onRoundStart (eliminated)', e); }
    }
    for (const ps of alive) ps.recompute();
    this.setDeadline(DELAYS.ROUND_START / 1000, () => this.afterRoundStart(), { silent: this.soloUntimed });
    this.markPublic();
    // eliminated humans and spectator seats scout the board of the player they follow through the round's prep, not
    // their own empty board (community report of 2026-10-06, item 56; MatchWatch._followScout)
    for (const ps of this._viewers()) this._followScout(ps);
  }

  /** Stable per-match pairs and their templates, generated before the prep preview / board validation. */
  _planBossWaves() {
    const r = this.round;
    const bossId = r === this.gd.hiddenRound && r !== this.gd.bossRound ? this.hiddenBossId : this.bossId;
    // Pairing uses an independent seeded draw, consuming no shop, wave, draft or battle randomness.
    const groups = pairPlayers(this.alivePlayers(), createRng(deriveSeed(this.seed, 'boss-pairs')), this.bossPairs);
    this.bossPairs = groups.map(g => g.map(p => p.playerId));
    this.bossWaves = groups.map((g) => ({
      players: g.map((p) => p.playerId),
      wave: buildBossWave(this.gd, this.rngWaves, this.factions, r, { bossId, solo: this.isSolo || g.length === 1 }),
    }));
  }

  afterRoundStart() {
    if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
    else this.beforePrepOffers();
  }

  beforePrepOffers() {
    // The official round start and its draw/draft finish first; only entering prep waits.
    this.sp = null;
    const step = () => this.enterPrep();
    if (this.openOfferWindow('prep', this.round) !== 'open') { step(); return; }
    this._offerResume = step;
  }
}
