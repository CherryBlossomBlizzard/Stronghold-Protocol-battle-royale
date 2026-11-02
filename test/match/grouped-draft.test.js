import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

test('20 人房：5 组分组轮选与独立卡池（4 人一组，组内策略不重复，跨组可重复，卡池无限）', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 20, bots: 0, seed: 9, rulesVariant: 'battle-royale' });
  h.autoHumans();
  const m = h.m;
  m.start();
  h.toPrep(1);
  // 5 组、每组 4 人
  assert.equal(m.poolGroups.length, 5);
  for (const g of m.poolGroups) assert.equal(g.playerIds.length, 4);
  // 组内策略不重复（队友已选只在组内）
  for (const g of m.poolGroups) {
    const set = new Set(g.playerIds.map((id) => m.players.get(id).bandId));
    assert.equal(set.size, 4, `组内策略重复: ${[...set].join(',')}`);
  }
  // 各组卡池对象独立，每人绑定自己组的池
  assert.equal(new Set(m.poolGroups.map((g) => g.pool)).size, 5);
  for (const g of m.poolGroups) for (const id of g.playerIds) assert.equal(m.playerPools.get(id), g.pool);
  // 卡池无限：库存放大 100 倍（RULES.infinitePool / poolCapMultiplier）
  const pool = m.poolGroups[0].pool;
  assert.equal(pool.multiplier, 100);
  const anyId = m.gd.visibleChess.find((id) => pool.cap(id) > 0);
  assert.ok(anyId, '卡池里应有非零库存的棋子');
  assert.equal(pool.cap(anyId), m.gd.poolCopies(anyId) * 100);
  m.dispose();
});