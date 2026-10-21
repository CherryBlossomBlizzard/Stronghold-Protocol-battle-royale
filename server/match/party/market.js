// server/match/party/market.js — 公共市场、固定价格购买、密封竞价（服务端权威）。
//
// 设计稿 §4.2 的硬规则：
//   * 市场每轮展示 4 张卡：2 张固定价格 + 2 张密封竞价；
//   * 每名玩家每轮最多买 1 张固定价格卡，并对 1 张竞价卡提交一次密封报价；
//   * 固定价格按「服务器验证后的先到有效请求」处理；多人争购同一张有限库存卡时库存与锁定结果明确；
//   * 密封竞价由服务器同时收齐后统一比较：最高有效出价者获卡并支付自己的报价；
//   * 最高出价平局按轮换优先级决定；未中标者退回全部报价（本实现中竞价只有在得标时才扣费，故天然不扣）；
//   * 重复请求 Idempotency：同一 requestId 只处理一次；同一玩家每轮只能报一次价。

import { CARDS, MARKET_CARD_IDS, cardDef, cardAvailableTo } from '../../../shared/partyCards.js';

/** 平局轮换优先级：以「回合 + 座位」确定一个轮换起点，保证不依赖消息到达顺序。 */
export function rotationOrder(playerIds, round) {
  const n = playerIds.length;
  if (!n) return [];
  const start = ((round % n) + n) % n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(playerIds[(start + i) % n]);
  return out;
}

/**
 * 市场状态机。一个 PartyMatch 持有一个实例。
 * 市场每轮重建；竞价与库存都在这里。
 */
export class Market {
  /**
   * @param {object} opts
   * @param {object} opts.cfg
   * @param {{shuffle:(a:any[])=>void, int:(n:number)=>number}} opts.rng
   * @param {(e:object)=>void} [opts.onEvent]
   */
  constructor({ cfg, rng, onEvent = () => {} }) {
    this.cfg = cfg;
    this.rng = rng;
    this.onEvent = onEvent;
    /** 市场格子：[{ slot, cardId, mode: 'fixed'|'sealed', price, stock, sold, bids: Map<playerId, {amount, seq}> }] */
    this.slots = [];
    /** 当前轮次 */
    this.round = 0;
    /** 每名玩家的本轮状态：playerId → { fixedBought, bidSlot, bidAmount, won } */
    this.buyers = new Map();
    /** 幂等表：requestId → 结果（同一请求重复提交只处理一次） */
    this._requests = new Map();
    /** 竞价序号（同一玩家重复报价时用最后一次有效报价，但仍只算一次） */
    this._seq = 0;
  }

  /** 每轮的固定购买次数上限。 */
  get fixedBuysPerRound() { return this.cfg.market.fixedBuysPerRound; }

  /** 开启新一轮市场：重建 4 个格子（2 固定价 + 2 密封竞价）。 */
  openRound(round, alivePlayerIds = []) {
    this.round = round;
    this.buyers.clear();
    this._seq = 0;
    const pool = MARKET_CARD_IDS.filter((id) => {
      const d = cardDef(id);
      return d && !d.noMarket;
    });
    // 加权抽取（rarity 低的更常见），但不重复同一张卡在同一轮的固定位
    const picked = [];
    const take = (predicate) => {
      const cand = pool.filter((id) => !picked.includes(id) && predicate(cardDef(id)));
      if (!cand.length) return null;
      const w = cand.map((id) => 4 - Math.min(3, cardDef(id).rarity));
      const total = w.reduce((a, b) => a + b, 0);
      let r = this.rng.int(Math.max(1, total));
      for (let i = 0; i < cand.length; i++) { r -= w[i]; if (r < 0) return cand[i]; }
      return cand[cand.length - 1];
    };
    const fixedCount = this.cfg.market.fixedSlots;
    const sealedCount = this.cfg.market.sealedSlots;
    for (let i = 0; i < fixedCount; i++) {
      const id = take((d) => d.kind !== 'COUNTER');
      if (id) picked.push(id);
    }
    for (let i = 0; i < sealedCount; i++) {
      const id = take(() => true);
      if (id) picked.push(id);
    }
    this.slots = picked.map((cardId, i) => {
      const d = cardDef(cardId);
      const isFixed = i < fixedCount;
      return {
        slot: i,
        cardId,
        mode: isFixed ? 'fixed' : 'sealed',
        // 固定价 = 卡面的调度券成本（至少 1）；竞价卡同样以卡面成本作为起拍参考
        price: Math.max(1, (d.cost && d.cost.tickets) || 1),
        stock: isFixed ? (d.copies || 1) : 1,
        sold: 0,
        bids: new Map(),
      };
    });
    for (const pid of alivePlayerIds) this.buyers.set(pid, { fixedBought: 0, bidSlot: null, bidAmount: 0, won: null });
    this.onEvent({ type: 'market.open', round, slots: this.slots.map((s) => ({ slot: s.slot, cardId: s.cardId, mode: s.mode })) });
    return this.slots;
  }

  /** 公开视图（**不含他人报价**，只给「谁已经报过价」）。 */
  view() {
    return {
      round: this.round,
      slots: this.slots.map((s) => ({
        slot: s.slot, cardId: s.cardId, mode: s.mode, price: s.price,
        stock: s.stock, sold: s.sold, remaining: Math.max(0, s.stock - s.sold),
        bidderCount: s.bids.size,
        bids: [...s.bids.keys()], // 只公开"谁报了价"，绝不公开报价金额
      })),
    };
  }

  /** 某玩家自己的市场状态（含自己的报价）。 */
  privateView(playerId) {
    const b = this.buyers.get(playerId) || { fixedBought: 0, bidSlot: null, bidAmount: 0, won: null };
    return { fixedBought: b.fixedBought, fixedLimit: this.fixedBuysPerRound, bidSlot: b.bidSlot, bidAmount: b.bidAmount, won: b.won };
  }

  _slot(slot) {
    return this.slots.find((s) => s.slot === slot) || null;
  }

  /**
   * 买到一张固定价格卡。返回 { ok, cardId, price, reason? }。
   * * 每人每轮 1 张；库存按先到有效请求扣减；重复 requestId 返回第一次的结果。
   */
  buyFixed(playerId, slot, requestId, player) {
    if (requestId && this._requests.has(`buy:${requestId}`)) return this._requests.get(`buy:${requestId}`);
    const remember = (r) => { if (requestId) this._requests.set(`buy:${requestId}`, r); return r; };
    const s = this._slot(slot);
    if (!s) return remember({ ok: false, reason: 'no-such-slot' });
    if (s.mode !== 'fixed') return remember({ ok: false, reason: 'not-fixed-price' });
    const b = this.buyers.get(playerId);
    if (!b) return remember({ ok: false, reason: 'not-a-player' });
    if (b.fixedBought >= this.fixedBuysPerRound) return remember({ ok: false, reason: 'fixed-limit-reached' });
    if (s.sold >= s.stock) return remember({ ok: false, reason: 'sold-out' });
    if (!(player && player.tickets >= s.price)) return remember({ ok: false, reason: 'cannot-afford' });
    // 通过所有检查后才扣：这是唯一一次扣费点，重复调用会被上面的 fixedBought 拦住
    s.sold += 1;
    b.fixedBought += 1;
    player.tickets -= s.price;
    this.onEvent({ type: 'market.buy', playerId, slot, cardId: s.cardId, price: s.price });
    return remember({ ok: true, cardId: s.cardId, price: s.price, remaining: s.stock - s.sold });
  }

  /**
   * 提交一次密封报价。同一玩家每轮只能报一次（repeat 被拒绝；重复 requestId 幂等）。
   * 报价在结算前**不扣费**，得标时才扣，因此未中标天然不损失任何资源。
   */
  placeBid(playerId, slot, amount, requestId, player) {
    if (requestId && this._requests.has(`bid:${requestId}`)) return this._requests.get(`bid:${requestId}`);
    const remember = (r) => { if (requestId) this._requests.set(`bid:${requestId}`, r); return r; };
    const s = this._slot(slot);
    if (!s) return remember({ ok: false, reason: 'no-such-slot' });
    if (s.mode !== 'sealed') return remember({ ok: false, reason: 'not-sealed' });
    const b = this.buyers.get(playerId);
    if (!b) return remember({ ok: false, reason: 'not-a-player' });
    if (b.bidSlot != null) return remember({ ok: false, reason: 'already-bid' });
    const amt = Math.floor(Number(amount) || 0);
    if (amt < this.cfg.market.minBid) return remember({ ok: false, reason: 'bid-too-low' });
    if (!(player && player.tickets >= amt)) return remember({ ok: false, reason: 'cannot-afford' });
    if (s.sold >= s.stock) return remember({ ok: false, reason: 'sold-out' });
    s.bids.set(playerId, { amount: amt, seq: ++this._seq });
    b.bidSlot = slot;
    b.bidAmount = amt;
    this.onEvent({ type: 'market.bid', playerId, slot, cardId: s.cardId, amount: amt });
    return remember({ ok: true, slot, amount: amt });
  }

  /**
   * 结算所有密封竞价：每格一个赢家，按「最高价 → 平局轮换优先级」。
   * 返回 [{ slot, cardId, winnerId|null, amount, reason }]。**扣费在这里发生**，且只扣赢家。
   */
  settleSealed(orderBySeat, playerById) {
    const out = [];
    for (const s of this.slots) {
      if (s.mode !== 'sealed') continue;
      if (!s.bids.size) { s.settled = true; out.push({ slot: s.slot, cardId: s.cardId, winnerId: null, amount: 0, reason: 'no-bids' }); continue; }
      if (s.settled) { out.push({ slot: s.slot, cardId: s.cardId, winnerId: s.winnerId || null, amount: 0, reason: 'already-settled' }); continue; }
      const rot = rotationOrder(orderBySeat, this.round);
      const rank = (id) => { const i = rot.indexOf(id); return i < 0 ? rot.length : i; };
      const entries = [...s.bids.entries()].map(([id, b]) => ({ id, ...b }));
      entries.sort((a, b) => (b.amount - a.amount) || (rank(a.id) - rank(b.id)) || (a.seq - b.seq));
      const top = entries[0];
      const winner = playerById.get(top.id);
      // 若赢家因其它原因已负担不起（理论上不会：结算前没有其它扣费点），顺延到下一名
      let chosen = null;
      for (const e of entries) {
        const p = playerById.get(e.id);
        if (p && p.tickets >= e.amount) { chosen = e; break; }
      }
      if (!chosen) { out.push({ slot: s.slot, cardId: s.cardId, winnerId: null, amount: 0, reason: 'unaffordable' }); continue; }
      const payee = playerById.get(chosen.id);
      const b = this.buyers.get(chosen.id);
      // 幂等：同一玩家同一轮只会中标一次（每格一次，且每人只能报一个格）
      if (s.sold >= s.stock) { out.push({ slot: s.slot, cardId: s.cardId, winnerId: null, amount: 0, reason: 'sold-out' }); continue; }
      s.sold += 1;
      payee.tickets -= chosen.amount;
      if (b) b.won = s.cardId;
      void winner;
      s.settled = true;
      s.winnerId = chosen.id;
      out.push({ slot: s.slot, cardId: s.cardId, winnerId: chosen.id, amount: chosen.amount, reason: 'won', ties: entries.length });
      this.onEvent({ type: 'market.sealed', slot: s.slot, cardId: s.cardId, winnerId: chosen.id, amount: chosen.amount });
    }
    return out;
  }

  /** 本轮是否还有未结算的竞价。 */
  sealedPending() {
    return this.slots.some((s) => s.mode === 'sealed' && !s.settled);
  }
}

/** 在市场里按 id 找卡（测试与调试用）。 */
export function marketCardDef(id) {
  return cardDef(id) || null;
}

export { CARDS, cardAvailableTo };
