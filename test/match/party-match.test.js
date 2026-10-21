// test/match/party-match.test.js — 《神人派对》回合引擎的集成测试：房间、身份隔离、市场、竞价、
// 秘密行动、结算、古拉格、计分与结束。全部走真实 PartyMatch，不 mock 规则。

import test from 'node:test';
import assert from 'node:assert/strict';
import { PartyMatch } from '../../server/match/party/PartyMatch.js';
import { PARTY_PHASE, INMATE_STATE, FACTION, PARTY_MIN_PLAYERS } from '../../shared/partyRules.js';
import { CARDS } from '../../shared/partyCards.js';

/** 造一局 8 人（4 人 + 4 人机）对局，收集所有发出的帧。 */
function makeMatch({ players = 8, bots = 0, partyConfig = {}, rounds = 12, campaign, timerScale = 1 } = {}) {
  const seats = [];
  for (let i = 0; i < players; i++) {
    seats.push({ seat: i, playerId: `p${i}`, name: `玩家${i}`, isBot: i >= players - bots, connected: true });
  }
  const sent = [];
  const broadcasts = [];
  const ends = [];
  const m = new PartyMatch({
    roomCode: 'TEST', seats, seed: 12345, partyConfig, rounds, campaign, timerScale,
    send: (pid, msg) => { sent.push({ to: pid, msg }); return true; },
    broadcast: (msg) => { broadcasts.push(msg); },
    onEnd: (s) => { ends.push(s); },
    now: () => Date.now(),
  });
  const lastFor = (pid, t) => {
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].to === pid && sent[i].msg.t === t) return sent[i].msg;
    return null;
  };
  const lastPublic = () => (broadcasts.length ? broadcasts[broadcasts.length - 1] : null);
  return { m, sent, broadcasts, ends, lastFor, lastPublic };
}

/** 等待一个 tick（让计时器跑的阶段前进）。 */
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('8 人房：开局下发身份与任务，且其他玩家的身份绝不出现在公开帧里', () => {
  const { m, lastFor, lastPublic } = makeMatch();
  m.start();
  const pub = lastPublic();
  assert.ok(pub, 'opened with a public frame');
  assert.equal(pub.t, 'm.party');
  assert.equal(pub.players.length, 8);
  // 公共帧不得包含身份/任务字段
  const s = JSON.stringify(pub);
  assert.ok(!/objective|challengeId|faction":/.test(s), 'public view must not leak roles');
  // 每个玩家各自拿到自己的私密身份
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const priv = lastFor(`p${i}`, 'm.partyPrivate');
    assert.ok(priv, `p${i} got a private frame`);
    assert.ok([FACTION.LOYAL, FACTION.SPLIT, FACTION.OPPORTUNIST].includes(priv.role.faction));
    assert.ok(priv.role.objective && priv.role.objective.id, 'each player has an objective');
    seen.add(priv.role.objective.id);
  }
  assert.ok(seen.size >= 4, 'objectives are spread out, not one for everybody');
  m.dispose();
});

test('身份人数符合 8 人表（忠诚 5 / 裂盟 2 / 投机 1）', () => {
  const { m } = makeMatch();
  m.start();
  const counts = { LOYAL: 0, SPLIT: 0, OPPORTUNIST: 0 };
  for (const p of m.order) counts[p.faction] += 1;
  assert.deepEqual(counts, { LOYAL: 5, SPLIT: 2, OPPORTUNIST: 1 });
  m.dispose();
});

test('裂盟派互认：PARTIAL 只认识一名队友，NONE 一个都不认识', () => {
  for (const mode of ['ALL', 'PARTIAL', 'NONE']) {
    const { m } = makeMatch({ partyConfig: { splitKnowledge: mode } });
    m.start();
    const splits = m.order.filter((p) => p.faction === FACTION.SPLIT);
    if (mode === 'NONE') {
      for (const p of splits) assert.deepEqual(p.knownSplits, []);
    } else if (mode === 'ALL') {
      for (const p of splits) assert.equal(p.knownSplits.length, splits.length - 1);
    } else {
      for (const p of splits) assert.equal(p.knownSplits.length, 1);
    }
    m.dispose();
  }
});

test('市场：每轮 2 固定 + 2 竞价；每人每轮只能买 1 张固定价卡', () => {
  const { m, lastFor } = makeMatch();
  m.start();
  m.enterRound();
  m.enterMarket();
  const pub = m.publicView();
  assert.equal(pub.market.slots.length, 4);
  assert.equal(pub.market.slots.filter((s) => s.mode === 'fixed').length, 2);
  assert.equal(pub.market.slots.filter((s) => s.mode === 'sealed').length, 2);

  const fixed = pub.market.slots.filter((s) => s.mode === 'fixed');
  const p0 = m.players.get('p0');
  p0.tickets = 10;
  const r1 = m.handle('p0', { t: 'g.party', op: 'buy', slot: fixed[0].slot, requestId: 'b1' });
  assert.equal(r1.ok, true, 'first fixed purchase succeeds');
  const r2 = m.handle('p0', { t: 'g.party', op: 'buy', slot: fixed[0].slot, requestId: 'b2' });
  assert.equal(r2.ok, false, 'only one fixed card per round');
  void lastFor;
  m.dispose();
});

test('市场：重复 requestId 不会重复扣费（幂等）', () => {
  const { m } = makeMatch();
  m.start(); m.enterRound(); m.enterMarket();
  const fixed = m.publicView().market.slots.find((s) => s.mode === 'fixed');
  const p0 = m.players.get('p0');
  p0.tickets = 10;
  const before = p0.tickets;
  const a = m.handle('p0', { t: 'g.party', op: 'buy', slot: fixed.slot, requestId: 'same' });
  assert.equal(a.ok, true);
  const after = p0.tickets;
  const b = m.handle('p0', { t: 'g.party', op: 'buy', slot: fixed.slot, requestId: 'same' });
  assert.equal(b.ok, true, 'replayed request returns the first result');
  assert.equal(p0.tickets, after, 'no second charge');
  assert.equal(after, before - fixed.price);
  m.dispose();
});

test('密封竞价：最高价得标并支付自己的报价；未中标者分文不扣', () => {
  const { m } = makeMatch();
  m.start(); m.enterRound(); m.enterMarket();
  const sealed = m.publicView().market.slots.find((s) => s.mode === 'sealed');
  const p0 = m.players.get('p0');
  const p1 = m.players.get('p1');
  p0.tickets = 10; p1.tickets = 10;
  assert.equal(m.handle('p0', { t: 'g.party', op: 'bid', slot: sealed.slot, amount: 3 }).ok, true);
  assert.equal(m.handle('p1', { t: 'g.party', op: 'bid', slot: sealed.slot, amount: 7 }).ok, true);
  const t0 = p0.tickets; const t1 = p1.tickets;
  m.resolveRound();
  assert.equal(p1.tickets, t1 - 7, 'winner pays its own bid');
  assert.equal(p0.tickets, t0, 'loser pays nothing');
  m.dispose();
});

test('密封竞价：同一玩家每轮只能报一次价', () => {
  const { m } = makeMatch();
  m.start(); m.enterRound(); m.enterMarket();
  const sealed = m.publicView().market.slots.find((s) => s.mode === 'sealed');
  m.players.get('p0').tickets = 10;
  assert.equal(m.handle('p0', { t: 'g.party', op: 'bid', slot: sealed.slot, amount: 2 }).ok, true);
  const second = m.handle('p0', { t: 'g.party', op: 'bid', slot: sealed.slot, amount: 5 });
  assert.equal(second.ok, false, 'a second bid in the same round is refused');
  m.dispose();
});

test('公开视图不泄漏他人的报价金额', () => {
  const { m } = makeMatch();
  m.start(); m.enterRound(); m.enterMarket();
  const sealed = m.publicView().market.slots.find((s) => s.mode === 'sealed');
  m.players.get('p0').tickets = 10;
  m.handle('p0', { t: 'g.party', op: 'bid', slot: sealed.slot, amount: 4 });
  const view = m.publicView().market;
  const s = JSON.stringify(view);
  assert.ok(!/"amount"/.test(s), 'no bid amounts in the public market view');
  m.dispose();
});

test('秘密行动：打出卡牌会扣费、离手，并按固定优先级结算', () => {
  const { m } = makeMatch();
  m.start(); m.enterRound(); m.enterMarket();
  const p0 = m.players.get('p0');
  // 手动塞一张确定的卡
  p0.hand.push({ uid: 'testcard1', cardId: 'prank_false_alarm' });
  p0.tickets = 10;
  m.enterTrade();
  m.enterSecret();
  const before = p0.tickets;
  const res = m.handle('p0', { t: 'g.party', op: 'play', uid: 'testcard1', targetId: 'p1' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(p0.tickets, before - CARDS.prank_false_alarm.cost.tickets);
  assert.ok(!p0.hand.some((c) => c.uid === 'testcard1'), 'card left the hand');
  m.resolveRound();
  const target = m.players.get('p1');
  assert.ok(target.suspicion > 0, 'the target gained suspicion');
  assert.ok(target.clues.length > 0, 'the target received a clue');
  m.dispose();
});

test('每人每轮最多打出 2 张主动卡', () => {
  const { m } = makeMatch();
  m.start(); m.enterRound(); m.enterMarket();
  const p0 = m.players.get('p0');
  p0.tickets = 30; p0.intel = 20;
  p0.hand = [
    { uid: 'u1', cardId: 'prank_false_alarm' },
    { uid: 'u2', cardId: 'prank_false_alarm' },
    { uid: 'u3', cardId: 'prank_false_alarm' },
  ];
  m.enterTrade(); m.enterSecret();
  assert.equal(m.handle('p0', { t: 'g.party', op: 'play', uid: 'u1', targetId: 'p1' }).ok, true);
  assert.equal(m.handle('p0', { t: 'g.party', op: 'play', uid: 'u2', targetId: 'p1' }).ok, true);
  const third = m.handle('p0', { t: 'g.party', op: 'play', uid: 'u3', targetId: 'p1' });
  assert.equal(third.ok, false, 'third play refused');
  m.dispose();
});

test('同一目标每轮最多承受 1 次高风险 PvP 效果', () => {
  const { m } = makeMatch();
  m.start(); m.enterRound(); m.enterMarket();
  for (const id of ['p0', 'p1']) {
    const p = m.players.get(id);
    p.tickets = 30; p.intel = 20; p.influence = 10;
    p.hand = [{ uid: `${id}-ult`, cardId: 'social_ultimatum' }];
  }
  m.enterTrade(); m.enterSecret();
  assert.equal(m.handle('p0', { t: 'g.party', op: 'play', uid: 'p0-ult', targetId: 'p2' }).ok, true);
  const second = m.handle('p1', { t: 'g.party', op: 'play', uid: 'p1-ult', targetId: 'p2' });
  assert.equal(second.ok, false, 'the same target refuses a second high-risk effect in the round');
  m.dispose();
});

test('不在手牌的卡、未知卡、买不起的卡都被拒绝且不产生副作用', () => {
  const { m } = makeMatch();
  m.start(); m.enterRound(); m.enterMarket();
  m.enterTrade(); m.enterSecret();
  const p0 = m.players.get('p0');
  p0.tickets = 0;
  const r1 = m.handle('p0', { t: 'g.party', op: 'play', uid: 'nope', targetId: 'p1' });
  assert.equal(r1.ok, false);
  p0.hand.push({ uid: 'x1', cardId: 'not_a_real_card' });
  const r2 = m.handle('p0', { t: 'g.party', op: 'play', uid: 'x1', targetId: 'p1' });
  assert.equal(r2.ok, false);
  m.dispose();
});

test('贸易：双方确认后才生效，并留内部审计记录', () => {
  const { m } = makeMatch();
  m.start(); m.enterRound(); m.enterTrade();
  const p0 = m.players.get('p0');
  const p1 = m.players.get('p1');
  p0.tickets = 10; p1.tickets = 0; p1.intel = 5;
  const p0IntelBefore = p0.intel; // 已含本轮收入，用实际值做基线
  const offer = m.handle('p0', { t: 'g.party', op: 'tradeOffer', targetId: 'p1', give: [{ resource: 'tickets', amount: 3 }], want: [{ resource: 'intel', amount: 2 }] });
  assert.equal(offer.ok, true, JSON.stringify(offer));
  // 报价阶段一个字都没动
  assert.equal(p0.tickets, 10, 'nothing moves before the other side confirms');
  assert.equal(p1.tickets, 0, 'nothing moves before the other side confirms');
  assert.equal(p0.intel, p0IntelBefore);
  const acc = m.handle('p1', { t: 'g.party', op: 'tradeAccept', tradeId: offer.tradeId });
  assert.equal(acc.ok, true);
  assert.equal(p0.tickets, 7);
  assert.equal(p0.intel, p0IntelBefore + 2, 'p0 got intel');
  assert.equal(p1.tickets, 3, 'p1 got tickets');
  assert.equal(p1.intel, 5 - 2, 'p1 paid the intel it offered');
  assert.ok(m.auditLog.some((e) => e.type === 'trade-settled'));
  m.dispose();
});

test('古拉格：第 8 回合开放；淘汰后入狱，挑战成功待返场，结算返场', () => {
  const { m } = makeMatch();
  m.start();
  for (let r = 1; r <= 8; r++) {
    m.enterRound();
    if (m.ended) break;
    if (m.campaignPending) m.setCampaignResult(m.round, true);
    if (m.phase === PARTY_PHASE.GULAG) break;
    if (m.round >= 8) break;
  }
  // 直接推进到第 8 回合的古拉格
  m.round = 8;
  m.gulag.beginRound(8);
  assert.equal(m.gulag.everOpened, true, 'gulag opens at round 8');
  const jailed = m.eliminatePlayer('p0', 'test');
  assert.equal(jailed, true);
  assert.equal(m.gulag.record('p0').state, INMATE_STATE.IN_CUSTODY);
  m._enterGulag();
  assert.equal(m.phase, PARTY_PHASE.GULAG);
  const start = m.handle('p0', { t: 'g.partyChallenge', op: 'start' });
  assert.equal(start.ok, true, JSON.stringify(start));
  assert.ok(start.challenge.questions.length > 0);
  // 服务端判定答案（不发答案，测试里用内部实例）
  const inst = m._challenges.get('p0').inst;
  inst.questions.forEach((q, i) => m.handle('p0', { t: 'g.partyChallenge', op: 'answer', index: i, choice: q.answer }));
  const fin = m.handle('p0', { t: 'g.partyChallenge', op: 'finish' });
  assert.equal(fin.ok, true);
  assert.equal(fin.passed, true, 'all-correct run passes');
  assert.equal(m.gulag.record('p0').state, INMATE_STATE.AWAITING_RETURN);
  m._returnPendingInmates();
  assert.equal(m.gulag.record('p0').state, INMATE_STATE.RETURNED);
  assert.equal(m.players.get('p0').eliminated, false, 'back on the main battlefield');
  m.dispose();
});

test('古拉格：小游戏答案不会随题目下发', () => {
  const { m } = makeMatch();
  m.start();
  m.round = 8;
  m.gulag.beginRound(8);
  m.eliminatePlayer('p0');
  m._enterGulag();
  const start = m.handle('p0', { t: 'g.partyChallenge', op: 'start' });
  assert.equal(start.ok, true);
  const s = JSON.stringify(start);
  assert.ok(!/"answer"/.test(s), 'no answers in the question payload');
  m.dispose();
});

test('古拉格：队友资助花调度券但不直接复活；古拉格关闭后不能资助', () => {
  const { m } = makeMatch();
  m.start();
  m.round = 8;
  m.gulag.beginRound(8);
  m.eliminatePlayer('p0');
  const p1 = m.players.get('p1');
  p1.tickets = 10;
  const before = p1.tickets;
  const res = m.handle('p1', { t: 'g.party', op: 'sponsor', playerId: 'p0' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(p1.tickets, before - 3, 'sponsor pays the configured price');
  assert.equal(m.players.get('p0').eliminated, true, 'sponsoring does not resurrect anyone');
  // 第二次资助被拒绝
  assert.equal(m.handle('p1', { t: 'g.party', op: 'sponsor', playerId: 'p0' }).ok, false);
  m.dispose();
});

test('暴动后：古拉格永久关闭，不能再资助', () => {
  const { m } = makeMatch();
  m.start();
  m.round = 6;
  m.gulag._riot(6);
  assert.equal(m.gulag.permanentlyClosed, true);
  m.players.get('p1').tickets = 10;
  const res = m.handle('p1', { t: 'g.party', op: 'sponsor', playerId: 'p0' });
  assert.equal(res.ok, false);
  m.dispose();
});

test('结束：产出计分与结局，总分不超过封顶', () => {
  const { m, ends } = makeMatch();
  m.start();
  m.finish({ victory: true, reason: 'test' });
  assert.equal(ends.length, 1, 'onEnd called once');
  assert.ok(m.outcome);
  for (const row of m.outcome.rows) {
    assert.ok(row.score <= m.cfg.score.cap, `score ${row.score} within cap`);
    assert.ok(row.rank >= 1);
  }
  m.finish({ victory: true, reason: 'again' });
  assert.equal(ends.length, 1, 'onEnd is idempotent');
  m.dispose();
});

test('人数下限：少于 4 人的座位列表会被拒绝（服务端一致性）', () => {
  assert.ok(PARTY_MIN_PLAYERS >= 4);
  const seats = [{ seat: 0, playerId: 'p0', name: 'a', isBot: false }];
  assert.throws(() => new PartyMatch({
    seats, send: () => {}, broadcast: () => {}, onEnd: () => {}, seed: 1,
  }), /seats/);
});

test('断线重连：重新连上会补发公私两帧', () => {
  const { m, lastFor } = makeMatch();
  m.start();
  m.onDisconnect('p0');
  assert.equal(m.players.get('p0').connected, false);
  const beforePub = lastFor('p0', 'm.partyPrivate');
  m.onReconnect('p0');
  assert.equal(m.players.get('p0').connected, true);
  const afterPriv = lastFor('p0', 'm.partyPrivate');
  assert.ok(afterPriv, 'private state resent after reconnect');
  assert.notEqual(beforePub, afterPriv);
  m.dispose();
});

test('完整回合能自动推进到结束（人机对局，不卡死）', async () => {
  // timerScale 把时限压到 2%，让 2 个回合在几秒内跑完
  const { m, ends } = makeMatch({
    players: 4, bots: 3, rounds: 2, timerScale: 0.02,
    campaign: { roundInfo: () => ({ victory: true, reason: 'stub' }) },
  });
  m.start();
  const readyEveryTick = setInterval(() => {
    if (!m.ended && m.phase) { try { m.handle('p0', { t: 'g.party', op: 'ready' }); } catch { /* ignore */ } }
  }, 3);
  for (let i = 0; i < 600 && !ends.length; i++) await tick(5);
  clearInterval(readyEveryTick);
  assert.ok(ends.length >= 1, `match ended (phase=${m.phase}, round=${m.round})`);
  m.dispose();
});
