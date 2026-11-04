// test/lobby-search.test.js — 搜寻队友 (官方 联合模拟 matchmaking, research 06 §3.3) and 同盟等待室的交流 (room.emote):
//   * room.search queues the player; a full 难度+容量 group assembles a room at once (the first entry is the host);
//   * 快速搜寻 AI-fills after MATCH_FAST_FILL_MS, 精确搜寻 after the official matchTimeMax (MATCH_TIMEOUT_MS);
//   * room.searchCancel leaves the queue; disconnect / create / join dequeue; searching while in a room is WRONG_PHASE;
//   * room.emote broadcasts m.roomEmote to every member and rate-limits with the official chatCD; spectators may not.
//
// Boots real servers in-process on random ports (startServer({ port: 0 })) like test/lobby.test.js.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, EMOTES, MATCH_TIMEOUT_MS, MATCH_FAST_FILL_MS } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect(opts) {
      const c = await TestClient.connect(getUrl(), opts);
      open.add(c);
      return c;
    },
    async player(name) {
      const c = await this.connect();
      const w = await c.hello(name);
      c.id = w.playerId;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}

describe('protocol shape: room.emote / room.search / room.searchCancel', () => {
  test('room.emote accepts exactly the official emote ids', () => {
    for (const id of EMOTES) assert.equal(validateC2S({ t: 'room.emote', id }), null, id);
    for (const bad of ['happy', 'autochess_room_hello', '__proto__', '', 7, null]) {
      assert.notEqual(validateC2S({ t: 'room.emote', id: bad }), null, String(bad));
    }
  });
  test('room.search needs a mode and a difficulty, capacity optional and one of ROOM_CAPACITIES', () => {
    assert.equal(validateC2S({ t: 'room.search', search: 'fast', difficulty: 'NORMAL' }), null);
    assert.equal(validateC2S({ t: 'room.search', search: 'exact', difficulty: 'FUNNY', capacity: 4 }), null);
    assert.notEqual(validateC2S({ t: 'room.search', search: 'turbo', difficulty: 'NORMAL' }), null);
    assert.notEqual(validateC2S({ t: 'room.search', search: 'fast', difficulty: 'NOPE' }), null);
    assert.notEqual(validateC2S({ t: 'room.search', search: 'fast', difficulty: 'NORMAL', capacity: 3 }), null, '3 is not a ROOM_CAPACITY');
    assert.equal(validateC2S({ t: 'room.searchCancel' }), null);
  });
});

describe('搜寻队友 (matchmaking)', () => {
  let srv, pool, cap;
  // a controllable clock on the lobby (Lobby.now): the drain runs on demand (lobby.drainSearch) instead of real seconds
  let clock = { t: 1_000_000 };

  before(async () => {
    cap = { errors: [], log: { info() {}, warn() {}, debug() {}, error: (...a) => cap.errors.push(a.map(String).join(' ')) } };
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log });
    srv.lobby.now = () => clock.t;
    // the real 1 s drain interval would race the manual clock: only drainSearch() calls advance the queue here
    srv.lobby.ensureSearchTimer = () => {};
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  after(async () => {
    await pool?.closeAll();
    srv?.lobby.shutdown('test');
    await srv?.close();
  });

  test('room.search while in a room: WRONG_PHASE; twice: ALREADY; cancel answers ok', async () => {
    const host = await pool.player('Host');
    await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    await host.waitFor('room.state');
    const r = await host.request({ t: 'room.search', search: 'fast', difficulty: 'NORMAL' });
    assert.equal(r.t, 'error');
    assert.equal(r.code, ERR.WRONG_PHASE);
    await host.request({ t: 'room.leave' });

    const a = await pool.player('A');
    const q1 = await a.request({ t: 'room.search', search: 'fast', difficulty: 'HARD', capacity: 4 });
    assert.equal(q1.t, 'ok');
    const s = await a.waitFor('m.search', (m) => m.state === 'queued');
    assert.equal(s.search, 'fast');
    assert.equal(s.difficulty, 'HARD');
    assert.equal(s.capacity, 4);
    assert.equal(s.timeoutSec, Math.round(MATCH_TIMEOUT_MS / 1000));
    const q2 = await a.request({ t: 'room.search', search: 'fast', difficulty: 'HARD' });
    assert.equal(q2.t, 'error');
    assert.equal(q2.code, ERR.ALREADY);
    const c = await a.request({ t: 'room.searchCancel' });
    assert.equal(c.t, 'ok');
    const s2 = await a.waitFor('m.search', (m) => m.state === 'cancelled');
    assert.ok(s2);
  });

  test('room.list: 这台服务器上的同盟房（密钥 / 房主 / 人数 / 是否可加入），在一键加入前就能看到', async () => {
    const host = await pool.player('HostList');
    const created = await host.request({ t: 'room.create', mode: 'coop', difficulty: 'HARD', capacity: 4 });
    assert.equal(created.t, 'ok');
    const st = await host.waitFor('room.state');
    const code = st.code;

    const viewer = await pool.player('Viewer');
    const res = await viewer.request({ t: 'room.list' });
    assert.equal(res.t, 'ok');
    const m = await viewer.waitFor('m.rooms');
    const row = m.rooms.find((r) => r.code === code);
    assert.ok(row, '客房出现在列表里');
    assert.equal(row.difficulty, 'HARD');
    assert.equal(row.capacity, 4);
    assert.equal(row.humans, 1);
    assert.equal(row.bots, 0);
    assert.equal(row.state, 'waiting');
    assert.equal(row.joinable, true);
    assert.equal(row.rulesVariant, 'battle-royale');
    assert.equal(row.mine, false, '别人的房间');
    assert.ok(row.hostName, '带房主名字');

    // 房主自己看：mine = true
    await host.request({ t: 'room.list' });
    const mine = await host.waitFor('m.rooms');
    assert.equal(mine.rooms.find((r) => r.code === code).mine, true);

    // 满员 → 不可加入（4 个座位：房主 + 3 个 AI）
    for (let i = 0; i < 3; i++) await host.request({ t: 'room.addBot' });
    await viewer.request({ t: 'room.list' });
    const full = await viewer.waitFor('m.rooms', (x) => {
      const r = x.rooms.find((y) => y.code === code);
      return r && r.bots === 3;
    });
    const fullRow = full.rooms.find((r) => r.code === code);
    assert.equal(fullRow.joinable, false, '席位满了就不能一键加入');
    await host.request({ t: 'room.leave' });
  });

  test('a full group assembles at once: 4/4 fast searchers land in one room, the first entry hosts', async () => {
    clock.t += 10_000;
    const ps = [];
    for (let i = 0; i < 4; i++) {
      const c = await pool.player(`Q${i}`);
      await c.request({ t: 'room.search', search: 'fast', difficulty: 'NORMAL', capacity: 4 });
      await c.waitFor('m.search', (m) => m.state === 'queued');
      ps.push(c);
    }
    srv.lobby.drainSearch();
    const states = await Promise.all(ps.map((c) => c.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === c.id))));
    const code = states[0].code;
    for (const s of states) assert.equal(s.code, code, 'one shared room');
    assert.equal(states[0].hostId, ps[0].id, 'the first entry is the host');
    assert.equal(states[0].difficulty, 'NORMAL');
    assert.equal(states[0].capacity, 4);
    assert.equal(states[0].seats.filter(Boolean).length, 4);
    // every matched player heard found before the room
    for (const c of ps) await c.waitFor('m.search', (m) => m.state === 'found');
    assert.equal(srv.lobby.searchQueue.size, 0, 'the queue drained');
  });

  test('快速搜寻 AI-fills after MATCH_FAST_FILL_MS; 精确搜寻 keeps waiting until matchTimeMax', async () => {
    clock.t += 10_000;
    const fast = await pool.player('Fast');
    const exact = await pool.player('Exact');
    await fast.request({ t: 'room.search', search: 'fast', difficulty: 'ABYSS', capacity: 4 });
    await fast.waitFor('m.search', (m) => m.state === 'queued');
    await exact.request({ t: 'room.search', search: 'exact', difficulty: 'HARD', capacity: 4 });
    await exact.waitFor('m.search', (m) => m.state === 'queued');

    // just before the fast deadline: nothing
    clock.t += MATCH_FAST_FILL_MS - 500;
    srv.lobby.drainSearch();
    await fast.expectNone('room.state', () => true, 60);
    // past it: the fast searcher's room is assembled with AI fill
    clock.t += 1000;
    srv.lobby.drainSearch();
    const st = await fast.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === fast.id));
    assert.equal(st.difficulty, 'ABYSS');
    assert.equal(st.seats.filter(Boolean).length, 4, 'AI filled the room');
    assert.equal(st.seats.filter((x) => x && x.isBot).length, 3);
    assert.equal(st.hostId, fast.id);
    const m = await fast.waitFor('m.search', (s) => s.state === 'timeout');
    assert.ok(m);
    // the exact searcher is still queued (its deadline is the official matchTimeMax)
    assert.equal(srv.lobby.searchQueue.has(exact.id), true);
    // … until matchTimeMax
    clock.t += MATCH_TIMEOUT_MS;
    srv.lobby.drainSearch();
    const st2 = await exact.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === exact.id));
    assert.equal(st2.difficulty, 'HARD');
    assert.equal(st2.seats.filter((x) => x && x.isBot).length, 3, 'AI fill');
  });

  test('different difficulties / capacities never mix; creating or joining a room dequeues', async () => {
    clock.t += 10_000;
    const a = await pool.player('A2');
    const b = await pool.player('B2');
    await a.request({ t: 'room.search', search: 'fast', difficulty: 'NORMAL', capacity: 4 });
    await a.waitFor('m.search', (m) => m.state === 'queued');
    await b.request({ t: 'room.search', search: 'fast', difficulty: 'FUNNY', capacity: 4 });
    await b.waitFor('m.search', (m) => m.state === 'queued');
    clock.t += MATCH_FAST_FILL_MS + 1000;
    srv.lobby.drainSearch();
    // both time out separately: two rooms of one human + AI
    const sa = await a.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === a.id));
    const sb = await b.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === b.id));
    assert.notEqual(sa.code, sb.code, 'separate rooms');
    assert.equal(sa.difficulty, 'NORMAL');
    assert.equal(sb.difficulty, 'FUNNY');

    // create while queued: the queue entry is gone
    const c = await pool.player('C2');
    await c.request({ t: 'room.search', search: 'fast', difficulty: 'NORMAL', capacity: 4 });
    await c.waitFor('m.search', (m) => m.state === 'queued');
    assert.equal(srv.lobby.searchQueue.has(c.id), true);
    await c.request({ t: 'room.leave' }).catch(() => {});
    // not in a room yet — create directly
    const cr = await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal(cr.t, 'ok');
    await c.waitFor('room.state');
    assert.equal(srv.lobby.searchQueue.has(c.id), false, 'creating dequeued');
  });

  test('a 快速 searcher is not held past its own deadline by a 精确 one still inside its window (same group)', async () => {
    clock.t += 10_000;
    const fast = await pool.player('FastA');
    const exact = await pool.player('ExactA');
    await fast.request({ t: 'room.search', search: 'fast', difficulty: 'NORMAL', capacity: 4 });
    await fast.waitFor('m.search', (m) => m.state === 'queued');
    await exact.request({ t: 'room.search', search: 'exact', difficulty: 'NORMAL', capacity: 4 });
    await exact.waitFor('m.search', (m) => m.state === 'queued');
    // past the fast deadline but far from matchTimeMax
    clock.t += MATCH_FAST_FILL_MS + 500;
    srv.lobby.drainSearch();
    const st = await fast.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === fast.id));
    assert.equal(st.hostId, fast.id);
    assert.equal(st.seats.filter((x) => x && x.isBot).length, 3, 'AI fill for the timed-out 快速 searcher');
    assert.equal(srv.lobby.searchQueue.has(exact.id), true, 'the 精确 searcher keeps waiting');
    await exact.expectNone('room.state', () => true, 80);
    // clean up: the exact searcher leaves
    await exact.request({ t: 'room.searchCancel' });
  });

  test('a disconnecting searcher leaves the queue', async () => {
    clock.t += 10_000;
    const d = await pool.player('Gone');
    await d.request({ t: 'room.search', search: 'fast', difficulty: 'NORMAL', capacity: 4 });
    await d.waitFor('m.search', (m) => m.state === 'queued');
    assert.equal(srv.lobby.searchQueue.has(d.id), true);
    await d.terminate();
    await new Promise((r) => setTimeout(r, 150)); // onDisconnect runs
    assert.equal(srv.lobby.searchQueue.has(d.id), false);
  });
});

describe('同盟等待室的交流 (room.emote)', () => {
  let srv, pool;
  before(async () => {
    const cap = { errors: [], log: { info() {}, warn() {}, debug() {}, error: (...a) => cap.errors.push(a.map(String).join(' ')) } };
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  after(async () => {
    await pool?.closeAll();
    srv?.lobby.shutdown('test');
    await srv?.close();
  });

  test('an emote reaches every member as m.roomEmote; chatCD rate-limits; spectators and outsiders are refused', async () => {
    const host = await pool.player('H');
    const state = await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' }).then(() => host.waitFor('room.state'));
    const guest = await pool.player('G');
    await guest.request({ t: 'room.join', code: state.code });
    await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id));
    const spec = await pool.player('S');
    await spec.request({ t: 'room.spectate', code: state.code });
    await spec.waitFor('room.state');
    const out = await pool.player('O');

    const id = EMOTES[0];
    const r = await host.request({ t: 'room.emote', id });
    assert.equal(r.t, 'ok');
    for (const c of [host, guest, spec]) {
      const e = await c.waitFor('m.roomEmote', (m) => m.playerId === host.id && m.id === id);
      assert.equal(e.t, 'm.roomEmote');
    }
    // chatCD: a second emote inside 1 s is RATE
    const r2 = await host.request({ t: 'room.emote', id: EMOTES[1] });
    assert.equal(r2.t, 'error');
    assert.equal(r2.code, ERR.RATE);
    // … and lands after it
    await new Promise((res) => setTimeout(res, 1100));
    const r3 = await host.request({ t: 'room.emote', id: EMOTES[1] });
    assert.equal(r3.t, 'ok');
    await guest.waitFor('m.roomEmote', (m) => m.id === EMOTES[1]);
    // a spectator may watch, never send
    const rs = await spec.request({ t: 'room.emote', id });
    assert.equal(rs.t, 'error');
    assert.equal(rs.code, ERR.SPECTATOR);
    // not in a room
    const ro = await out.request({ t: 'room.emote', id });
    assert.equal(ro.t, 'error');
    assert.equal(ro.code, ERR.NOT_IN_ROOM);
    // an unknown id
    const rb = await guest.request({ t: 'room.emote', id: 'autochess_room_hello' });
    assert.equal(rb.t, 'error');
    assert.equal(rb.code, ERR.BAD_MSG);
  });
});
