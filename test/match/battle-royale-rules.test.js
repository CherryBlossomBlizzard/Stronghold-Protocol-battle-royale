// 卫戍协议：盟约 · 大逃杀：本服的战场规则（RULES，经 GameData.battleFlags 写进每块战场的 specs.flags）
// + 前 13 回合的官方出怪校验。
//
//   1. 首领战关闭官方限伤：单次伤害 >= 300000 不再被整个抵消（打五亿血的首领用）；
//   2. 次数怪（频次器物）不吃回合血量加成：次数固定用数据原值；
//   3. 第 1-13 回合 = 官方派系 / 回合表 + 官方数值表，一点没改；
//   4. 第 14 回合起次数怪（频次器物）不再进波次，只以亡语形态（击杀后召唤 / 分裂）出现；首领本体也不进普通波次；
//   5. 首领战血量固定五亿；第 14 回合起飞行怪频率降低（flySpawnChance）；亡语 / 召唤产物不进骰子池。
//
// 两个开关都只在「比赛里的战场」打开（GameData.battleFlags），工具与 golden 构造的战场不带这些 flag，保持上游默认。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import { SharedBossPool, bossPoolHp } from '../../server/match/finalAssault.js';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves, buildNormalWave, roundPick } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { RULES } from '../../server/match/battleRoyaleRules.js';
import { BOSS_HIT_LIMIT } from '../../shared/constants.js';
import { getData } from '../../server/data.js';

const DATA = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const GAME = getData({ log: { warn() {}, error() {}, info() {} } });
const LIMIT = BOSS_HIT_LIMIT;

// ---------------------------------------------------------------------------------------------------------------
// 1. 首领战关闭限伤

/** A boss field with a leader (tag 'boss') standing still; `flags` go to the battle, `pool` when given. */
function bossField({ flags = undefined, pool = null } = {}) {
  const h = makeBattle({
    kind: 'boss', sharedBoss: pool, flags,
    defs: {
      chess: { t_guard: chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 10, maxHp: 1e9 }, skill: null }) },
      enemies: { enemy_lead: enemyRec({ key: 'enemy_lead', rank: 'BOSS', hp: 1e9, speed: 0 }) },
    },
    players: [{ playerId: 'P', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, chessId: 't_guard', row: 10, col: 2 }], bonds: {}, playerEffects: [] }],
    enemies: [{ key: 'enemy_lead', pos: [3, 9], tag: 'boss' }],
    content: 'none', autoFinish: false,
  });
  h.step();
  const leader = h.enemy('enemy_lead');
  assert.ok(leader && leader.isBoss, 'the leader is a boss unit');
  return { h, b: h.b, leader, op: h.unit(1) };
}
const capEvents = (h) => h.eventsOf('fx').filter((e) => e[1] === 'hitCap');

test('默认（未带开关）：限伤照旧，300000 的一击被整个抵消', () => {
  const { h, b, leader, op } = bossField();
  assert.equal(b.dealDamage(op, leader, { amount: LIMIT - 1, type: 'true' }), LIMIT - 1, '299999 lands');
  assert.equal(b.dealDamage(op, leader, { amount: LIMIT, type: 'true' }), 0, 'cancelled, not clamped');
  assert.equal(capEvents(h).length, 1);
});

test('本服（bossHitLimit: false）：限伤关闭，超过 30 万的一击按实际值结算，也不再产生 hitCap', () => {
  const pool = new SharedBossPool(1e9);
  const { h, b, leader, op } = bossField({ flags: { bossHitLimit: false }, pool });
  assert.equal(b.flags.bossHitLimit, false);
  assert.equal(b.dealDamage(op, leader, { amount: LIMIT, type: 'true' }), LIMIT, 'the 300000 hit lands');
  assert.equal(b.dealDamage(op, leader, { amount: 5e6, type: 'true' }), 5e6, 'and so does a 5M one');
  assert.equal(pool.hp, 1e9 - LIMIT - 5e6, 'the shared pool takes it all');
  assert.equal(pool.byPlayer.get('P'), LIMIT + 5e6, 'credited to the player');
  assert.equal(capEvents(h).length, 0, 'no cancelled-hit event');
  assert.ok(leader.alive);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. 次数怪不吃血量加成

const JIN = 'enemy_1200_msfjin';                 // 青铜镜：data maxHp 30 = 需要 30 次伤害
const JIN_HITS = DATA[JIN].stats.maxHp;
const SFJIN = 'enemy_1199_sfjin';                // 身观：被击倒后生成 1 个青铜镜（亡语产物继承父级的 mods）

/** A field with the real 器物 kits (content: enemies) and one spawned hit-count unit. */
function timesField(key, mods, flags = undefined) {
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod], flags, seed: 7, autoFinish: false, timeLimit: 600,
    defs: { chess: { t_wall: chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e7 }, rangeGrid: [[0, 0]], skill: null }) } },
    players: [{ playerId: 'P', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, chessId: 't_wall', row: 12, col: 3 }], bonds: {}, playerEffects: [] }],
    enemies: [],
  });
  h.step();
  const e = h.spawn(key, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0, ...mods } });
  return { h, e };
}

test('次数怪默认（未带开关）：回合血量倍率照旧放大次数，青铜镜 x3 = 90 次', () => {
  const { e } = timesField(JIN, { hpMul: 3 });
  assert.equal(e.s.maxHp, JIN_HITS * 3);
});

test('本服（timesHpBonus: false）：青铜镜的次数固定 30，血量倍率不再放大；补给线仍照官方口径扣掉', () => {
  const plain = timesField(JIN, { hpMul: 3, atkMul: 1.4, speedMul: 0 }, { timesHpBonus: false });
  assert.equal(plain.e.s.maxHp, JIN_HITS, 'the data count, whatever the round');
  assert.equal(plain.e.hp, JIN_HITS, 'spawns full');
  assert.ok(plain.e.s.flags.hitCount, 'still a 频次 unit (one damage instance = one hit)');
  const round15 = timesField(JIN, { hpMul: 12.56, atkMul: 2.1, speedMul: 0 }, { timesHpBonus: false });
  assert.equal(round15.e.s.maxHp, JIN_HITS, 'round 15 x12.56 does not reach the count');
  const supply = timesField(JIN, { hpMul: 2.2, supplyHpMul: 1.08, speedMul: 0 }, { timesHpBonus: false });
  assert.equal(supply.e.s.maxHp, Math.round(JIN_HITS / 1.08), '补给线 / 补给线II 的那一份仍然扣');
});

test('次数怪不吃血量加成也管到亡语产物：身观生成的青铜镜同样是 30 次', () => {
  const { h, e } = timesField(SFJIN, { hpMul: 4, speedMul: 0 }, { timesHpBonus: false });
  h.b.kill(e, null);
  h.step();
  const child = h.enemies().find((x) => x.defId === JIN);
  assert.ok(child, '身观 leaves its 青铜镜');
  assert.equal(child.s.maxHp, JIN_HITS, 'the death spawn keeps the data count');
});

test('GameData.battleFlags：本服两条开关都写进每一块战场的 flags（浏览器收到同一份 spec）', () => {
  const gd = new GameData(GAME, 'mode_multi_normal');
  assert.equal(gd.battleFlags.bossHitLimit, RULES.bossHitLimit ? undefined : false);
  assert.equal(gd.battleFlags.timesHpBonus, RULES.timesHpBonus ? undefined : false);
  assert.equal(gd.battleFlags.dpMax, 99, 'the DP bundle still rides along');
});

// ---------------------------------------------------------------------------------------------------------------
// 3. 前 13 回合 = 官方

const MODES = ['mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss', 'mode_single_normal'];

test('第 1-13 回合：出怪用官方排期（不是骰子），数值用官方表；第 14 回合起才换骰子', () => {
  assert.equal(RULES.normalRoundMax, 13);
  assert.equal(RULES.rollWaveFrom, 14);
  for (const modeId of MODES) {
    const gd = new GameData(GAME, modeId);
    for (let seed = 1; seed <= 6; seed++) {
      const setup = setupMatchWaves(gd, createRng(seed));
      for (let r = 1; r <= RULES.normalRoundMax; r++) {
        assert.deepEqual(gd.enemyScale(r), gd.baseEnemyScale(r), `${modeId} R${r}: official scaling`);
        assert.equal(setup.picks[r].dice, undefined, `${modeId} R${r}: not a dice pick`);
        assert.equal(roundPick(gd, createRng(seed + 100), setup, r), setup.picks[r], `${modeId} R${r}: the official pick`);
        const w = buildNormalWave(gd, createRng(seed + 200), setup.factions, r);
        assert.equal(w.pick, setup.picks[r], `${modeId} R${r}: the wave uses that pick`);
      }
      assert.equal(roundPick(gd, createRng(seed + 300), setup, RULES.rollWaveFrom).dice, true, `${modeId} R14: dice`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 4. 第 14 回合起：次数怪只以亡语形态出现，首领本体不进普通波次

const isTimesRec = (rec) => rec.acType === 'TIMES' || (Array.isArray(rec.acTypes) && rec.acTypes.includes('TIMES'));
const TIMES_KEYS = Object.keys(DATA).filter((k) => isTimesRec(DATA[k]));
const BOSS_KEYS = Object.keys(DATA).filter((k) => DATA[k].rank === 'BOSS');

test('第 14 回合起：骰子与官方模板都不再直接出次数怪（频次器物）与首领本体', () => {
  assert.equal(RULES.timesDropFrom, 14);
  assert.equal(RULES.bossDropFrom, 14);
  assert.ok(TIMES_KEYS.length >= 9, 'the data has the 器物 keys');
  for (const modeId of MODES) {
    const gd = new GameData(GAME, modeId);
    for (let seed = 1; seed <= 5; seed++) {
      const setup = setupMatchWaves(gd, createRng(seed));
      for (const r of [RULES.timesDropFrom, 15, 16, 17, 18, 19]) {
        const w = buildNormalWave(gd, createRng(seed + 400), setup.factions, r);
        for (const s of w.spawns) {
          const rec = DATA[s.enemyKey];
          assert.ok(!isTimesRec(rec), `${modeId} R${r}: 次数怪 ${s.enemyKey} 直接出现在波次里`);
          assert.notEqual(rec.rank, 'BOSS', `${modeId} R${r}: 首领 ${s.enemyKey} 出现在普通波次里`);
        }
        assert.ok(w.spawns.length > 0, `${modeId} R${r}: still spawns`);
      }
      // 第 1-13 回合不受影响：官方排期的次数怪照常出现
      const early = buildNormalWave(gd, createRng(seed + 500), setup.factions, 1);
      assert.ok(early.spawns.length > 0);
    }
  }
});

test('次数怪只是「不直接出现」：它们的亡语形态（击杀后召唤出的器物）照常存在', () => {
  // 数据里 acType = TIMES 的是「需要 N 次伤害」的本体（身观 / 俗心 / 沉沙 …），它们的 firing 宝宝（青铜镜等）由 summons 给出。
  assert.ok(TIMES_KEYS.includes('enemy_1199_sfjin'), '身观 is a 频次 unit');
  assert.ok(TIMES_KEYS.includes('enemy_1207_sfji'), '沉沙 is a 频次 unit');
  // 亡语产物（青铜镜 enemy_1200_msfjin = 身观的召唤物）不是 TIMES 本体：它仍在数据里、仍会在击杀时召唤出来，
  // 我们不删它，只是让 TIMES 本体不再直接进波次。
  assert.deepEqual(DATA.enemy_1199_sfjin.summons, ['enemy_1200_msfjin']);
  assert.ok(DATA.enemy_1200_msfjin && !isTimesRec(DATA.enemy_1200_msfjin));
});

// ---------------------------------------------------------------------------------------------------------------
// 5. 首领战血量五亿；第 14 回合起飞行怪频率降低；亡语/召唤产物不进骰子池

test('首领战血量固定五亿（RULES.bossHp / GameData.bossFixedHp / bossPoolHp）', () => {
  assert.equal(RULES.bossHp, 500_000_000);
  const gd = new GameData(GAME, 'mode_multi_normal');
  assert.equal(gd.bossFixedHp, 500_000_000);
  // 不按存活人数缩放：1 人和 4 人都是同一个池子
  assert.equal(gd.bossPoolHp('boss_1', 1), 500_000_000);
  assert.equal(gd.bossPoolHp('boss_1', 4), 500_000_000);
  assert.equal(bossPoolHp(gd, 'boss_1', 4), 500_000_000);
});

test('第 14 回合起整体降低飞行怪频率：飞行槽只有 flySpawnChance 的概率真刷飞行怪', () => {
  assert.ok(RULES.flySpawnChance < 1, 'flySpawnChance lowers the fly rate');
  const gd = new GameData(GAME, 'mode_multi_normal');
  let flyActions = 0;
  let flySpawned = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const setup = setupMatchWaves(gd, createRng(seed));
    for (const r of [14, 15, 16, 17]) {
      const w = buildNormalWave(gd, createRng(seed + 700), setup.factions, r);
      for (const a of w.actions) {
        const act = gd.wave(w.templateId) && Array.isArray(gd.wave(w.templateId).spawns) ? gd.wave(w.templateId).spawns[a.index] : null;
        const slot = String(act && (act.slot || '') || '');
        if (slot.includes('F')) {
          flyActions++;
          const rec = a.valid && a.key ? DATA[a.key] : null;
          if (rec && (rec.isFlyEnemy === true || rec.stats?.motion === 'FLY')) flySpawned++;
        }
      }
    }
  }
  // 飞行槽位被跳过的比例 ≈ 1 - flySpawnChance（0.5）：40 种子 × 4 回合的飞行槽里，
  // 真刷出飞行怪的不超过 7 成、至少有 3 成被跳过（允许抽样波动，但趋势必须是「大幅减少」）
  assert.ok(flyActions >= 40, `fly placeholder actions seen (${flyActions})`);
  const rate = flySpawned / flyActions;
  assert.ok(rate < 0.72, `fly rate ${rate} < 0.72 (flySpawnChance = ${RULES.flySpawnChance})`);
  assert.ok(rate > 0.28, `fly rate ${rate} > 0.28 (not wiped out either)`);
  // 第 1–13 回合不读这个开关：官方排期照旧（有飞行敌人就照刷）
  let earlyFly = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const setup = setupMatchWaves(gd, createRng(seed));
    for (const r of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = buildNormalWave(gd, createRng(seed + 800), setup.factions, r);
      for (const s of w.spawns) {
        const rec = DATA[s.enemyKey];
        if (rec && (rec.isFlyEnemy === true || rec.stats?.motion === 'FLY')) earlyFly++;
      }
    }
  }
  assert.ok(earlyFly > 0, 'the official early rounds still field flyers');
});

test('亡语/召唤产物不进骰子池：身观的青铜镜（enemy_1200_msfjin）不再直接刷进怪海', () => {
  const MIRRORED = new Set(['enemy_1200_msfjin', 'enemy_1202_msfzhi', 'enemy_1204_msfhu', 'enemy_1210_msfden']);
  for (const k of MIRRORED) assert.ok(DATA[k], `${k} is in the data (summons still work)`);
  const gd = new GameData(GAME, 'mode_multi_normal');
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const setup = setupMatchWaves(gd, createRng(seed));
    for (const r of [14, 15, 16, 17, 18, 19]) {
      const w = buildNormalWave(gd, createRng(seed + 900), setup.factions, r);
      for (const s of w.spawns) {
        seen.add(s.enemyKey);
        assert.ok(!MIRRORED.has(s.enemyKey), `R${r}: 亡语产物 ${s.enemyKey} 直接出现在怪海里`);
      }
    }
  }
  // 骰子池本身仍有足够多的候选（不是空池）
  assert.ok(seen.size >= 30, `dice pool still rich (${seen.size} distinct keys)`);
});

test('首领的部件（data/bosses.json 的 parts，如「破胄之锤」）不直接刷进普通怪海', () => {
  // 部件的 rank 是 ELITE，只按 rank === BOSS 排除会漏掉它们；它们只该作为首领的一部分出现。
  const PARTS = new Set();
  for (const id of Object.keys(GAME.bosses || {})) {
    const rec = (GAME.bosses || {})[id];
    if (rec && Array.isArray(rec.parts)) for (const p of rec.parts) if (typeof p === 'string') PARTS.add(p);
  }
  assert.ok(PARTS.size >= 6, `the data lists the leaders' parts (${PARTS.size})`);
  assert.ok(PARTS.has('enemy_9015_acstmb'), '“破胄之锤” is boss_8’s part');
  // 它的 rank 不是 BOSS —— 正是「只按 rank 排除」会漏掉的那一类
  assert.notEqual(DATA.enemy_9015_acstmb.rank, 'BOSS');

  const gd = new GameData(GAME, 'mode_multi_normal');
  for (let seed = 1; seed <= 60; seed++) {
    const setup = setupMatchWaves(gd, createRng(seed));
    for (const r of [14, 15, 16, 17, 18, 19]) {
      const w = buildNormalWave(gd, createRng(seed + 950), setup.factions, r);
      for (const s of w.spawns) {
        assert.ok(!PARTS.has(s.enemyKey), `R${r}: 首领部件 ${s.enemyKey} 直接出现在怪海里`);
      }
    }
  }
});
