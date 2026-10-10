// Browser asset-cache coordinator; pure at import time so importing it under Node is safe.
// All expensive work runs in a dedicated worker. UI consumes codes through i18n, never raw errors.
import { ASSET_CACHE_META, ASSET_CACHE_LATEST_KEY, MAX_MANIFEST_BYTES, verifyAssetCatalog,
  assetCacheCatalogKey, validateAssetCacheSummary, catalogMatchesSummary, assetCacheError } from '../../shared/assetCache.js';

const initialState = (env) => {
  const supported = !!(env.isSecureContext && env.caches && env.navigator?.serviceWorker
    && env.Worker && env.crypto?.subtle && env.navigator?.locks);
  return { supported, phase: 'idle', error: null,
    totalFiles: 0, readyFiles: 0, totalBytes: 0, readyBytes: 0, missingFiles: 0, missingBytes: 0,
    speedBps: 0, version: null, storage: { usage: 0, quota: 0, persisted: false,
      persistenceSupported: supported && typeof env.navigator?.storage?.persist === 'function' }, playing: false,
    hasCatalog: false, catalogCurrent: false, catalogComplete: false, serverMissingFiles: 0,
    serverVersion: null, requireAssetCache: false, importStats: null, scanStats: null, waiting: false, policy: null,
    persistence: 'idle' };
};

export function createAssetCacheManager({ environment = globalThis, doFetch, workerURL = '/js/asset-cache-worker.js',
  swURL = '/asset-cache-sw.js', statusURL = '/api/asset-cache/status' } = {}) {
  const env = environment;
  const state = initialState(env);
  const listeners = new Set();
  const fetcher = doFetch || ((...args) => env.fetch(...args));
  let catalog = null;
  let initialized = false;
  let initializing = null;
  let registration = null;
  let ownPlaying = false;
  let worker = null;
  let task = null;
  let nextID = 0;
  let operation = null;
  let backgroundTimer = null;
  let checkingStorage = null;
  let summary = null;
  let checkingSummary = null;
  let summaryAt = 0;
  let persistenceRequest = null;
  const getState = () => ({ ...state, storage: { ...state.storage }, importStats: state.importStats && { ...state.importStats },
    scanStats: state.scanStats && { ...state.scanStats }, policy: state.policy && { ...state.policy } });
  const patch = (next) => {
    Object.assign(state, next);
    for (const fn of [...listeners]) { try { fn(getState()); } catch { /* Consumer must not break cache progress. */ } }
  };

  function timeLimited(promise, ms, code) {
    return new Promise((resolve, reject) => {
      const timer = env.setTimeout(() => reject(assetCacheError(code)), ms);
      promise.then((value) => { env.clearTimeout(timer); resolve(value); }, (error) => { env.clearTimeout(timer); reject(error); });
    });
  }

  async function updateStorage() {
    if (checkingStorage) return checkingStorage;
    checkingStorage = (async () => {
      // Quota and persistence inspection can fail independently in private browser modes.
      const [estimate, persisted] = await Promise.allSettled([
        Promise.resolve().then(() => env.navigator.storage?.estimate?.()),
        Promise.resolve().then(() => env.navigator.storage?.persisted?.()),
      ]);
      patch({ storage: { ...state.storage,
        ...(estimate.status === 'fulfilled' && estimate.value
          ? { usage: estimate.value.usage || 0, quota: estimate.value.quota || 0 } : {}),
        ...(persisted.status === 'fulfilled' && typeof persisted.value === 'boolean'
          ? { persisted: persisted.value } : {}),
      } });
    })();
    try { await checkingStorage; } finally { checkingStorage = null; }
  }

  async function swMessage(type, payload = {}) {
    const target = env.navigator.serviceWorker.controller || registration?.active;
    if (!target) throw assetCacheError('ASSET_CACHE_SW_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      const channel = new env.MessageChannel();
      const timer = env.setTimeout(() => { channel.port1.close(); reject(assetCacheError('ASSET_CACHE_SW_UNAVAILABLE')); }, 10000);
      channel.port1.onmessage = ({ data }) => {
        env.clearTimeout(timer); channel.port1.close();
        if (data?.ok) resolve(data); else reject(assetCacheError(data?.error || 'ASSET_CACHE_STORAGE_ERROR'));
      };
      try { target.postMessage({ type, ...payload }, [channel.port2]); }
      catch (error) { env.clearTimeout(timer); channel.port1.close(); reject(assetCacheError('ASSET_CACHE_SW_UNAVAILABLE', error)); }
    });
  }

  const settledPhase = () => !catalog ? 'catalog-required' : !state.catalogCurrent ? 'catalog-stale'
    : state.missingFiles || !state.catalogComplete ? 'idle' : 'ready';

  async function refreshSummary({ force = false } = {}) {
    if (checkingSummary) return checkingSummary;
    if (!force && summary && Date.now() - summaryAt < 30000) return summary;
    checkingSummary = (async () => {
      const abort = new env.AbortController();
      const timer = env.setTimeout(() => abort.abort(), 15000);
      try {
        const response = await fetcher(statusURL, { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw assetCacheError('ASSET_CACHE_CATALOG_UNAVAILABLE');
        const next = validateAssetCacheSummary(await response.json());
        summary = next; summaryAt = Date.now();
        patch({ catalogCurrent: catalogMatchesSummary(catalog, next), catalogComplete: next.complete,
          serverMissingFiles: next.missingFiles, serverVersion: next.version,
          requireAssetCache: !!next.requireAssetCache, policy: next.policy || null,
          ...(!catalog ? { totalFiles: next.totalFiles, totalBytes: next.totalBytes,
            missingFiles: next.totalFiles, missingBytes: next.totalBytes } : {}) });
        return next;
      } catch (error) {
        summary = null; summaryAt = 0;
        patch({ catalogCurrent: false });
        throw error.code ? error : assetCacheError('ASSET_CACHE_CATALOG_UNAVAILABLE', error);
      }
      finally { env.clearTimeout(timer); }
    })();
    try { return await checkingSummary; } finally { checkingSummary = null; }
  }

  /** Cache Storage is the only directory source on reload, including older SW installations. */
  async function localCatalog() {
    const meta = await env.caches.open(ASSET_CACHE_META);
    const origin = env.location.origin;
    const latest = await (await meta.match(origin + ASSET_CACHE_LATEST_KEY))?.json();
    if (!latest?.version) return null;
    const response = await meta.match(origin + assetCacheCatalogKey(latest.version));
    if (!response) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_MANIFEST_BYTES) throw assetCacheError('ASSET_CACHE_BAD_CATALOG');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch (error) { throw assetCacheError('ASSET_CACHE_BAD_CATALOG', error); }
    const next = await verifyAssetCatalog(value, env.crypto);
    if (next.version !== latest.version) throw assetCacheError('ASSET_CACHE_BAD_CATALOG');
    return next;
  }

  async function adoptCatalog(value, { restoring = false } = {}) {
    const next = await verifyAssetCatalog(value, env.crypto);
    if (!restoring && !catalogMatchesSummary(next, summary)) throw assetCacheError('ASSET_CACHE_STALE_CATALOG');
    if (ownPlaying && catalog && catalog.version !== next.version) throw assetCacheError('ASSET_CACHE_PLAYING');
    await swMessage('ASSET_CACHE_PIN', { catalog: next, playing: ownPlaying });
    const changed = catalog?.version !== next.version;
    catalog = next;
    patch({ version: next.version, hasCatalog: true, totalFiles: next.totalFiles, totalBytes: next.totalBytes,
      catalogCurrent: catalogMatchesSummary(next, summary),
      ...(changed ? { readyFiles: 0, readyBytes: 0, missingFiles: next.totalFiles, missingBytes: next.totalBytes, importStats: null } : {}) });
    return next;
  }

  async function adoptMatchingLocalCatalog() {
    if (ownPlaying || state.catalogCurrent) return;
    const next = await localCatalog();
    if (catalogMatchesSummary(next, summary)) await adoptCatalog(next);
  }

  function stopWorker(code = 'ASSET_CACHE_PAUSED') {
    if (!worker) return;
    worker.terminate(); worker = null;
    const previous = task; task = null;
    previous?.reject(assetCacheError(code));
  }

  function runWorker(action, extra = {}) {
    if (task) throw assetCacheError('ASSET_CACHE_BUSY');
    if (!worker) {
      try { worker = new env.Worker(workerURL); }
      catch (error) { throw assetCacheError('ASSET_CACHE_WORKER_UNAVAILABLE', error); }
      worker.onmessage = ({ data }) => {
        if (!task || data.id !== task.id) return;
        if (data.type === 'progress') {
          const { readyFiles, readyBytes, missingFiles, missingBytes, speedBps, importStats, scanStats, waiting } = data;
          patch({ readyFiles, readyBytes, missingFiles, missingBytes,
            ...(speedBps === undefined ? {} : { speedBps }), ...(importStats ? { importStats } : {}),
            ...(scanStats ? { scanStats } : {}), ...(waiting === undefined ? {} : { waiting }) });
        } else if (data.type === 'done' || data.type === 'error') {
          const finished = task; task = null;
          if (data.type === 'done') finished.resolve(data.catalog ? { catalog: data.catalog } : getState());
          else finished.reject(assetCacheError(data.code || 'ASSET_CACHE_STORAGE_ERROR'));
        }
      };
      worker.onerror = () => stopWorker('ASSET_CACHE_WORKER_UNAVAILABLE');
      worker.onmessageerror = () => stopWorker('ASSET_CACHE_WORKER_UNAVAILABLE');
    }
    return new Promise((resolve, reject) => {
      task = { id: ++nextID, resolve, reject };
      try { worker.postMessage({ id: task.id, action, catalog, ...extra }); }
      catch (error) { task = null; reject(assetCacheError('ASSET_CACHE_WORKER_UNAVAILABLE', error)); }
    });
  }

  async function assertMutable() {
    const result = await swMessage('ASSET_CACHE_CAN_MUTATE');
    patch({ playing: ownPlaying || !!result.playing });
    if (state.playing) throw assetCacheError('ASSET_CACHE_PLAYING');
  }

  function passiveScan() {
    if (!initialized || operation || backgroundTimer !== null) return;
    backgroundTimer = env.setTimeout(() => {
      backgroundTimer = null;
      if (!operation) perform('scan', { refresh: false }).catch(() => {});
    }, 1000);
  }

  function onSWMessage({ data }) {
    if (data?.type === 'ASSET_CACHE_PLAYING_CHANGED') {
      patch({ playing: ownPlaying || !!data.playing });
      if (data.playing && operation) pause();
    } else if (data?.type === 'ASSET_CACHE_UPDATED') passiveScan();
  }

  async function initialize() {
    if (initialized) {
      // Reopening the panel does not fetch or scan the directory. Recheck only the live-tab guard,
      // since another playing tab may have closed without sending a final message.
      if (!operation) {
        try { const result = await swMessage('ASSET_CACHE_CAN_MUTATE'); patch({ playing: ownPlaying || !!result.playing }); }
        catch { /* Explicit operations report SW failures; opening the dialog stays usable. */ }
      }
      return getState();
    }
    if (initializing) return initializing;
    if (!state.supported) {
      patch({ phase: 'unsupported', error: env.isSecureContext ? 'ASSET_CACHE_UNSUPPORTED' : 'ASSET_CACHE_HTTPS_REQUIRED' });
      return getState();
    }
    initializing = (async () => {
      patch({ phase: 'initializing', error: null });
      try {
        registration = await timeLimited(env.navigator.serviceWorker.register(swURL, { scope: '/', type: 'module', updateViaCache: 'none' }),
          15000, 'ASSET_CACHE_SW_UNAVAILABLE');
        registration = await timeLimited(env.navigator.serviceWorker.ready, 15000, 'ASSET_CACHE_SW_UNAVAILABLE');
        env.navigator.serviceWorker.addEventListener('message', onSWMessage);
        let restoreError = null;
        try {
          const local = await localCatalog();
          // Pin before PLAYING so an older active SW can also restore a direct match reconnect.
          if (local) await adoptCatalog(local, { restoring: true });
        } catch (error) { restoreError = error.code || 'ASSET_CACHE_STORAGE_ERROR'; }
        const playback = await swMessage('ASSET_CACHE_PLAYING', { playing: ownPlaying });
        patch({ playing: ownPlaying || !!playback.playing });
        initialized = true;
        let summaryError = null;
        try { await refreshSummary(); }
        catch (error) { summaryError = error.code || 'ASSET_CACHE_CATALOG_UNAVAILABLE'; }
        if (catalog) await runWorker('scan');
        patch({ phase: settledPhase(), error: restoreError || summaryError });
        await updateStorage();
      } catch (error) {
        const paused = error.code === 'ASSET_CACHE_PLAYING' || error.code === 'ASSET_CACHE_PAUSED';
        patch({ phase: paused ? 'paused' : 'error', error: paused ? null : error.code || 'ASSET_CACHE_STORAGE_ERROR' });
      }
      return getState();
    })();
    try { return await initializing; } finally { initializing = null; }
  }

  async function ensureReady() {
    await initialize();
    if (!initialized) throw assetCacheError(state.error || 'ASSET_CACHE_UNSUPPORTED');
  }

  async function perform(action, { deep = false, file = null, refresh = false } = {}) {
    await ensureReady();
    if (operation) throw assetCacheError('ASSET_CACHE_BUSY');
    const phase = action === 'import' || action === 'catalog' ? 'importing' : action === 'download' ? 'downloading' : deep ? 'verifying' : 'checking';
    const mutates = action !== 'scan' || deep;
    const job = { paused: false };
    operation = job;
    patch({ phase, error: null, speedBps: 0, waiting: false,
      ...(action === 'import' ? { importStats: null } : {}), ...(deep ? { scanStats: null } : {}) });
    try {
      const run = async () => {
        if (job.paused) throw assetCacheError('ASSET_CACHE_PAUSED');
        if (mutates) {
          await assertMutable();
          if (action !== 'clear') await refreshSummary({ force: true });
          if (action === 'catalog') {
            const result = await runWorker('read-catalog', { file, format: 'json' });
            if (job.paused) throw assetCacheError('ASSET_CACHE_PAUSED');
            await assertMutable();
            await adoptCatalog(result.catalog);
          } else if (action !== 'clear') {
            await adoptMatchingLocalCatalog();
            if (action === 'import' && !state.catalogCurrent) {
              const result = await runWorker('read-catalog', { file, format: 'zip' });
              if (job.paused) throw assetCacheError('ASSET_CACHE_PAUSED');
              await assertMutable();
              await adoptCatalog(result.catalog);
            }
            if (!catalog) throw assetCacheError('ASSET_CACHE_CATALOG_REQUIRED');
            if (!state.catalogCurrent) throw assetCacheError('ASSET_CACHE_STALE_CATALOG');
          }
          await assertMutable();
        } else if (refresh) {
          await refreshSummary({ force: true });
          await adoptMatchingLocalCatalog();
        }
        if (!mutates) {
          const playback = await swMessage('ASSET_CACHE_CAN_MUTATE');
          patch({ playing: ownPlaying || !!playback.playing });
        }
        if (job.paused) throw assetCacheError('ASSET_CACHE_PAUSED');
        if (action === 'clear') {
          await swMessage('ASSET_CACHE_CLEAR');
          patch({ readyFiles: 0, readyBytes: 0, missingFiles: state.totalFiles, missingBytes: state.totalBytes });
        } else if (catalog) {
          await runWorker(action === 'catalog' ? 'scan' : action, { deep, ...(file ? { file } : {}) });
          if (action === 'import' || action === 'download') await swMessage('ASSET_CACHE_PRUNE');
        }
      };
      if (mutates) await env.navigator.locks.request('sp-asset-cache-mutation', { ifAvailable: true }, async (lock) => {
        if (!lock) throw assetCacheError('ASSET_CACHE_BUSY');
        await run();
      });
      else await run();
      patch({ phase: settledPhase(), speedBps: 0, waiting: false });
      return getState();
    } catch (error) {
      const code = job.paused ? 'ASSET_CACHE_PAUSED' : error.code || 'ASSET_CACHE_STORAGE_ERROR';
      patch({ phase: code === 'ASSET_CACHE_PAUSED' ? 'paused' : 'error', error: code === 'ASSET_CACHE_PAUSED' ? null : code,
        speedBps: 0, waiting: false });
      // Pausing is a successful user action, and must not create an unhandled promise rejection.
      if (code === 'ASSET_CACHE_PAUSED') return getState();
      throw assetCacheError(code, error);
    } finally { operation = null; await updateStorage(); }
  }

  function pause() {
    if (operation) operation.paused = true;
    stopWorker();
    if (operation) patch({ phase: 'paused', speedBps: 0, waiting: false, error: null });
  }
  const scan = (options = {}) => operation && !options.deep ? Promise.resolve(getState()) : perform('scan', { refresh: true, ...options });
  const manager = {
    getState, state: getState, initialize, scan,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    downloadMissing: () => perform('download'),
    importZip(file) {
      if (!(file instanceof env.Blob)) return Promise.reject(assetCacheError('ASSET_CACHE_ZIP_INVALID'));
      return perform('import', { file });
    },
    importCatalog(file) {
      if (!(file instanceof env.Blob)) return Promise.reject(assetCacheError('ASSET_CACHE_BAD_CATALOG'));
      return perform('catalog', { file });
    },
    async admission() {
      // Fail open locally: optional mode remains usable when browser storage is unavailable.
      // Required mode is enforced by the server and refuses an absent/partial report.
      if (!state.supported || operation) return null;
      try {
        await scan({ refresh: true });
        if (!catalog || !state.catalogCurrent || !state.catalogComplete || operation) return null;
        return { schema: catalog.schema, version: catalog.version, readyFiles: state.readyFiles, readyBytes: state.readyBytes };
      } catch { return null; }
    },
    pause, clear: () => perform('clear'),
    requestPersistence() {
      if (!state.supported || !state.storage.persistenceSupported) {
        patch({ persistence: 'unsupported' });
        return Promise.resolve(false);
      }
      if (state.storage.persisted) {
        patch({ persistence: 'granted' });
        return Promise.resolve(true);
      }
      if (persistenceRequest) return persistenceRequest;

      // Invoke persist() before the first await so browsers retain the user activation.
      let pending;
      patch({ persistence: 'requesting' });
      try { pending = env.navigator.storage.persist(); }
      catch {
        patch({ persistence: 'error' });
        return Promise.resolve(false);
      }
      persistenceRequest = (async () => {
        try {
          const granted = !!await pending;
          await updateStorage();
          patch({ persistence: granted ? 'granted' : 'denied',
            storage: { ...state.storage, persisted: granted || state.storage.persisted } });
          return granted;
        } catch {
          await updateStorage();
          patch({ persistence: 'error' });
          return false;
        } finally { persistenceRequest = null; }
      })();
      return persistenceRequest;
    },
    async setPlaying(value) {
      if (ownPlaying === !!value) return;
      ownPlaying = !!value;
      patch({ playing: ownPlaying });
      if (ownPlaying) pause();
      if (registration) {
        try {
          const result = await swMessage('ASSET_CACHE_PLAYING', { playing: ownPlaying });
          patch({ playing: ownPlaying || !!result.playing });
        } catch { /* No SW must never prevent entering a match. */ }
      }
      if (!ownPlaying && !initialized && !initializing) await initialize();
      // Do not apply catalog upgrades on this page automatically: assets/data modules may still
      // hold old manifests. Explicit operations in the lobby or a normal reload adopt the new catalog.
    },
    destroy() {
      pause();
      if (backgroundTimer !== null) env.clearTimeout(backgroundTimer);
      env.navigator?.serviceWorker?.removeEventListener('message', onSWMessage);
      listeners.clear();
    },
  };
  return manager;
}

export const assetCache = createAssetCacheManager();
