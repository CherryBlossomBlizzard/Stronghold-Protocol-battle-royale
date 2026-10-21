// tools/party/smoke.mjs — 《卫冕协议·神人派对》真实联机冒烟测试。
//
// 用真实 WebSocket 连上正在运行的服务器，模拟 8 名玩家：建房 → 开启派对模式 → 补 AI → 就绪 → 开局 →
// 校验公共/私有帧隔离 → 打一圈市场/秘密行动 → 断线重连 → 打印结果。
// 不修改任何游戏逻辑：它只是把玩家能做的事用客户端协议做一遍。
//
//   node tools/party/smoke.mjs [ws://127.0.0.1:4173/ws] [--players 8] [--verbose]

import WebSocket from 'ws';

const argUrl = process.argv.find((a) => a.startsWith('ws://') || a.startsWith('wss://'));
const URL = argUrl || `ws://127.0.0.1:${process.env.PORT || 4173}/ws`;
const verbose = process.argv.includes('--verbose');
const playersArg = process.argv.indexOf('--players');
const HUMANS = playersArg > 0 ? Number(process.argv[playersArg + 1]) : 2;
const SEATS = 8;

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { console.log(`  ✔ ${label}`); }
  else { failures += 1; console.log(`  ✖ ${label}${extra ? ` — ${extra}` : ''}`); }
  return cond;
};

/** 一个最小客户端：发消息、按类型收帧、等某个帧。 */
class Client {
  constructor(name, token = null) {
    this.name = name;
    this.token = token;
    this.frames = [];
    this.waiters = [];
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (e) => reject(e));
      this.ws.on('close', () => { this.closed = true; });
      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (verbose) console.log(`  [${this.name}] ← ${msg.t}`);
        this.frames.push(msg);
        for (const w of this.waiters.slice()) {
          if (w.pred(msg)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(msg); }
        }
      });
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  /** 等一个满足条件的帧（含已收到的）。 */
  wait(pred, { timeoutMs = 8000, label = 'frame' } = {}) {
    const found = this.frames.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`timeout waiting for ${label}`));
      }, timeoutMs);
      const waiter = { pred, resolve: (m) => { clearTimeout(timer); resolve(m); } };
      this.waiters.push(waiter);
    });
  }

  waitType(t, opts) { return this.wait((m) => m && m.t === t, { ...opts, label: t }); }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (arr, pred) => { for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i]; return null; };

async function main() {
  console.log(`\n=== 神人派对联机冒烟：${URL}（${HUMANS} 名真人 + AI，座位 ${SEATS}）===\n`);

  // ── 1. 连接与入座 ──────────────────────────────────────────────────────────
  console.log('[1] 连接与入座');
  const clients = [];
  for (let i = 0; i < HUMANS; i++) {
    const c = new Client(`玩家${i + 1}`);
    await c.connect();
    c.send({ t: 'hello', name: `测试玩家${i + 1}` });
    await c.waitType('welcome');
    clients.push(c);
  }
  ok(clients.every((c) => c.frames.some((f) => f.t === 'welcome')), `${HUMANS} 名玩家完成 hello/welcome`);

  const host = clients[0];
  host.send({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: SEATS, rid: 1 });
  const created = await host.wait((m) => m.t === 'room.state' || (m.rid === 1 && m.t === 'ok'), { label: 'room created' });
  ok(!!created, '房主建房成功');

  let roomState = last(host.frames, (f) => f.t === 'room.state');
  const code = roomState.code;
  ok(typeof code === 'string' && code.length === 4, `房间号 ${code}`);

  // ── 2. 开启派对模式 ────────────────────────────────────────────────────────
  console.log('\n[2] 开启《神人派对》模式');
  host.send({ t: 'room.party', partyMode: true, splitKnowledge: 'PARTIAL', extraChanceCost: 3, rounds: 12, rid: 2 });
  const partyAck = await host.wait((m) => (m.rid === 2 && (m.t === 'ok' || m.t === 'error')) || (m.t === 'room.state' && m.party), { label: 'room.party ack' });
  ok(!partyAck.error, '房主开启派对模式', partyAck.error || '');
  roomState = last(host.frames, (f) => f.t === 'room.state');
  ok(!!roomState.party, 'room.state 带上 party 设置');
  ok(roomState.party && roomState.party.extraChanceCost === 3, '额外挑战机会价格 = 3（测试值）');
  ok(roomState.party && roomState.party.minPlayers === 4 && roomState.party.maxPlayers === 20, '人数范围 4–20 下发到前端');

  // ── 3. 其他真人加入 + 补 AI ────────────────────────────────────────────────
  console.log('\n[3] 加入与补位');
  for (let i = 1; i < clients.length; i++) {
    const c = clients[i];
    const target = code.toLowerCase();
    c.send({ t: 'room.join', code: target, rid: 10 + i });
    const r = await c.wait((m) => (m.rid === 10 + i && (m.t === 'ok' || m.t === 'error')) || m.t === 'room.state', { label: 'join ack' });
    ok(!r.error, `${c.name} 加入房间`, r.error || '');
  }
  roomState = last(host.frames, (f) => f.t === 'room.state');
  const seatedHumans = roomState.seats.filter(Boolean).length;
  ok(seatedHumans === HUMANS, `座位上的真人数 = ${HUMANS}（实际 ${seatedHumans}）`);

  host.send({ t: 'room.addBot', rid: 50 });
  for (let i = 0; i < SEATS; i++) {
    roomState = last(host.frames, (f) => f.t === 'room.state');
    if (roomState && roomState.seats.filter(Boolean).length >= SEATS) break;
    host.send({ t: 'room.addBot' });
    await sleep(120);
  }
  roomState = last(host.frames, (f) => f.t === 'room.state');
  const total = roomState.seats.filter(Boolean).length;
  ok(total === SEATS, `补满 ${SEATS} 个座位（实际 ${total}）`);

  // ── 4. 就绪与开局 ──────────────────────────────────────────────────────────
  console.log('\n[4] 就绪与开局');
  for (const c of clients.slice(1)) { c.send({ t: 'room.ready', ready: true }); await sleep(80); }
  const startAck = await (async () => {
    host.send({ t: 'room.start', rid: 99 });
    return host.wait((m) => (m.rid === 99 && (m.t === 'ok' || m.t === 'error')) || m.t === 'm.party', { label: 'room.start ack' });
  })();
  ok(!startAck.error, '房主开局成功', startAck.error || '');

  const pub = await host.waitType('m.party', { label: 'm.party' });
  ok(!!pub, '收到公共帧 m.party');
  ok(Array.isArray(pub.players) && pub.players.length === SEATS, `公共帧含全部 ${SEATS} 名玩家`);

  // ── 5. 隐藏信息隔离 ────────────────────────────────────────────────────────
  console.log('\n[5] 隐藏信息隔离');
  const pubJson = JSON.stringify(pub);
  ok(!/faction"\s*:/.test(pubJson), '公共帧不含任何身份字段');
  ok(!/objective/i.test(pubJson), '公共帧不含任何秘密任务');
  ok(!/"hand"\s*:/.test(pubJson), '公共帧不含任何人的手牌');

  const privs = [];
  for (const c of clients) {
    const priv = await c.waitType('m.partyPrivate', { label: 'm.partyPrivate' });
    privs.push(priv);
    ok(!!(priv.role && priv.role.faction), `${c.name} 收到自己的身份`);
    ok(Array.isArray(priv.hand), `${c.name} 收到自己的手牌`);
  }
  // 每名玩家只应看到自己的身份/任务；别人的身份不出现在我的私有帧里
  const ids = privs.map((p) => p.playerId);
  ok(new Set(ids).size === HUMANS, '每名玩家的私密帧带各自的 playerId');
  const factionsSeen = privs.map((p) => p.role.faction);
  ok(factionsSeen.every((f) => ['LOYAL', 'SPLIT', 'OPPORTUNIST'].includes(f)), '身份都是合法阵营');

  // ── 6. 市场与秘密行动 ──────────────────────────────────────────────────────
  console.log('\n[6] 市场与秘密行动');
  // 等进入市场阶段（简报需要所有真人 ready 或超时）
  host.send({ t: 'g.party', op: 'ready' });
  for (const c of clients.slice(1)) c.send({ t: 'g.party', op: 'ready' });
  let p = null;
  for (let i = 0; i < 60; i++) {
    p = last(host.frames, (f) => f.t === 'm.party');
    if (p && p.phase === 'PARTY_MARKET') break;
    await sleep(200);
  }
  ok(!!p && p.phase === 'PARTY_MARKET', `进入市场阶段（当前 ${p && p.phase}）`);
  if (p && p.phase === 'PARTY_MARKET') {
    const fixed = p.market.slots.find((s) => s.mode === 'fixed');
    const sealed = p.market.slots.find((s) => s.mode === 'sealed');
    ok(!!fixed && !!sealed, '市场有固定价卡与密封竞价卡');
    const priv = last(host.frames, (f) => f.t === 'm.partyPrivate');
    const before = priv.resources.tickets;
    host.send({ t: 'g.party', op: 'buy', slot: fixed.slot, requestId: 'smoke-buy-1' });
    await sleep(300);
    const afterPriv = last(host.frames, (f) => f.t === 'm.partyPrivate');
    ok(afterPriv.resources.tickets < before, `购买固定价卡后调度券从 ${before} 降到 ${afterPriv.resources.tickets}`);
    // 重复同一个 requestId：不应再扣费
    host.send({ t: 'g.party', op: 'buy', slot: fixed.slot, requestId: 'smoke-buy-1' });
    await sleep(300);
    const rePriv = last(host.frames, (f) => f.t === 'm.partyPrivate');
    ok(rePriv.resources.tickets === afterPriv.resources.tickets, '重复 requestId 不重复扣费');
    // 报价
    host.send({ t: 'g.party', op: 'bid', slot: sealed.slot, amount: 2, requestId: 'smoke-bid-1' });
    await sleep(300);
    const bidPriv = last(host.frames, (f) => f.t === 'm.partyPrivate');
    ok(bidPriv.market.bidSlot === sealed.slot, '密封竞价已提交并回显给自己');
    const pubNow = last(host.frames, (f) => f.t === 'm.party');
    ok(!JSON.stringify(pubNow.market).includes('"amount"'), '公共市场视图不含任何报价金额');
  }

  // ── 7. 断线重连 ────────────────────────────────────────────────────────────
  console.log('\n[7] 断线重连');
  const victim = clients[1] || host;
  const victimToken = victim.frames.find((f) => f.t === 'welcome').token;
  const victimId = victim.frames.find((f) => f.t === 'welcome').playerId;
  ok(!!victimToken, '拿到恢复用的 token');
  victim.close();
  await sleep(600);
  const re = new Client(`${victim.name}(重连)`);
  await re.connect();
  re.send({ t: 'hello', name: victim.name, token: victimToken });
  const rewelcome = await re.waitType('welcome', { label: 'reconnect welcome', timeoutMs: 8000 });
  ok(rewelcome.playerId === victimId, '重连后回到同一个 playerId');
  const rePriv = await re.waitType('m.partyPrivate', { label: 'private after reconnect', timeoutMs: 8000 });
  ok(!!rePriv.role, '重连后补发了私密状态（身份/手牌）');
  const rePub = await re.waitType('m.party', { label: 'public after reconnect', timeoutMs: 8000 });
  ok(!!rePub.phase, `重连后补发了公共状态（阶段 ${rePub.phase}）`);
  clients[1] = re;

  // ── 8. 服务端健康 ──────────────────────────────────────────────────────────
  console.log('\n[8] 服务器状态');
  const res = await fetch(URL.replace(/^ws/, 'http').replace(/\/ws$/, '/healthz'));
  const health = await res.json();
  ok(health.matches >= 1, `服务器报告 matches = ${health.matches}`);
  ok(health.humans >= 1, `服务器报告 humans = ${health.humans}`);

  for (const c of clients) c.close();
  await sleep(300);

  console.log(`\n=== 结果：${failures === 0 ? '全部通过' : `${failures} 项失败`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\n冒烟测试异常：', e); process.exit(2); });
