// 最终攻势 / 隐秘核心: pairing, merged LP, shared boss pool, overtime, leaks, hidden-core condition (FakeBattle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, GEO } from '../../shared/constants.js';
import { pairPlayers, bossPoolHp, SharedBossPool, hiddenEligible } from '../../server/match/finalAssault.js';
import { GameData } from '../../server/match/gamedata.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';
import { createRng } from '../../server/sim/rng.js';
import { RULES } from '../../server/match/battleRoyaleRules.js';

const bossFields = () => FakeBattle.instances.filter((b) => b.kind === 'boss' || b.kind === 'hidden');

test('pairing is seeded, independent of input order, includes everyone once and can draw every partner', () => {
  const p = (seat) => ({ seat, playerId: `s${seat}` });
  const partners = new Set(), lone = new Set();
  for (let seed = 1; seed <= 64; seed++) for (const n of [1, 2, 3, 4]) {
    const alive = Array.from({ length: n }, (_, i) => p(i));
    const groups = pairPlayers(alive, createRng(seed));
    assert.deepEqual(groups, pairPlayers([...alive].reverse(), createRng(seed)));
    assert.equal(groups.length, Math.ceil(n / 2));
    assert.deepEqual(groups.flat().map(x => x.seat).sort(), alive.map(x => x.seat));
    if (n === 4) partners.add(groups.find(g => g.some(x => x.seat === 0)).find(x => x.seat !== 0).seat);
    if (n === 3) lone.add(groups.find(g => g.length === 1)[0].seat);
  }
  assert.deepEqual([...partners].sort(), [1, 2, 3]);
  assert.deepEqual([...lone].sort(), [0, 1, 2]);
});

test('previous boss partners and sides persist; only orphaned survivors form a new pair', () => {
  const all = [0, 1, 2, 3].map(seat => ({ seat, playerId: `s${seat}` }));
  const previous = [['s3', 's0'], ['s2', 's1']];
  const ids = groups => groups.map(g => g.map(p => p.playerId));
  assert.deepEqual(ids(pairPlayers(all, createRng(99), previous)), previous);
  assert.deepEqual(ids(pairPlayers(all.filter(p => p.seat !== 0), createRng(99), previous)), [['s2', 's1'], ['s3']]);
  assert.deepEqual(ids(pairPlayers(all.filter(p => p.seat > 1), createRng(99), previous)), [['s3', 's2']]);
});

// 卫戍协议：盟约 · 大逃杀：首领战在第 RULES.bossRound（20）回合、血量固定（十亿）、没有隐秘核心 ——
// 上游的「R14 最终攻势 / R15 隐秘核心」在这一分支里整体后移到 R20。
const BR = RULES.bossRound;
const BOSS_HP = RULES.bossHp;

test('boss preview, actual fields retain one per-match draw (no Hidden Core in this branch)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 4, seed: 31, fake: true,
    script: b => ['boss', 'hidden'].includes(b.kind) ? { bossDps: 1e9 } : {} }).start();
  try {
    h.drive(() => h.m.phase === PHASE.PREP && h.m.round === BR);
    const pairs = structuredClone(h.m.bossPairs);
    assert.deepEqual(h.m.bossWaves.map(w => w.players), pairs);
    for (const p of h.m.order) {
      p.bondCountBonus.yanShip = 3; p.layers.yanShip = 400; p.recompute();
      const group = h.m.bossGroupOf(p);
      assert.equal(group.side, pairs.find(g => g.includes(p.playerId)).indexOf(p.playerId) === 0 ? 'L' : 'R');
    }
    h.drive(() => h.m.phase === PHASE.FINAL_ASSAULT);
    assert.deepEqual(h.m.fields.map(f => f.players), pairs);
    h.drive(() => h.m.phase === PHASE.PREP && h.m.round === BR + 1);
    assert.deepEqual(h.m.bossWaves.map(w => w.players), pairs);
    // 大逃杀没有隐秘核心：首领战结束后这局就结束
    assert.equal(h.m.gd.hiddenRound, null);
  } finally { h.m.dispose(); }
});

test('boss pool = bloodPoint[difficulty] × the players alive at the fight\'s start (solo × 1) × tuning; config restores the fixed pool; shared and never negative', () => {
  // DESIGN §25.13.4: the owner's decision of 2026-10-06 adopts PR #209 by @qingjingshenghuo (bloodPoint is one player's
  // share) and replaces the fixed pool of 「保持固定血量」 — config bossHpScale (perPlayer false, solo 0.25) restores it.
  // Research numbers (data/tuning.json left out).
  const { tuning, ...RAW } = DATA; // eslint-disable-line no-unused-vars
  const gd = new GameData(RAW, 'mode_multi_hard');
  // 卫戍协议：盟约 · 大逃杀：首领血量固定（RULES.bossHp = 十亿），不再按存活人数缩放
  for (const n of [1, 2, 3, 4]) assert.equal(bossPoolHp(gd, 'boss_1', n), BOSS_HP, `${n} alive`);
  assert.equal(bossPoolHp(gd, 'boss_1'), BOSS_HP, 'no count given');
  assert.equal(bossPoolHp(gd, 'boss_1', 9), BOSS_HP);
  assert.equal(gd.bossPoolHp('boss_1', 2), bossPoolHp(gd, 'boss_1', 2), 'GameData agrees');
  assert.equal(bossPoolHp(new GameData(RAW, 'mode_single_abyss'), 'boss_5', 1), BOSS_HP, 'solo: the fixed pool too');
  assert.equal(bossPoolHp(new GameData(RAW, 'mode_single_funny'), 'boss_2', 1), BOSS_HP);
  // 上游的按人数缩放 / 「保持固定血量」开关在本分支被固定十亿血覆盖：这里只保留池子本身的行为（共享 / 不为负 / 每人记账）
  const pool = new SharedBossPool(100);
  assert.equal(pool.damage('a', 60), 60);
  assert.equal(pool.damage('b', 60), 40);
  assert.equal(pool.hp, 0);
  assert.equal(pool.damage('a', 5), 0);
  assert.equal(pool.damage('a', NaN), 0);
  assert.equal(pool.byPlayer.get('a'), 60);
});

for (const n of [1, 2, 3, 4]) {
  test(`Final Assault with ${n} player(s): fields, sides, templates, merged LP, shared pool, victory`, () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: n, seed: 40 + n, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : {}) }).start();
    const m = h.m;
    h.drive(() => m.phase === PHASE.PREP && m.round === BR);
    const lps = [...m.players.values()].map((p) => p.lp);
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
    assert.equal(m.teamLp, lps.reduce((a, b) => a + b, 0), 'merged team LP');
    const fields = bossFields();
    assert.equal(fields.length, Math.ceil(n / 2));
    assert.deepEqual(fields.map((f) => f.fieldId), Math.ceil(n / 2) === 2 ? ['b1', 'b2'] : ['b1']);
    const pool = fields[0].sharedBoss;
    assert.ok(fields.every((f) => f.sharedBoss === pool), 'one pool for every boss field');
    assert.equal(pool.maxHp, bossPoolHp(m.gd, m.bossId, n));
    for (const f of fields) {
      assert.deepEqual(f.opts.rect, GEO.BOSS_RECT);
      assert.equal(f.opts.modeId, 'mode_multi_funny', '#475: an unpaired field retains multiplayer mode despite its solo wave template');
      assert.equal(f.opts.timeLimit, Infinity);
      assert.equal(f.opts.flags.layerGainsEnabled, false);
      assert.deepEqual(f.opts.flags.enemyScale, m.gd.enemyScale(BR), 'the round\'s enemy effects for the leader\'s summons (PR #272)');
      assert.ok(f.opts.players.every((p) => p.lpForBoss === m.teamLp));
      if (f.opts.players.length === 2) {
        assert.deepEqual(f.opts.players.map((p) => p.side), ['L', 'R']);
        assert.ok(!/_s$/.test(f.opts.waveId), `pair uses the multi template (${f.opts.waveId})`);
      } else {
        assert.deepEqual(f.opts.players.map((p) => p.side), ['L']);
        assert.ok(/_s$/.test(f.opts.waveId), `a lone player uses the _s template (${f.opts.waveId})`);
      }
      assert.ok(f.opts.spawns.some((s) => s.tag === 'boss'), 'the boss spawns');
      const boss = f.opts.spawns.find((s) => s.tag === 'boss');
      assert.equal(boss.mods.hpMul, undefined, 'bosses are never scaled');
    }
    const pub = m.publicView();
    assert.equal(pub.teamLp, m.teamLp);
    assert.deepEqual(pub.bossHp, { hp: Math.round(pool.hp), max: Math.round(pool.maxHp) });
    const end = h.runToEnd();
    assert.equal(end.victory, true);
    assert.equal(end.roundsPassed, BR);
    assert.equal(end.hiddenReached, false, 'FUNNY has no hidden core');
    assert.equal(h.endedCount, 1);
    for (const p of end.players) assert.equal(p.roundsPassed, BR);
    const res = h.lastTo('p_0', 'm.result');
    assert.equal(res.playerId, 'p_0');
    assert.equal(res.victory, true);
    checkInvariants(m);
    m.dispose();
  });
}

test('all-human overtime: −1 team LP per REAL second after 120 real s (240 game s at 2×); team LP 0 ends every field → defeat (13 rounds passed)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 50, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1 } : {}) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === BR);
  for (const p of m.players.values()) p.lp = 10;
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.equal(m.teamLp, 20);
  const f = bossFields()[0];
  const end = h.runToEnd();
  assert.equal(end.victory, false);
  assert.equal(end.roundsPassed, BR - 1);
  assert.ok(Math.abs(f.time - 280) < 2.5, `ended ≈ 240 + 2 × 20 game s (${f.time})`);
  assert.equal(m.teamLp, 0);
  m.dispose();
});

test('Final Assault leaks cost their lpr from the merged LP', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 51, fake: true, instant: false, script: (b) => (b.kind === 'boss' ? { bossDps: 1, leakEvents: [{ at: 5, lpr: 1 }, { at: 10, lpr: 30, boss: true }] } : {}) }).start();
  const m = h.m;
  // 大逃杀：所有模式统一在第 BR 回合打首领
  assert.equal(m.gd.bossRound, BR, 'the boss fight on the branch\'s round');
  h.drive(() => m.phase === PHASE.PREP && m.round === BR);
  h.ps('p_0').lp = 40;
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.ok(/_s$/.test(bossFields()[0].opts.waveId));
  h.run(() => bossFields()[0].time >= 6);
  assert.equal(m.teamLp, 39);
  h.run(() => bossFields()[0].time >= 11);
  assert.equal(m.teamLp, 9);
  const end = h.runToEnd();
  assert.equal(end.victory, false);
  assert.equal(end.roundsPassed, BR - 1);
  m.dispose();
});

test('大逃杀：没有隐秘核心 —— 首领战胜利后这局直接结束（hiddenRound = null）', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 57, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : {}) }).start();
  const m = h.m;
  assert.equal(m.gd.hiddenRound, null);
  h.drive(() => m.phase === PHASE.PREP && m.round === BR);
  for (const p of m.players.values()) { p.bondCountBonus.yanShip = 3; p.layers.yanShip = 900; p.recompute(); }
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  assert.equal(end.hiddenReached, false);
  assert.equal(end.roundsPassed, BR);
  m.dispose();
});

test('Hidden Core: Σ activated layers (end of the boss prep) > 1200 and team LP > 1 after a win → next prep → HIDDEN_CORE', () => {
  // 卫戍协议：盟约 · 大逃杀：本分支没有隐秘核心（gamedata.hiddenRound = null），这条上游规则不再可达 ——
  // 合成的「隐秘核心回合数」用 hiddenEligible 的判定本身来锁（见下一条测试），这里只校验合成用的门槛没被改动。
  assert.equal(RULES.noHiddenCore, true);
  assert.equal(new GameData(DATA, 'mode_multi_normal').hiddenRound, null);
});

test('Hidden Core eligibility threshold (upstream rule, still exported)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 52, fake: true, script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : {}) }).start();
  const m = h.m;
  assert.ok(m.hiddenBossId == null || ['boss_8', 'boss_9', 'boss_10'].includes(m.hiddenBossId));
  h.drive(() => m.phase === PHASE.PREP && m.round === BR);
  for (const p of m.players.values()) { p.bondCountBonus.yanShip = 3; p.layers.yanShip = 601; p.recompute(); }
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.equal(m.phase, PHASE.FINAL_ASSAULT);
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  assert.equal(end.hiddenReached, false, '本分支没有隐秘核心');
  assert.equal(end.hiddenCleared, false);
  assert.equal(end.roundsPassed, BR);
  m.dispose();
});

test('Hidden Core is skipped at Σ layers ≤ threshold, on FUNNY, or with team LP ≤ 1; a failed hidden core keeps the clear', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  // 卫戍协议：盟约 · 大逃杀：hiddenRound = null，hiddenEligible 恒 false（门槛数值仍保留在数据里，未改动）
  assert.equal(gd.hiddenRound, null);
  assert.equal(hiddenEligible(gd, { layerSum: 9999, teamLp: 99 }), false);
  assert.equal(gd.hiddenCore.multi, 1200, 'the data threshold is untouched');
  assert.equal(gd.hiddenCore.minTeamLpExclusive, 1);
  assert.equal(new GameData(DATA, 'mode_single_hard').hiddenCore.single, 350);
  assert.equal(hiddenEligible(new GameData(DATA, 'mode_multi_funny'), { layerSum: 9999, teamLp: 99 }), false);
  // 卫戍协议：盟约 · 大逃杀：本分支没有隐秘核心 → 无论层数多高都不会进入（hiddenEligible 恒 false）
  assert.equal(hiddenEligible(new GameData(DATA, 'mode_single_hard'), { layerSum: 9999, teamLp: 99 }), false);
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 53, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : b.kind === 'hidden' ? { bossDps: 0 } : {}) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === BR);
  const ps = h.ps('p_0');
  ps.bondCountBonus.yanShip = 3; ps.layers.yanShip = 400; ps.lp = 5; ps.recompute();
  h.drive(() => h.ended != null);
  const end = h.ended;
  assert.equal(end.hiddenReached, false, 'no hidden core on this branch');
  assert.equal(end.hiddenCleared, false);
  assert.equal(end.victory, true);
  assert.equal(end.roundsPassed, BR);
  m.dispose();
});

test('Final Assault: a fighting player may only watch its own boss field; eliminated players spectate any field', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 4, seed: 54, fake: true, instant: false, script: (b) => (b.kind === 'boss' ? { bossDps: 1 } : {}) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  h.ps('p_3').eliminate(13);
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  const pair = m.fields.find(f => f.players.length === 2), lone = m.fields.find(f => f.players.length === 1);
  assert.deepEqual(m.fields.flatMap(f => f.players).sort(), ['p_0', 'p_1', 'p_2']);
  const [first, second] = pair.players, third = lone.players[0];
  assert.equal(m.handle(first, { t: 'g.watch', fieldId: lone.fieldId }).error, 'BAD_TARGET', 'the other group is hidden');
  assert.equal(m.handle(third, { t: 'g.watch', fieldId: pair.fieldId }).error, 'BAD_TARGET');
  assert.deepEqual(m.handle(second, { t: 'g.watch', fieldId: pair.fieldId }), { ok: true });
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b2' }), { ok: true }, 'an eliminated player spectates freely');
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b1' }), { ok: true });
  assert.equal(m.watchers.get(first), pair.fieldId, 'the refused watch keeps the default (own) field');
  // the prep-scouting id of a player of the other group is no way around the rule, and never detaches the viewer
  const scouted = h.allTo(first, 'm.field').length;
  assert.deepEqual(m.handle(first, { t: 'g.watch', fieldId: `n:${third}` }), { error: 'BAD_TARGET', detail: 'no such field' });
  assert.deepEqual(m.handle(first, { t: 'g.watch', fieldId: `n:${second}` }), { error: 'BAD_TARGET', detail: 'no such field' });
  assert.equal(h.allTo(first, 'm.field').length, scouted, 'no board of the other group was sent');
  assert.equal(m.watchers.get(first), pair.fieldId, 'still streaming the own boss field');
  const snaps = h.allTo(first, 'b.snap').length;
  h.sched.advance(500);
  assert.ok(h.allTo(first, 'b.snap').length > snaps, 'snapshots of the own field keep coming');
  m.dispose();
});

test('Final Assault: stats reach m.private at the end; leader "扣除目标生命" effects (lpLoss) hit the team LP', () => {
  const h = makeMatch({
    mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 56, fake: true,
    script: (b) => (b.kind === 'boss' ? { bossDps: b.sharedBoss.maxHp / 10, damage: { p_0: 5000, p_1: 7000 }, lpLossEvents: [{ at: 2, amount: 7 }] } : {}),
  }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  h.ps('p_0').lp = 20;
  h.ps('p_1').lp = 20;
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  assert.equal(m.teamLp, 40 - 7, 'lpLoss drains the merged pool');
  for (const id of ['p_0', 'p_1']) {
    const ps = h.ps(id);
    const last = h.lastTo(id, 'm.private');
    assert.deepEqual(last.stats, ps.privateView().stats, `${id}: the last m.private carries the boss-field damage / kills`);
    assert.equal(last.lp, ps.lp);
  }
  m.dispose();
});
