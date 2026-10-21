// test/match/party-lobby.test.js — 《神人派对》接入现有房间/大厅的端到端测试：
// room.create → 座位/就绪 → room.start 起 PartyMatch → m.party / m.partyPrivate 帧下发 → 设置生效。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, Room } from '../../server/lobby.js';
import { PARTY_PHASE } from '../../shared/partyRules.js';

/**
 * 极简 session 注册表：实现 Lobby 用到的 byPlayerId / get / byToken / size。
 * session 自带 send()，把帧收进 frames 数组，便于断言下发内容。
 */
function makeRegistry() {
  const byPlayerId = new Map();
  const byTokenMap = new Map();
  return {
    byPlayerId,
    byTokenMap,
    get size() { return byPlayerId.size; },
    byId(id) { return byPlayerId.get(id) || null; },
    get(id) { return byPlayerId.get(id) || null; },
    byToken(t) { return byTokenMap.get(t) || null; },
    all() { return [...byPlayerId.values()]; },
    sessionsOf() { return [...byPlayerId.values()]; },
    add(session) { byPlayerId.set(session.playerId, session); byTokenMap.set(session.token, session); return session; },
  };
}

function makeSession(id, name, registry) {
  const s = {
    playerId: id, token: `tok-${id}`, name, roomCode: null, addr: `addr-${id}`, limitKey: null,
    connected: true, notice: null, pendingResult: null, resumable: true,
    frames: [],
    send(msg) { s.frames.push(msg); return true; },
  };
  // Lobby broadcasts go through sendPrepared(session.ws, frame); a stub socket records them.
  s.ws = {
    send(raw) {
      try { s.frames.push(JSON.parse(raw)); } catch { s.frames.push({ t: '__raw__', raw }); }
    },
    close() {},
    readyState: 1,
  };
  registry.add(s);
  return s;
}

function makeLobby() {
  const registry = makeRegistry();
  const lobby = new Lobby({
    registry,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    getData: () => ({}),
    now: () => Date.now(),
    seedFn: () => 987654321,
  });
  return { lobby, registry };
}

/** 大厅回复：成功是 { ok: true }，失败是 { error }。 */
const assertSuccess = (r, msg) => assert.ok(r && r.ok === true && !r.error, msg || JSON.stringify(r));
const assertFails = (r, msg) => assert.ok(r && r.error, msg || 'expected an { error } reply');

/** 建一个 8 人派对房（1 真人房主 + 7 个 AI 位）。 */
function setupPartyRoom(lobby, registry, { capacity = 8 } = {}) {
  const host = makeSession('host1', '房主', registry);
  assertSuccess(lobby.onMessage(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity }));
  const room = lobby.rooms.get(host.roomCode);
  assert.ok(room, 'room created');
  assertSuccess(lobby.onMessage(host, { t: 'room.party', partyMode: true }));
  // 补足 AI 座位到 8
  while (room.seats.filter(Boolean).length < 8) {
    const r = lobby.onMessage(host, { t: 'room.addBot' });
    if (!r.ok) break;
  }
  return { host, room };
}

test('房间可切换到神人派对模式，room.state 带上派对设置', () => {
  const { lobby, registry } = makeLobby();
  const { host, room } = setupPartyRoom(lobby, registry);
  assert.equal(room.partyMode, true);
  const state = room.toState();
  assert.ok(state.party, 'room state carries party settings');
  assert.equal(state.party.partyMode, true);
  assert.equal(state.party.minPlayers, 4);
  assert.equal(state.party.maxPlayers, 20);
  assert.ok(state.party.rounds >= 4);
  void host;
});

test('非房主不能改派对设置；开局后也不能改', () => {
  const { lobby, registry } = makeLobby();
  const host = makeSession('host1', '房主', registry);
  const other = makeSession('other1', '路人', registry);
  assertSuccess(lobby.onMessage(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 8 }));
  // 路人先占到第 2 个座位，再补 AI
  assertSuccess(lobby.onMessage(other, { t: 'room.join', code: host.roomCode }));
  assertSuccess(lobby.onMessage(host, { t: 'room.party', partyMode: true }));
  const room = lobby.rooms.get(host.roomCode);
  while (room.seats.filter(Boolean).length < 8) {
    if (!lobby.onMessage(host, { t: 'room.addBot' }).ok) break;
  }
  const r = lobby.onMessage(other, { t: 'room.party', partyMode: false });
  assertFails(r);
  assert.equal(r.error, 'NOT_HOST');
});

test('人数不足 4 人时拒绝开局（服务端权威）', () => {
  const { lobby, registry } = makeLobby();
  const host = makeSession('h2', '房主2', registry);
  lobby.onMessage(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 4 });
  const room = lobby.rooms.get(host.roomCode);
  lobby.onMessage(host, { t: 'room.party', partyMode: true });
  // 只留 2 个座位（房主 + 1 AI），其余清空
  let added = 0;
  while (added < 1) { if (lobby.onMessage(host, { t: 'room.addBot' }).ok) added++; else break; }
  const occupied = room.seats.filter(Boolean).length;
  assert.equal(occupied, 2);
  const r = lobby.onMessage(host, { t: 'room.start' });
  assertFails(r, 'must refuse fewer than 4 players');
  assert.equal(r.error, 'PARTY_TOO_FEW');
});

test('房主开局后，对局跑起来并给真人下发 m.party 与 m.partyPrivate', async () => {
  const { lobby, registry } = makeLobby();
  const { host, room } = setupPartyRoom(lobby, registry);
  assert.equal(room.seats.filter(Boolean).length, 8, 'eight seats before the start');
  const res = lobby.onMessage(host, { t: 'room.start' });
  assertSuccess(res);
  const match = room.match;
  assert.ok(match, 'a match object exists');
  assert.ok(match instanceof Object);
  // 派对引擎的公共帧与私有帧都已下发
  const partyFrames = host.frames.filter((f) => f.t === 'm.party');
  const privFrames = host.frames.filter((f) => f.t === 'm.partyPrivate');
  assert.ok(partyFrames.length >= 1, 'host received m.party');
  assert.ok(privFrames.length >= 1, 'host received m.partyPrivate');
  const priv = privFrames[privFrames.length - 1];
  assert.ok(priv.role && priv.role.faction, 'the private frame carries the role');
  assert.ok(priv.hand, 'the private frame carries the hand');
  // 公共帧不带任何人的身份
  const pub = partyFrames[partyFrames.length - 1];
  assert.ok(!/objective|faction":/.test(JSON.stringify(pub)));
  // 阶段是简报或之后
  assert.ok(Object.values(PARTY_PHASE).includes(pub.phase), `phase ${pub.phase}`);
  match.dispose();
});

test('开局后房间的 inMatch 为真，且玩家可发 g.party intent', () => {
  const { lobby, registry } = makeLobby();
  const { host, room } = setupPartyRoom(lobby, registry);
  lobby.onMessage(host, { t: 'room.start' });
  const state = room.toState();
  assert.equal(state.inMatch, true);
  // ready 是简报阶段合法操作
  const r = lobby.onMessage(host, { t: 'g.party', op: 'ready' });
  assertSuccess(r);
  room.match.dispose();
});

test('非法派对设置被整条拒绝', () => {
  const { lobby, registry } = makeLobby();
  const host = makeSession('h3', '房主3', registry);
  lobby.onMessage(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 8 });
  const bad1 = lobby.onMessage(host, { t: 'room.party', extraChanceCost: 0 });
  assertFails(bad1, 'cost 0 refused');
  const bad2 = lobby.onMessage(host, { t: 'room.party', splitKnowledge: 'EVERYONE' });
  assertFails(bad2, 'unknown knowledge mode refused');
  const bad3 = lobby.onMessage(host, { t: 'room.party', rounds: 999 });
  assertFails(bad3, 'absurd round count refused');
  const good = lobby.onMessage(host, { t: 'room.party', extraChanceCost: 4, splitKnowledge: 'ALL' });
  assertSuccess(good);
  const room = lobby.rooms.get(host.roomCode);
  assert.equal(room.partyConfig.extraChanceCost, 4);
  assert.equal(room.partyConfig.splitKnowledge, 'ALL');
});

test('普通（非派对）房间仍走原来的 PvE Match，不受影响', () => {
  const { lobby, registry } = makeLobby();
  const host = makeSession('h4', '房主4', registry);
  lobby.onMessage(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 4 });
  const room = lobby.rooms.get(host.roomCode);
  assert.equal(room.partyMode, false);
  assert.equal(room.toState().party, null);
  assert.equal(room.match, null);
});

test('Room 默认不是派对房（不改变原有默认行为）', () => {
  const r = new Room('ABCD', 'coop', 'NORMAL', Date.now(), 8);
  assert.equal(r.partyMode, false);
  assert.deepEqual(r.partyConfig, {});
  assert.equal(r.partyRounds, 12);
  assert.equal(r.toState().party, null);
});
