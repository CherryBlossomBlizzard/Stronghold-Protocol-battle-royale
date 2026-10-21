// test/match/party-gulag-e2e.test.js — 古拉格在**完整对局流程**里的行为（不是单元测试的孤立方法调用）：
// 真实 PartyMatch、真实计时器、真实阶段推进，验证第 6/8 回合检定、入狱、挑战、暴动关闭与返场。

import test from 'node:test';
import assert from 'node:assert/strict';
import { PartyMatch } from '../../server/match/party/PartyMatch.js';
import { GULAG, INMATE_STATE, PARTY_PHASE } from '../../shared/partyRules.js';

/** 用极短的阶段时限造一局，便于把回合推进到第 6 / 8 回合。 */
function makeFastMatch({ seed = 424242, rounds = 12, campaignVictory = true } = {}) {
  const seats = [0, 1, 2, 3].map((i) => ({ seat: i, playerId: `p${i}`, name: `P${i}`, isBot: i >= 1, connected: true }));
  return new PartyMatch({
    roomCode: 'E2E1', seats, seed, rounds, timerScale: 0.02,
    campaign: { roundInfo: () => ({ victory: campaignVictory, reason: 'stub' }) },
    send: () => true, broadcast: () => {}, onEnd: () => {},
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 找一个「第 6 回合恰好掷出 6」的种子。直接用引擎自身的确定性随机源预演，
 * 不必真的把对局跑到第 6 回合（快得多，语义完全相同）。
 */
function findRiotingSeed({ max = 5000 } = {}) {
  for (let seed = 1; seed <= max; seed++) {
    const m = makeFastMatch({ seed });
    const rec = m.gulag._roll(6, 'FIRST');
    const triggered = !!(rec && rec.triggered);
    m.dispose();
    if (triggered) return seed;
  }
  return null;
}

/**
 * 找一个「古拉格会开放但不会暴动」的种子：第 6 回合与第 8 回合都不掷出 6。
 */
function findCalmSeed({ max = 5000 } = {}) {
  for (let seed = 1; seed <= max; seed++) {
    const m = makeFastMatch({ seed });
    const a = m.gulag._roll(6, 'FIRST');
    let b = null;
    if (!a.triggered) b = m.gulag._roll(8, 'SECOND');
    const calm = !m.gulag.permanentlyClosed;
    m.dispose();
    void b;
    if (calm) return seed;
  }
  return null;
}

/** 一直 ready 直到条件成立或超时。 */
async function driveUntil(m, cond, { timeoutMs = 20000, onTick = null } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { m.handle('p0', { t: 'g.party', op: 'ready' }); } catch { /* ignore */ }
    if (onTick) onTick(m);
    if (cond(m)) return true;
    if (m.ended) return cond(m);
    await sleep(5);
  }
  return cond(m);
}

test('完整对局：第 6 回合掷一次 D20，第 8 回合再掷一次（未触发时），古拉格第 8 回合开放', async () => {
  const m = makeFastMatch({ seed: 991 });
  m.start();
  const reached = await driveUntil(m, (x) => x.round >= 9 || x.ended);
  assert.ok(reached, `progressed to round 9 (round=${m.round}, phase=${m.phase})`);
  const rolls = m.gulag.rolls;
  assert.ok(rolls.length >= 1, 'at least the round-6 roll happened');
  const first = rolls.find((r) => r.when === 'FIRST');
  assert.ok(first, 'a FIRST roll exists');
  assert.equal(first.round, 6, 'the first roll is on round 6');
  assert.equal(first.sides, 20, 'it is a D20');
  const second = rolls.find((r) => r.when === 'SECOND');
  if (!first.triggered) {
    assert.ok(second, 'a second roll exists when round 6 did not trigger');
    assert.equal(second.round, 8, 'the second roll is on round 8');
    assert.equal(second.sides, 20);
  } else {
    assert.equal(second, undefined, 'no second roll after a round-6 riot');
  }
  assert.equal(m.gulag.everOpened, true, 'the gulag opened by round 8');
  m.dispose();
});

test('完整对局：暴动后古拉格永久关闭，第 8 回合不再掷骰', async () => {
  const seed = findRiotingSeed();
  assert.ok(seed, 'found a seed whose round-6 roll is exactly 6');
  const m = makeFastMatch({ seed });
  m.start();
  await driveUntil(m, (x) => x.gulag.rolls.some((r) => r.when === 'FIRST') || x.ended);
  const first = m.gulag.rolls.find((r) => r.when === 'FIRST');
  assert.ok(first && first.triggered, 'the riot triggered on round 6');
  assert.equal(m.gulag.permanentlyClosed, true);
  // 推进到第 8 回合：不能再掷骰
  await driveUntil(m, (x) => x.round >= 9 || x.ended);
  assert.equal(m.gulag.rolls.length, 1, 'only one roll for the whole match');
  assert.equal(m.gulag.state, GULAG.PERMANENTLY_CLOSED);
  m.dispose();
});

test('完整对局：暴动之后古拉格不再收新囚犯', async () => {
  const seed = findRiotingSeed();
  assert.ok(seed);
  const m = makeFastMatch({ seed });
  m.start();
  await driveUntil(m, (x) => x.gulag.rolls.some((r) => r.when === 'FIRST') || x.ended);
  assert.equal(m.gulag.riotTriggered, true);
  const jailed = m.eliminatePlayer('p0', 'campaign');
  assert.equal(jailed, false, 'a closed gulag accepts no new inmates');
  assert.equal(m.gulag.record('p0').state, INMATE_STATE.NONE, 'and leaves the player out of custody');
  m.dispose();
});

test('完整对局：古拉格开放后淘汰 → 在押 → 挑战 → 待返场 → 下一次主战场结算返场', async () => {
  const seed = findCalmSeed();
  assert.ok(seed, 'found a seed that reaches round 8 without a riot');
  const m = makeFastMatch({ seed });
  m.start();
  const ok = await driveUntil(m, (x) => x.round >= 8);
  assert.ok(ok, 'reached round 8');
  assert.equal(m.gulag.everOpened, true, 'gulag opened');
  assert.equal(m.gulag.permanentlyClosed, false, 'no riot for this seed');
  const jailed = m.eliminatePlayer('p1', 'campaign');
  assert.equal(jailed, true, 'the player entered the gulag');
  assert.equal(m.gulag.record('p1').state, INMATE_STATE.IN_CUSTODY);
  // 挑战：本人参加
  m.phase = PARTY_PHASE.GULAG;
  const start = m.handle('p1', { t: 'g.partyChallenge', op: 'start' });
  assert.equal(start.ok, true, JSON.stringify(start));
  const inst = m._challenges.get('p1').inst;
  inst.questions.forEach((q, i) => m.handle('p1', { t: 'g.partyChallenge', op: 'answer', index: i, choice: q.answer }));
  const fin = m.handle('p1', { t: 'g.partyChallenge', op: 'finish' });
  assert.equal(fin.passed, true);
  assert.equal(m.gulag.record('p1').state, INMATE_STATE.AWAITING_RETURN);
  // 下一次主战场结算才返场
  m._returnPendingInmates();
  assert.equal(m.gulag.record('p1').state, INMATE_STATE.RETURNED);
  assert.equal(m.players.get('p1').eliminated, false);
  m.dispose();
});
