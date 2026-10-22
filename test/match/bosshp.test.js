// Final Assault leader HP vs the official game (user report after playtest #6: "终极 / 绝境 leaders fell within a few
// seconds; with our layers the official leader never dies that fast"). DESIGN §20.10.
//   * Pool: one pool for every boss field (official tip "最终攻势中，所有人将一起对敌方领袖造成伤害"), bloodPoint[difficulty]
//     of data/bosses.json (= activity_table bossInfoDict bloodPoint / Normal / Hard / Abyss of the current data; PRTS
//     盟约记录's leader table is the older 11月18日 revision, 铳 险境 and 胄 / 铳 / 萨米 绝境 differ, no 终极 column) per
//     player alive when the fight starts (DESIGN §25.13.4: the owner's decision of 2026-10-06, adopting PR #209).
//   * Damage: the 卫戍 systems' "+X%" attribute bonuses are 直接乘算 — summed, not compounded (PRTS 盟约记录 / 游戏数据基础);
//     v2.5 compounded them, which made stacked lineups kill the leaders 1.2–3× faster (more with more layers).
// Real bot matches to the Final Assault (real sim, server-run fields): every operator fighting the leader carries its
// bond / strategy / equipment bonuses in the additive bucket, both fields drain the one pool exactly once per hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, DATA } from './harness.js';
import { aggregateMods } from '../../server/sim/buffs.js';
import { bondBb } from '../../server/sim/content/bonds/addon/battle.js';
import { DataSource } from '../../server/sim/simdata.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { SharedBossPool } from '../../server/match/finalAssault.js';
import { RULES } from '../../server/match/battleRoyaleRules.js';

/** 4 AI seats, co-op, LP 400 (they reach R14), +`layers` on every active bond at the boss round's prep. */
function toFinalAssault({ difficulty, seed, bossId, layers = 0 }) {
  const seats = [0, 1, 2, 3].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  // instant: false — the boss fields wait for the test to step them (server-run, real sim)
  const h = makeMatch({ rulesVariant: 'battle-royale', mode: 'coop', difficulty, seats, seed, captureFrames: false, instant: false });
  const m = h.m;
  m.bossId = bossId;
  m.start();
  let last = '';
  h.run(() => {
    const k = `${m.phase}:${m.round}`;
    if (k !== last) {
      last = k;
      if (m.phase === PHASE.PREP && m.round === 1) for (const ps of m.players.values()) ps.lp = 400;
      if (layers && m.phase === PHASE.PREP && m.round === m.gd.bossRound) {
        for (const ps of m.alivePlayers()) {
          for (const id of m.gd.bondIds) if (ps.bonds[id] && ps.bonds[id].active) ps.layers[id] = (ps.layers[id] || 0) + layers;
          ps.recompute();
        }
      }
    }
    return h.ended != null || m.phase === PHASE.FINAL_ASSAULT;
  }, { maxSteps: 8e6 });
  assert.equal(m.phase, PHASE.FINAL_ASSAULT, 'reached the Final Assault');
  return h;
}

// activity_table act2autochess.bossInfoDict [bloodPoint, bloodPointNormal, bloodPointHard, bloodPointAbyss] — the local
// cache and upstream ArknightsGameData master (zh_CN) were identical on 2026-10-01. PRTS 盟约记录's leader table is the
// older 11月18日 revision (铳 险境 450 000, 胄 / 铳 / 萨米 绝境 1 600 000 / 870 000 / 1 800 000, no 终极, no 卢西恩).
const OFFICIAL_BLOOD_POINT = {
  boss_1: [247500, 675000, 1800000, 3600000], boss_2: [225000, 400000, 800000, 3000000],
  boss_3: [285000, 708750, 2000000, 4000000], boss_4: [307500, 708750, 2100000, 4200000],
  boss_5: [200000, 390000, 780000, 3000000], boss_6: [285000, 705000, 1990000, 3980000],
  boss_7: [277500, 787500, 2000000, 4000000], boss_8: [750000, 937500, 3600000, 7200000],
  boss_9: [675000, 900000, 2800000, 3950000], boss_10: [825000, 1012500, 3800000, 7600000],
};

test('leader HP data = the current official bossInfoDict for every leader and difficulty', () => {
  assert.deepEqual(Object.keys(DATA.bosses).sort(), Object.keys(OFFICIAL_BLOOD_POINT).sort());
  for (const [id, want] of Object.entries(OFFICIAL_BLOOD_POINT)) {
    const bp = DATA.bosses[id].bloodPoint;
    assert.deepEqual([bp.FUNNY, bp.NORMAL, bp.HARD, bp.ABYSS], want, id);
  }
});

const SYSTEM_KEY = /^(bond|item|band|choice):/;
const MUL_STATS = ['atkMul', 'defMul', 'hpMul'];

test('终极 Final Assault (+200 layers per active bond): one pool (bloodPoint × 4 alive) for both fields, bonuses additive, each hit once', () => {
  const h = toFinalAssault({ difficulty: 'ABYSS', seed: 2, bossId: 'boss_1', layers: 200 });
  const m = h.m;
  const pool = m.bossPool;
  assert.equal(m.alivePlayers().length, 4);
  // 卫戍协议：盟约 · 大逃杀：首领血量固定十亿（不再按存活人数缩放）
  assert.equal(pool.maxHp, RULES.bossHp, 'the fixed ten-billion pool');
  const fields = m.fields.filter((f) => f.battle);
  assert.equal(fields.length, 2, 'two pair fields');
  // one second into the fight: every operator's stats
  for (const f of fields) for (let i = 0; i < 30; i++) f.battle.step();
  let ops = 0, withBonds = 0;
  for (const f of fields) {
    for (const u of f.battle.allyUnits) {
      if (u.kind !== 'op' || !u.alive) continue;
      ops++;
      const sys = u.buffs.filter((b) => SYSTEM_KEY.test(String(b.key)) && b.mods);
      if (sys.length) withBonds++;
      for (const b of sys) {
        for (const k of MUL_STATS) assert.ok(!(k in b.mods), `${u.name}: ${b.key} is a 直接乘算 bonus, not ${k} (${JSON.stringify(b.mods)})`);
      }
      const { add, mul } = aggregateMods(u.buffs);
      // the 练度 multiplier (0.2.2, the unit's own cultMul: default 精英2 Lv.60 = ×1.1) is a separate factor, after 直接乘算
      const cult = u.cultMul ? u.cultMul.atk : 1;
      const want = Math.max(0, ((u.base.atk + (add.atkFlat ?? 0)) * Math.max(0, 1 + (add.atkPct ?? 0)) + (add.atkFinal ?? 0)) * (mul.atkMul ?? 1) * cult);
      assert.ok(Math.abs(u.s.atk - want) <= 1e-6 * Math.max(1, want), `${u.name}: ATK = ((base + flat) × (1 + Σ%) + 最终加算) × Π(提升至/runes) × 练度`);
    }
  }
  assert.ok(ops >= 12 && withBonds >= 8, `the bots' lineups carry bond / item bonuses (${withBonds} of ${ops})`);
  m.dispose();
});

test('绝境 Final Assault: both pair fields drain the one pool, every hit exactly once', () => {
  const h = toFinalAssault({ difficulty: 'HARD', seed: 3, bossId: 'boss_5' });
  const m = h.m;
  assert.equal(m.bossPool.maxHp, RULES.bossHp, 'the fixed ten-billion pool');
  assert.equal(m.gd.bossPoolHp('boss_5', 2), RULES.bossHp, 'the same pool whatever the count');
  const pool = m.bossPool;
  const fields = m.fields.filter((f) => f.battle);
  assert.equal(fields.length, 2);
  assert.ok(fields.every((f) => f.battle.sharedBoss === pool || f.battle.sharedBoss.pool === pool), 'one pool behind both fields');
  const before = pool.hp;
  const dealt = new Map();
  // (element gauge fills — type 'element', 元素损伤 — fill the leader's gauge, not its HP)
  for (const f of fields) f.battle.on('damaged', (c) => { if (c.target && c.target.bossPool && c.type !== 'element') dealt.set(f.fieldId, (dealt.get(f.fieldId) || 0) + c.amount); }, { priority: -1e9 });
  for (let i = 0; i < 600; i++) for (const f of fields) if (!f.battle.finished) f.battle.step(); // 20 game s
  const sum = [...dealt.values()].reduce((a, b) => a + b, 0);
  assert.ok(dealt.get('b1') > 0 && dealt.get('b2') > 0, `both fields hit the leader (${[...dealt]})`);
  assert.ok(Math.abs((before - pool.hp) - Math.min(before, sum)) <= 1e-6 * before, `the pool lost exactly the hits (${before - pool.hp} vs ${sum})`);
  m.dispose();
});

test('终极 Final Assault vs 假想敌：胄 (seeded bot match): both players\' 奥术 never multiply on the leader; a drone costs it 2 % of the pool', () => {
  // DESIGN §20.10: one 奥术 instance per target (the strongest — PRTS 作战机制 同名buff, 巴哈姆特 12316 "共享型buff會跟對面搶");
  // 死亡集群's "最大生命值2%" = the leader's shown max HP, the pool (DRONE_LINK_BASE 'pool' [ASSUMED]): 288 000 at 终极
  // with 4 alive (14 400 000)
  // the bots' boards follow every draw of the match (the elite-to-board merge, DESIGN §20.11, moved seed 7 to 12; the
  // 战术决策 drawn with replacement moved 12 on): the first of these seeds whose bots pair two 奥术 players
  const pairOf = (m) => m.fields.filter((f) => f.battle).find((f) => f.players.length === 2 && f.players.every((pid) => f.battle.getPlayer(pid).bonds.arcaneShip?.active));
  let h = null;
  for (const seed of [13, 7, 11, 21, 23]) {
    h = toFinalAssault({ difficulty: 'ABYSS', seed, bossId: 'boss_1' });
    if (pairOf(h.m)) break;
    h.m.dispose();
    h = null;
  }
  assert.ok(h, 'precondition: a pair field where both players run 奥术 (bot lineups of one of the seeds)');
  const m = h.m;
  const fields = m.fields.filter((f) => f.battle);
  const bb = bondBb('arcaneShip');
  const both = pairOf(m);
  const allowed = [];
  for (const pid of both.players) {
    const b = both.battle.getPlayer(pid).bonds.arcaneShip;
    const v = bb.base_damage_scale + bb.damage_scale_per_stack * b.layers;
    allowed.push(v, v * bb.power_weak_scale);
  }
  const links = [];
  for (const f of fields) {
    f.battle.on('damaged', (c) => {
      if (c.target && c.target.bossPool && c.type === 'true' && c.dmg && !c.dmg.origin && c.dmg.tags && c.dmg.tags.includes('hpLoss')) links.push(c.amount);
    }, { priority: -1e9 });
  }
  let withArcane = 0;
  for (let i = 0; i < 1200; i++) { // 40 game s
    for (const f of fields) if (!f.battle.finished) f.battle.step();
    for (const e of both.battle.enemies) {
      if (!e.alive || !e.isBoss) continue;
      const arc = e.buffs.filter((x) => String(x.key).startsWith('bond:arcaneShip'));
      assert.ok(arc.length <= 1, `one 奥术 instance on the leader (${arc.map((x) => x.key)})`);
      if (!arc.length) continue;
      withArcane++;
      const v = arc[0].mods.artsTakenMul;
      assert.ok(allowed.some((a) => Math.abs(a - v) < 1e-9), `the 奥术 value is one player's (${v} ∉ ${allowed}), never a product`);
    }
  }
  assert.ok(withArcane > 100, `the leader carried 奥术 (${withArcane} samples)`);
  // 卫戍协议：盟约 · 大逃杀：第 bossRound 回合的怪物倍率极高（十亿血首领所在的回合），死亡集群在 40 游戏秒里打不下来，
  // 所以这里不要求「已经打掉过无人机」；只要真发生了转伤，就一直按 2 % × 池子核对（池子固定十亿）。
  for (const x of links) assert.equal(x, m.bossPool.maxHp * 0.02, 'drone link = 2 % × the pool');
  assert.equal(m.bossPool.maxHp, RULES.bossHp, 'the fixed ten-billion pool');
  m.dispose();
});

test('卫戍协议 · 大逃杀：没有隐秘核心 —— 对局在第 bossRound 回合的首领战后就结束', () => {
  // 隐秘核心的「碎铳之簧把受到的伤害 1:1（等量、无来源）转给铳」本身是 sim 机制，仍由
  // test/content/enemies_bosses.test.js 的 bossArena 用例覆盖（不经过对局流程）；本分支只是不再进入隐秘核心。
  const h = makeMatch({ rulesVariant: 'battle-royale', mode: 'coop', difficulty: 'HARD', humans: 2, seed: 7, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : {}) }).start();
  const m = h.m;
  assert.equal(m.gd.hiddenRound, null, 'no hidden core');
  assert.equal(m.gd.bossRound, RULES.bossRound, 'the final assault is on the branch\'s round');
  h.drive(() => m.phase === PHASE.PREP && m.round === RULES.bossRound);
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  assert.equal(end.hiddenReached, false);
  assert.equal(end.roundsPassed, RULES.bossRound);
  m.dispose();
});
