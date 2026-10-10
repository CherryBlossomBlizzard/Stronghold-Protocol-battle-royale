import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAssetCacheManager } from '../public/js/assetCache.js';
import { ASSET_CACHE_LATEST_KEY, assetCacheCatalogKey, assetCacheSummary } from '../shared/assetCache.js';

const catalog = { schema: 1, files: [{ url: '/assets/a.png', bytes: 3,
  sha256: 'b'.repeat(64), type: 'image/png', aliases: [] }], totalFiles: 1, totalBytes: 3, complete: true, missing: [] };
catalog.version = createHash('sha256').update(JSON.stringify({ schema: 1, files: catalog.files })).digest('hex');

function fixture({ storage = {}, secure = true, persistedCatalog = true } = {}) {
  const messages = [], work = [], listeners = new Map();
  let catalogReads = 0, statusReads = 0, broken = false, playing = false, ready = 0;
  let serverSummary = assetCacheSummary(catalog);
  const origin = 'https://game.test';
  const metadata = new Map();
  if (persistedCatalog) {
    metadata.set(origin + ASSET_CACHE_LATEST_KEY, { version: catalog.version });
    metadata.set(origin + assetCacheCatalogKey(catalog.version), catalog);
  }
  const sw = { postMessage(data, ports) {
    messages.push(data);
    if (data.type === 'ASSET_CACHE_PLAYING') playing = data.playing;
    if (data.type === 'ASSET_CACHE_PIN') {
      metadata.set(origin + ASSET_CACHE_LATEST_KEY, { version: data.catalog.version });
      metadata.set(origin + assetCacheCatalogKey(data.catalog.version), structuredClone(data.catalog));
    }
    if (data.type === 'ASSET_CACHE_CLEAR') ready = 0;
    ports[0].postMessage({ ok: true, playing });
  } };
  const registration = { active: sw };
  const environment = {
    isSecureContext: secure, location: { origin }, crypto: globalThis.crypto, Blob, MessageChannel, AbortController,
    caches: { open: async () => ({ match: async (url) => metadata.has(url) ? Response.json(metadata.get(url)) : undefined }) },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 1000 ? 1 : ms), clearTimeout,
    navigator: {
      serviceWorker: { controller: sw, ready: Promise.resolve(registration),
        register: async () => registration, addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name) => listeners.delete(name) },
      locks: { request: async (_name, _options, fn) => fn({}) },
      storage: { estimate: async () => ({ usage: 1, quota: 1000 }), persisted: async () => false, ...storage },
    },
    Worker: class {
      postMessage(message) {
        work.push(message);
        setTimeout(async () => {
          if (message.action === 'read-catalog') {
            const parsed = message.format === 'json' ? JSON.parse(await message.file.text()) : catalog;
            this.onmessage?.({ data: { id: message.id, type: 'done', catalog: parsed } }); return;
          }
          if (message.action === 'import' || message.action === 'download') ready = 1;
          this.onmessage?.({ data: { id: message.id, type: 'progress', readyFiles: ready, readyBytes: ready * 3,
            missingFiles: 1 - ready, missingBytes: (1 - ready) * 3 } });
          this.onmessage?.({ data: { id: message.id, type: 'done' } });
        }, 0);
      }
      terminate() { this.onmessage = null; }
    },
  };
  const manager = createAssetCacheManager({ environment, doFetch: async (url) => {
    if (url.includes('catalog')) { catalogReads++; return Response.json({ error: 'ASSET_CACHE_CATALOG_LOCAL_ONLY' }, { status: 403 }); }
    statusReads++;
    return Response.json(broken ? {} : { ...serverSummary, policy: { enabled: false } });
  } });
  return { manager, messages, work, metadata, catalogReads: () => catalogReads, statusReads: () => statusReads,
    broken: (value) => { broken = value; }, summary: (value) => { serverSummary = value; }, ready: (value) => { ready = value; },
    update: () => listeners.get('message')?.({ data: { type: 'ASSET_CACHE_UPDATED' } }) };
}

test('a summary failure is retryable by explicit checking; reopening never downloads a directory or refetches status', async () => {
  const f = fixture();
  try {
    f.broken(true);
    assert.equal((await f.manager.initialize()).error, 'ASSET_CACHE_CATALOG_UNAVAILABLE');
    f.broken(false);
    await f.manager.initialize();
    assert.equal(f.statusReads(), 1, 'reopening does not create repeated HTTP requests');
    assert.equal((await f.manager.scan()).phase, 'idle');
    assert.equal(f.statusReads(), 2);
    await f.manager.initialize();
    assert.equal(f.catalogReads(), 0);
    assert.equal(f.statusReads(), 2);
    assert.equal(f.manager.getState().policy.enabled, false, 'disabled online filling still leaves local import available');
  } finally { f.manager.destroy(); }
});

test('a direct combat reconnect restores the persisted directory before playing and does not download one', async () => {
  const f = fixture();
  try {
    await f.manager.setPlaying(true);
    assert.equal((await f.manager.initialize()).phase, 'idle');
    assert.equal(f.catalogReads(), 0);
    assert.equal(f.messages.filter((m) => m.type === 'ASSET_CACHE_PLAYING').at(-1).playing, true);
    await f.manager.setPlaying(false);
    assert.equal(f.manager.getState().phase, 'idle'); assert.equal(f.catalogReads(), 0);
    assert.ok(f.messages.findIndex((m) => m.type === 'ASSET_CACHE_PIN') < f.messages.findIndex((m) => m.type === 'ASSET_CACHE_PLAYING'));
    const before = f.messages.length;
    await f.manager.setPlaying(false); await f.manager.setPlaying(false);
    assert.equal(f.messages.length, before, 'high-frequency store emits do not rewrite the playing pin');
  } finally { f.manager.destroy(); }
});

test('passive asset progress notifications inspect local keys without repeatedly downloading the catalog', async () => {
  const f = fixture();
  try {
    await f.manager.initialize();
    f.update(); f.update();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(f.catalogReads(), 0); assert.equal(f.statusReads(), 1);
    assert.equal(f.work.filter((job) => job.action === 'scan').length, 2, 'notifications are coalesced into one local scan');
  } finally { f.manager.destroy(); }
});

test('a cold browser stays catalog-required; standalone import enables missing-only filling without online directory fallback', async () => {
  const f = fixture({ persistedCatalog: false });
  try {
    assert.equal((await f.manager.initialize()).phase, 'catalog-required');
    assert.equal(f.manager.getState().hasCatalog, false);
    await assert.rejects(f.manager.downloadMissing(), /ASSET_CACHE_CATALOG_REQUIRED/);
    await f.manager.importCatalog(new Blob([JSON.stringify(catalog)]));
    assert.equal(f.manager.getState().catalogCurrent, true);
    assert.equal(f.manager.getState().readyFiles, 0, 'importing a directory does not claim its files are cached');
    await f.manager.downloadMissing();
    assert.equal(f.manager.getState().phase, 'ready');
    assert.equal(f.catalogReads(), 0);
  } finally { f.manager.destroy(); }
});

test('the complete ZIP can bootstrap a cold browser; a matching local directory makes old/partial ZIP manifests optional', async () => {
  const f = fixture({ persistedCatalog: false });
  try {
    await f.manager.importZip(new Blob(['ZIP fixture']));
    assert.equal(f.manager.getState().phase, 'ready');
    assert.equal(f.work.filter((job) => job.action === 'read-catalog').length, 1);
    await f.manager.importZip(new Blob(['partial ZIP fixture']));
    assert.equal(f.work.filter((job) => job.action === 'read-catalog').length, 1);
    assert.ok(f.metadata.has('https://game.test' + assetCacheCatalogKey(catalog.version)));
    assert.equal(f.catalogReads(), 0);
  } finally { f.manager.destroy(); }
});

test('tampered/stale directories cannot replace a valid pin, and admission recounts local contents after eviction', async () => {
  const f = fixture();
  try {
    await f.manager.initialize();
    const changed = structuredClone(catalog); changed.files[0].sha256 = 'c'.repeat(64);
    await assert.rejects(f.manager.importCatalog(new Blob([JSON.stringify(changed)])), /ASSET_CACHE_BAD_CATALOG/);
    f.summary({ ...assetCacheSummary(catalog), version: 'd'.repeat(64) });
    await assert.rejects(f.manager.importCatalog(new Blob([JSON.stringify(catalog)])), /ASSET_CACHE_STALE_CATALOG/);
    assert.equal(await f.manager.admission(), null);
    assert.equal(f.messages.filter((m) => m.type === 'ASSET_CACHE_PIN').length, 1, 'failed imports preserve the existing pin');
    f.summary(assetCacheSummary(catalog)); f.ready(1);
    assert.equal((await f.manager.admission()).readyFiles, 1);
    f.ready(0);
    assert.equal((await f.manager.admission()).readyFiles, 0, 'a previous full progress display is not an admission credential');
    assert.equal(f.catalogReads(), 0);
  } finally { f.manager.destroy(); }
});

test('persistence invokes the API during the click and reports the granted storage state', async () => {
  let granted = false, calls = 0;
  const f = fixture({ storage: { persist() { calls++; granted = true; return Promise.resolve(true); },
    persisted: async () => granted } });
  const changes = [];
  f.manager.subscribe((state) => changes.push(state.persistence));
  try {
    assert.equal(f.manager.getState().storage.persistenceSupported, true);
    const pending = f.manager.requestPersistence();
    assert.equal(calls, 1, 'persist() must run before requestPersistence() returns to retain user activation');
    assert.equal(f.manager.getState().persistence, 'requesting');
    assert.equal(await pending, true);
    assert.equal(f.manager.getState().persistence, 'granted');
    assert.equal(f.manager.getState().storage.persisted, true);
    assert.equal(f.manager.getState().storage.persistenceSupported, true, 'storage refresh keeps API availability');
    assert.deepEqual([changes[0], changes.at(-1)], ['requesting', 'granted']);
    assert.equal(f.catalogReads(), 0, 'requesting persistence does not start cache initialization');
    assert.equal(await f.manager.requestPersistence(), true);
    assert.equal(calls, 1, 'already persisted storage does not ask the browser again');
  } finally { f.manager.destroy(); }
});

test('browser refusal is visible, leaves cache operations usable, and allows a later request', async () => {
  let granted = false;
  const f = fixture({ storage: { persist: async () => granted, persisted: async () => granted } });
  try {
    assert.equal(await f.manager.requestPersistence(), false);
    assert.equal(f.manager.getState().persistence, 'denied');
    assert.equal(f.manager.getState().phase, 'idle');
    assert.equal(f.manager.getState().error, null);
    assert.equal(f.manager.getState().storage.persisted, false);
    granted = true;
    assert.equal(await f.manager.requestPersistence(), true);
    assert.equal(f.manager.getState().persistence, 'granted');
  } finally { f.manager.destroy(); }
});

test('missing persistence API is reported as unsupported, while cache support remains available', async () => {
  const f = fixture();
  try {
    assert.equal(f.manager.getState().supported, true);
    assert.equal(f.manager.getState().storage.persistenceSupported, false);
    assert.equal(await f.manager.requestPersistence(), false);
    assert.equal(f.manager.getState().persistence, 'unsupported');
    assert.equal((await f.manager.initialize()).phase, 'idle');
    assert.equal(f.manager.getState().storage.persistenceSupported, false);
  } finally { f.manager.destroy(); }
});

test('insecure context prevents invoking persistence even if the API exists', async () => {
  let calls = 0;
  const f = fixture({ secure: false, storage: { persist() { calls++; return true; } } });
  try {
    assert.equal(f.manager.getState().storage.persistenceSupported, false);
    assert.equal(await f.manager.requestPersistence(), false);
    assert.equal(f.manager.getState().persistence, 'unsupported');
    assert.equal(calls, 0);
  } finally { f.manager.destroy(); }
});

test('persistence exceptions are visible and a rejection does not poison the next request', async () => {
  for (const synchronous of [true, false]) {
    let fails = true;
    const f = fixture({ storage: { persist() {
      if (!fails) return false;
      if (synchronous) throw new Error('unavailable');
      return Promise.reject(new Error('unavailable'));
    } } });
    try {
      assert.equal(await f.manager.requestPersistence(), false);
      assert.equal(f.manager.getState().persistence, 'error');
      assert.equal(f.manager.getState().error, null);
      fails = false;
      assert.equal(await f.manager.requestPersistence(), false);
      assert.equal(f.manager.getState().persistence, 'denied');
    } finally { f.manager.destroy(); }
  }
});

test('concurrent persistence requests share one pending browser prompt', async () => {
  let finish, calls = 0;
  const f = fixture({ storage: { persist() { calls++; return new Promise((resolve) => { finish = resolve; }); } } });
  try {
    const first = f.manager.requestPersistence();
    const second = f.manager.requestPersistence();
    assert.equal(first, second);
    assert.equal(calls, 1);
    assert.equal(f.manager.getState().persistence, 'requesting');
    finish(false);
    assert.deepEqual(await Promise.all([first, second]), [false, false]);
    assert.equal(f.manager.getState().persistence, 'denied');
  } finally { f.manager.destroy(); }
});

test('quota inspection failure does not hide a granted persistence request', async () => {
  let persistedReads = 0;
  const f = fixture({ storage: { persist: async () => true,
    estimate: async () => { throw new Error('quota unavailable'); },
    persisted: async () => { persistedReads++; return true; } } });
  try {
    assert.equal(await f.manager.requestPersistence(), true);
    assert.equal(persistedReads, 1, 'persistence inspection still runs when quota inspection fails');
    assert.equal(f.manager.getState().persistence, 'granted');
    assert.equal(f.manager.getState().storage.persisted, true);
    assert.equal(f.manager.getState().storage.quota, 0);
  } finally { f.manager.destroy(); }
});

test('persist permission is retained without persisted inspection support', async () => {
  const f = fixture({ storage: { persist: async () => true, persisted: undefined } });
  try {
    assert.equal(await f.manager.requestPersistence(), true);
    assert.equal(f.manager.getState().persistence, 'granted');
    assert.equal(f.manager.getState().storage.persisted, true);
    assert.equal(f.manager.getState().storage.quota, 1000);
    await f.manager.initialize();
    assert.equal(f.manager.getState().storage.persisted, true, 'subsequent quota refresh cannot erase the granted permission');
  } finally { f.manager.destroy(); }
});

test('persistence inspection failure does not hide quota estimates or erase granted permission', async () => {
  const f = fixture({ storage: { persist: async () => true,
    persisted: async () => { throw new Error('inspection unavailable'); } } });
  try {
    assert.equal(await f.manager.requestPersistence(), true);
    assert.equal(f.manager.getState().storage.persisted, true);
    assert.equal(f.manager.getState().storage.quota, 1000);
    await f.manager.initialize();
    assert.equal(f.manager.getState().storage.persisted, true);
  } finally { f.manager.destroy(); }
});
