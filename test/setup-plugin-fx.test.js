import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fxFixture } from './helpers/fxFixtures.js';
import { installedFxReferences, officialFxReferences } from '../server/plugins/fxReferences.js';
import { checkPluginFx, pluginFxExtractionAllowed } from '../tools/setup.mjs';

/** The Python interpreter this machine has (python3 on Linux/macOS, python on Windows). */
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);

test('setup notices installed official references absent from data/index, without reading scripts or links', t => {
  const f = fxFixture(t);
  f.put('plugins/demo/plugin.json', { operators: ['ops.json'], assets: 'assets.json', entry: { sim: 'evil.js' } });
  f.put('plugins/demo/ops.json', [{ fx: { unit: 'char_4217_makoto' } }, { origin: { charId: 'char_9001_test' }, art: { assets: { spine: 'char_9002_test' } } }, { charId: 'char_9003_test' }]);
  f.put('plugins/demo/assets.json', { chars: { char_x_demo_one: { ref: 'char_9004_test' } } });
  fs.writeFileSync(path.join(f.root, 'plugins/demo/evil.js'), 'throw new Error("must never execute");');
  const ids = ['char_4217_makoto','char_9001_test','char_9002_test','char_9003_test','char_9004_test'];
  assert.deepEqual(installedFxReferences(f.root), ids); assert.deepEqual(checkPluginFx(f.root), ids);
  f.put('public/assets/local/fx/index.json', { units: { char_4217_makoto: {} } });
  assert.deepEqual(checkPluginFx(f.root), ids.slice(1));
  f.put('plugins/linked/plugin.json', { operators: ['linked.json'] });
  // A file symlink needs Developer Mode / SeCreateSymbolicLinkPrivilege on Windows: skip there rather than fail.
  try {
    fs.symlinkSync(path.join(f.root, 'plugins/demo/ops.json'), path.join(f.root, 'plugins/linked/linked.json'));
  } catch (e) {
    if (e && (e.code === 'EPERM' || e.code === 'EACCES')) { t.skip(`this platform refuses symlinks (${e.code})`); return; }
    throw e;
  }
  assert.deepEqual(installedFxReferences(f.root), ids);
  const r = spawnSync(process.execPath, ['tools/local-extract/plugin-fx.mjs', f.root], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.deepEqual(JSON.parse(r.stdout), ids, 'extractor uses exactly the setup reference reader');
  f.put('.cache/gamedata/excel/character_table.json', { char_4217_makoto: { skills: [{ skillId: 'skcom_synthetic' }] } });
  const source = `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.resolve('tools/local-extract'))})\nimport fx\nprint(json.dumps(fx.game_data(${JSON.stringify(f.root)})))`;
  const py = spawnSync(PY, ['-c', source], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(py.status, 0, py.stderr);
  const discovered = JSON.parse(py.stdout);
  assert.deepEqual(discovered.chars, ids); assert.deepEqual(discovered.skills.char_4217_makoto, ['skcom_synthetic']);
});

test('effect gap requires typed yes; check/no-local always win and unchanged refs do not prompt extraction', () => {
  for (const answer of [false, null, undefined]) assert.equal(pluginFxExtractionAllowed({}, ['char_1_x'], answer), false);
  assert.equal(pluginFxExtractionAllowed({}, ['char_1_x'], true), true);
  assert.equal(pluginFxExtractionAllowed({}, [], true), false);
  assert.equal(pluginFxExtractionAllowed({ local: 'force' }, []), true);
  assert.equal(pluginFxExtractionAllowed({ check: true, local: 'force' }, ['char_1_x'], true), false);
  assert.equal(pluginFxExtractionAllowed({ local: 'no', yes: true }, ['char_1_x'], true), false);
  assert.deepEqual(officialFxReferences({ fx: { unit: '../char_1_x' }, charId: 'char_x_demo_one' }), []);
});
