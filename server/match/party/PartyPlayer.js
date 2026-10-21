// server/match/party/PartyPlayer.js — 一名玩家在《神人派对》里的派对侧状态。
//
// 与 PlayerState（PvE 侧：棋盘、商店、血条）完全分开：这里只放派对资源、卡组、手牌、线索、
// 嫌疑度、行动记录与结算用到的计数器。服务端独占，视图由 PartyMatch 拼装（见 privateView / publicRow）。

import { cardDef, STARTER_DECK } from '../../../shared/partyCards.js';
import { PARTY_DEFAULTS } from '../../../shared/partyRules.js';

let uidSeq = 0;
/** 卡牌实例 uid（每局内唯一，服务端生成；客户端只能引用，不能构造）。 */
export function nextCardUid() { return `c${++uidSeq}`; }
/** 仅测试用：重置 uid 计数。 */
export function _resetCardUid() { uidSeq = 0; }

export class PartyPlayer {
  /**
   * @param {object} opts
   * @param {string} opts.playerId
   * @param {number} opts.seat
   * @param {string} opts.name
   * @param {boolean} opts.isBot
   * @param {object} opts.cfg
   * @param {{shuffle:(a:any[])=>void}} opts.rng
   */
  constructor({ playerId, seat, name, isBot = false, cfg, rng }) {
    this.playerId = playerId;
    this.seat = seat;
    this.name = name;
    this.isBot = isBot;
    this.cfg = cfg;

    const res = cfg.resources;
    this.tickets = res.tickets.start;
    this.intel = res.intel.start;
    this.influence = res.influence.start;
    /** 功绩：个人荣誉与终局排名，不用于常规购买 */
    this.merit = 0;

    /** 身份与任务（由 roles.js 填入；绝不在公开视图里出现） */
    this.faction = null;
    this.objectiveId = null;
    this.challengeId = null;
    this.knownSplits = [];

    /** 卡组（牌库）与手牌：都是卡牌实例 { uid, cardId } */
    this.deck = [];
    this.hand = [];
    this.discard = [];
    /** 本轮的待结算行动（最多 1 主 + 1 副由 maxPlaysPerRound 控制） */
    this.pendingActions = [];
    /** 本轮已经打出的张数 */
    this.playsThisRound = 0;
    /** 响应阶段的待提交反制 */
    this.pendingResponses = [];
    this.responsesThisRound = 0;

    /** 线索：[{ id, kind: 'reliable'|'vague'|'fake'|'unverified', source, text, round, verified }] */
    this.clues = [];
    this.clueSeq = 0;
    /** 嫌疑度（公开） */
    this.suspicion = 0;

    /** 计数器（计分与任务检查用） */
    this.stats = {
      pranksPlayed: 0, splitActions: 0, trades: 0, motionsPassed: 0, correctAccusations: 0,
      sponsoredExtra: 0, bidWins: 0, investigations: 0, partyChallenges: 0, countersWon: 0,
      cluesReceived: 0, jailed: 0, roundsPlayed: 0, perfectRounds: 0, campaignScore: 0,
    };

    /** 本轮禁言式标记（例如被「暗线监听」反侦察）：playerId → 本轮 */
    this.darklisteningBlocked = false;
    /** 下一轮收入剥离：{ resource, amount, round } */
    this.incomeStrips = [];
    /** 待生效的公开发布（线索/事实） */
    this.publicFacts = [];

    this.dealStarters(rng);
  }

  /** 发初始牌组 12 张，抽起始手牌（START_HAND）。 */
  dealStarters(rng) {
    const list = STARTER_DECK.slice();
    if (rng && typeof rng.shuffle === 'function') rng.shuffle(list);
    this.deck = list.map((cardId) => ({ uid: nextCardUid(), cardId }));
    this.hand = [];
    this.discard = [];
    this.draw(this.cfg.deck.startHand);
  }

  /** 抽 n 张；超出牌库时把弃牌堆洗回来（服务端随机，不依赖客户端）。 */
  draw(n, rng = null) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) {
        if (!this.discard.length) break;
        this.deck = this.discard.splice(0);
        if (rng && typeof rng.shuffle === 'function') rng.shuffle(this.deck);
      }
      const card = this.deck.pop();
      if (!card) break;
      this.hand.push(card);
      drawn.push(card);
    }
    return drawn;
  }

  /** 手牌上限：超出部分按弃牌规则丢弃（保留先抽到的）。返回被弃掉的卡。 */
  trimHand() {
    const cap = this.cfg.deck.handCap;
    if (this.hand.length <= cap) return [];
    const dropped = this.hand.splice(cap);
    for (const c of dropped) this.discard.push(c);
    return dropped;
  }

  /** 从手牌里取走一张（按 uid），返回卡牌或 null。 */
  takeFromHand(uid) {
    const i = this.hand.findIndex((c) => c.uid === uid);
    if (i < 0) return null;
    return this.hand.splice(i, 1)[0];
  }

  /** 往手牌加一张卡；超上限时按安全默认规则替换最早的一张（返回被替换的卡）。 */
  addCard(card, { replaceUid = null } = {}) {
    let replaced = null;
    if (this.hand.length >= this.cfg.deck.handCap) {
      const idx = replaceUid ? this.hand.findIndex((c) => c.uid === replaceUid) : 0;
      const at = idx >= 0 ? idx : 0;
      replaced = this.hand.splice(at, 1)[0] || null;
      if (replaced) this.discard.push(replaced);
    }
    this.hand.push(card);
    return replaced;
  }

  /** 牌库 + 弃牌 + 手牌 总量（卡组上限用）。 */
  deckSize() { return this.deck.length + this.discard.length + this.hand.length; }

  /** 手牌里某张卡定义（给 UI）。 */
  handView() {
    return this.hand.map((c) => ({ uid: c.uid, cardId: c.cardId }));
  }

  get alive() { return !this.left; }

  /** 标记离场（中途退出）。 */
  markLeft() { this.left = true; }

  /** 加线索（去重由内容决定，不做复杂处理）。 */
  addClue(clue) {
    const c = { id: `clue${++this.clueSeq}`, verified: false, ...clue };
    this.clues.push(c);
    if (this.clues.length > 20) this.clues.shift();
    this.stats.cluesReceived += 1;
    return c;
  }

  /** 本轮开始时重置每轮计数。 */
  beginRound(round) {
    this.round = round;
    this.playsThisRound = 0;
    this.responsesThisRound = 0;
    this.pendingActions = [];
    this.pendingResponses = [];
    this.stats.roundsPlayed += 1;
    this.darklisteningBlocked = false;
  }

  /** 回合收入（会被「军需乌龙」之类的剥离效果影响）。 */
  collectIncome(markets) {
    const out = [];
    const res = this.cfg.resources;
    for (const key of ['tickets', 'intel', 'influence']) {
      const def = res[key];
      let amount = def.incomePerRound || 0;
      const strip = this.incomeStrips.find((s) => s.resource === key && s.round === this.round);
      if (strip) amount = Math.max(0, amount - strip.amount);
      if (amount <= 0) continue;
      const before = this[key];
      this[key] = Math.min(def.cap, before + amount);
      if (this[key] !== before) out.push({ resource: key, gained: this[key] - before });
    }
    this.incomeStrips = this.incomeStrips.filter((s) => s.round > this.round);
    for (const m of markets || []) { this.merit += m; }
    void undefined;
    return out;
  }

  /** 公开行：任何人可见的信息（不含身份、任务、线索、手牌）。 */
  publicRow(campaign = null) {
    return {
      playerId: this.playerId,
      seat: this.seat,
      name: this.name,
      isBot: !!this.isBot,
      connected: this.connected !== false,
      left: !!this.left,
      alive: !this.left,
      tickets: this.tickets,
      intel: this.intel,
      influence: this.influence,
      merit: this.merit,
      suspicion: this.suspicion,
      handCount: this.hand.length,
      deckCount: this.deck.length,
      clues: this.clues.filter((c) => !c.secret).length,
      playsThisRound: this.playsThisRound,
      campaign: campaign || null,
    };
  }
}

/** 起始牌组定义导出（测试用）。 */
export { STARTER_DECK, cardDef, PARTY_DEFAULTS };
