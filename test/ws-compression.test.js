// WebSocket permessage-deflate (server/http/websocket.js WS_DEFLATE, host bandwidth layer 0): a browser-like client
// negotiates the capacity branch's retained server context and 32 KB window, while clients without the extension or
// with incompatible window/context offers connect uncompressed. Payloads and the inflated-frame limit stay intact.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attachWebSocket, narrowDeflateOffer, WS_DEFLATE } from '../server/http/websocket.js';
import { startServer } from '../server/index.js';

const BIG = JSON.stringify({ t: 'm.public', players: Array.from({ length: 200 }, (_, i) => ({ playerId: `p_${i % 4}`, name: '阿米娅', lp: 30, phase: 'PREP' })) });
const SMALL = JSON.stringify({ t: 'pong', at: 12345 });

/** A bare http server whose /ws sends BIG then SMALL to every socket (a stand-in for net.js Network). */
async function fakeServer() {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const network = {
    admission: () => null,
    handleConnection: (ws) => { ws.send(BIG); ws.send(SMALL); },
  };
  const wss = attachWebSocket(server, { network, log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `ws://127.0.0.1:${server.address().port}/ws`, close: () => new Promise((r) => { wss.close(); server.close(() => r()); }) };
}

/** Connect, collect two messages, report the server's Sec-WebSocket-Extensions answer and the bytes the socket read. */
function receive(url, opts) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts);
    const msgs = [];
    let negotiated = '';
    ws.on('upgrade', (res) => { negotiated = res.headers['sec-websocket-extensions'] || ''; });
    ws.on('error', reject);
    ws.on('message', (data) => {
      msgs.push(String(data));
      if (msgs.length === 2) {
        const read = ws._socket.bytesRead;
        ws.close();
        resolve({ msgs, read, extensions: negotiated });
      }
    });
  });
}

describe('WebSocket permessage-deflate', () => {
  let srv;
  before(async () => { srv = await fakeServer(); });
  after(async () => { await srv.close(); });

  test('negotiates the retained server dictionary and capacity window; payloads arrive intact', async () => {
    const r = await receive(srv.url);
    assert.match(r.extensions, /permessage-deflate/);
    assert.doesNotMatch(r.extensions, /server_no_context_takeover/);
    assert.match(r.extensions, /client_no_context_takeover/);
    assert.match(r.extensions, new RegExp(`server_max_window_bits=${WS_DEFLATE.serverMaxWindowBits}`));
    assert.deepEqual(r.msgs, [BIG, SMALL], 'the payloads arrive intact');
    assert.ok(BIG.length > 10000);
    assert.ok(r.read < BIG.length / 4, `compressed on the wire: ${r.read} bytes read for ${BIG.length} of payload`);
    assert.equal(WS_DEFLATE.threshold, 256);
    assert.equal(WS_DEFLATE.serverMaxWindowBits, 15);
  });

  test('a client without the extension gets the same messages uncompressed', async () => {
    const r = await receive(srv.url, { perMessageDeflate: false });
    assert.equal(r.extensions, '');
    assert.deepEqual(r.msgs, [BIG, SMALL]);
    assert.ok(r.read > BIG.length + SMALL.length, `plain frames: ${r.read}`);
  });

  test('an offer that caps the server window below ours connects uncompressed instead of a refused handshake', async () => {
    const r = await receive(srv.url, { perMessageDeflate: { serverMaxWindowBits: 9 } });
    assert.equal(r.extensions, '');
    assert.deepEqual(r.msgs, [BIG, SMALL]);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=9'), true);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=12; client_max_window_bits'), true);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=14; client_max_window_bits'), true);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=15; client_max_window_bits'), false);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=9, permessage-deflate'), false, 'another offer is acceptable');
    assert.equal(narrowDeflateOffer('permessage-deflate; client_max_window_bits'), false);
    assert.equal(narrowDeflateOffer(undefined), false);
  });

  test('windows above upstream 11 but below capacity 15 also connect without compression', async () => {
    for (const serverMaxWindowBits of [12, 14]) {
      const r = await receive(srv.url, { perMessageDeflate: { serverMaxWindowBits } });
      assert.equal(r.extensions, '');
      assert.deepEqual(r.msgs, [BIG, SMALL]);
    }
  });

  test('a client requiring no retained server context gets an uncompressed connection', async () => {
    const r = await receive(srv.url, { perMessageDeflate: { serverNoContextTakeover: true } });
    assert.equal(r.extensions, '');
    assert.deepEqual(r.msgs, [BIG, SMALL]);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_no_context_takeover'), true);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_no_context_takeover, permessage-deflate'), false);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=12', { serverMaxWindowBits: 11 }), false);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=9', false), false);
  });
});

test('SP_WS_DEFLATE rollback keeps a normal uncompressed handshake', async () => {
  const saved = process.env.SP_WS_DEFLATE;
  process.env.SP_WS_DEFLATE = '0';
  let srv;
  try {
    srv = await fakeServer();
    const r = await receive(srv.url);
    assert.equal(r.extensions, '');
    assert.deepEqual(r.msgs, [BIG, SMALL]);
  } finally {
    await srv?.close();
    if (saved === undefined) delete process.env.SP_WS_DEFLATE;
    else process.env.SP_WS_DEFLATE = saved;
  }
});

test('the real server negotiates compression at /ws and keeps the 64 KB inflated frame limit', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    assert.match(ws.extensions, /permessage-deflate/);
    // a compressed client frame whose inflated size is over the limit closes the socket (1009), like a plain one
    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ t: 'hello', name: 'x'.repeat(70 * 1024) }));
    assert.equal(await closed, 1009);
  } finally {
    await srv.close();
  }
});
