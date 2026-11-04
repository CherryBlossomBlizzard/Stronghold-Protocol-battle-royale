import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';

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

// 客户端能不能看到分组：以前视图只发把全房拍平的 order，客户端于是把所有组的已选都当「队友已选」、也只画一条
// 全房决策顺序 —— 分组看起来就"没工作"。draft.groups 是分组轮转的真相（成员 / 该组顺序 / 轮到谁）。
test('20 人房：m.public.draft 带上分组（members / order / turn），客户端据此只按本组轮选与判重', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 18, seed: 11, rulesVariant: 'battle-royale' }).start();
  h.drive(() => h.m.phase === PHASE.BAND_DRAFT);
  const d = h.m.publicView().draft;
  assert.equal(d.groups.length, 5, '5 个卡池组');
  for (const g of d.groups) {
    assert.equal(g.members.length, 4);
    assert.equal(g.order.length, 4);
    assert.deepEqual([...g.order].sort(), [...g.members].sort(), '组内轮转顺序就是这 4 个人');
  }
  // 每组一个当前选人，且互不相同
  const turns = d.groups.map((g) => g.turn).filter(Boolean);
  assert.equal(turns.length, 5, '每组都在轮选中');
  assert.equal(new Set(turns).size, 5);
  // 兼容字段还在：把全房拍平的 order / 第一个未完成组的 turn
  assert.equal(d.order.length, 20);
  assert.ok(typeof d.turn === 'string' && turns.includes(d.turn));
  h.m.dispose();
});