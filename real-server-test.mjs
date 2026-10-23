// 真实服务器对局测试 v2：64.90.1.62:3000 —— 20 人房分组策略轮选
import WebSocket from 'ws';
const HOST = 'ws://64.90.1.62:3000/ws';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

class Client {
  constructor(name) {
    this.name = name; this.rid = 0; this.queue = []; this.waiters = []; this.playerId = null;
    this.ws = new WebSocket(HOST);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') this.playerId = m.playerId;
      const w = this.waiters.find((w) => w.pred(m));
      if (w) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); }
      else this.queue.push(m);
    });
    this.open = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
  }
  send(msg) { this.ws.send(JSON.stringify({ ...msg, rid: ++this.rid })); }
  async wait(pred, ms = 20000, label = '') {
    const hit = this.queue.find((m) => pred(m));
    if (hit) { this.queue.splice(this.queue.indexOf(hit), 1); return hit; }
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout: ' + label)), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); res(m); } });
    });
  }
  async rpc(msg, ms = 20000, label = '') { this.send(msg); return this.wait((m) => m.rid === this.rid, ms, label || msg.t); }
}

const run = async () => {
  const host = new Client('真实测试-房主');
  await host.open;
  const w = await host.rpc({ t: 'hello', name: host.name }, 20000, 'hello');
  log('房主已连接:', w.playerId);
  const rc = await host.rpc({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 20 }, 20000, 'create');
  const st0 = await host.wait((m) => m.t === 'room.state', 15000, 'room.state');
  log('房间:', st0.code, '| rulesVariant:', st0.rulesVariant);
  for (let i = 0; i < 19; i++) await host.rpc({ t: 'room.addBot' }, 20000, 'addBot');
  const st1 = await host.wait((m) => m.t === 'room.state' && (m.seats || []).filter((s) => s.playerId).length >= 20, 20000, 'full').catch(() => null);
  log('座位:', st1 ? (st1.seats || []).filter((s) => s.playerId).length + '/20' : '未确认（继续）');
  await host.rpc({ t: 'room.ready', ready: true }, 15000, 'ready').catch(() => {});
  host.send({ t: 'room.start' });
  log('room.start 已发');
  // 等 INFO_CHECK 的 m.public，然后 infoReady
  await host.wait((m) => m.t === 'm.public' && m.phase === 'INFO_CHECK', 30000, 'INFO_CHECK');
  log('对局开始 → INFO_CHECK');
  host.send({ t: 'g.infoReady' });
  log('infoReady 已发');
  // 等 BAND_DRAFT
  const d0 = await host.wait((m) => m.t === 'm.public' && m.phase === 'BAND_DRAFT' && m.draft, 60000, 'BAND_DRAFT');
  let dd = d0.draft || {};
  log('== 策略轮选 ==');
  log('  order:', (dd.order || []).length, '人 | turns:', JSON.stringify(dd.turns || []));
  // 轮选推进观察：每 8 秒打一次完成度，直到全选完或 120 秒
  const tB = Date.now();
  while (Date.now() - tB < 120000) {
    await new Promise((r) => setTimeout(r, 8000));
    const cur = host.queue.filter((m) => m.t === 'm.public' && m.phase === 'BAND_DRAFT' && m.draft).pop();
    if (cur) { host.queue.length = 0; dd = cur.draft; }
    if ((dd.turns || []).includes(host.playerId)) {
      const taken = new Set(Object.values(dd.picks || {}));
      const allowed = dd.allowedBands || [];
      const free = allowed.length ? allowed.find((b) => !taken.has(b)) : 'band_bldsk';
      host.send({ t: 'g.band', bandId: free || 'band_bldsk' });
      log('  房主选策略:', free || 'band_bldsk');
    }
    const done = Object.keys(dd.picks || {}).length;
    log(`  进度 ${done}/20 | turns: ${JSON.stringify(dd.turns || [])}`);
    if (done >= 20) break;
  }
  // 等 PREP
  const t0 = Date.now(); const seen = ['BAND_DRAFT'];
  while (Date.now() - t0 < 120000) {
    const m = await host.wait((x) => x.t === 'm.public' && x.phase && !seen.includes(x.phase), 40000, 'next phase').catch(() => null);
    if (!m) break;
    seen.push(m.phase); log('  阶段 →', m.phase);
    if (m.phase === 'PREP') break;
  }
  log('== 完成 ==');
  process.exit(0);
};
run().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });