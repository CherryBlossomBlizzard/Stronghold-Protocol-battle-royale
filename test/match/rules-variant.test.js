import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { getData } from '../../server/data.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { bondBb } from '../../server/sim/content/bonds/core.js';
import { TOKEN_IDS } from '../../server/sim/content/tokens.js';
import { rollWavePick } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';

const GAME = getData({ log: { warn() {}, error() {}, info() {} } });

test('规则变体：同一服务器上官方与大逃杀并存，房主选哪个就是哪个', () => {
  const br = new GameData(GAME, 'mode_multi_normal');
  const off = new GameData(GAME, 'mode_multi_normal', { variant: 'official' });
  // 回合结构
  assert.equal(br.bossRound, 20);
  assert.equal(off.bossRound, 14);
  assert.equal(br.hiddenRound, null);
  assert.equal(off.hiddenRound, 15);
  // 血量
  assert.equal(br.startLp('band_sarkazb'), 30);
  assert.equal(off.startLp('band_sarkazb'), DATA.bands.band_sarkazb.totalHp);
  // 首领血量
  assert.equal(br.bossFixedHp, 500000000);
  assert.equal(off.bossFixedHp, null);
  // 出怪
  assert.equal(br.rollWaves, true);
  assert.equal(off.rollWaves, false);
  // 无限回合
  assert.equal(br.endless, true);
  assert.equal(off.endless, false);
  // 战场 flags（浏览器同款 spec）
  assert.equal(br.battleFlags.bossHitLimit, false);
  assert.equal(off.battleFlags.bossHitLimit, undefined);
  assert.equal(br.battleFlags.timesHpBonus, false);
  assert.equal(off.battleFlags.timesHpBonus, undefined);
});

test('规则变体：真实对局里两边的开局数值', () => {
  const h1 = makeMatch({ rulesVariant: 'battle-royale', mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 71 }).start();
  h1.toPrep(1);
  assert.equal(h1.m.gd.rulesVariant, 'battle-royale');
  assert.equal(h1.ps('p_0').lp, 30);
  h1.m.dispose();
  const h2 = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 71, rulesVariant: 'official' }).start();
  h2.toPrep(1);
  assert.equal(h2.m.gd.rulesVariant, 'official');
  assert.equal(h2.ps('p_0').lp, DATA.bands[h2.ps('p_0').bandId].totalHp);
  h2.m.dispose();
});

test('规则变体：扣血加钱只在大逃杀能用，官方局一律拒绝（服务器与客户端都不给入口）', () => {
  const off = new GameData(GAME, 'mode_multi_normal', { variant: 'official' });
  const br = new GameData(GAME, 'mode_multi_normal');
  assert.equal(br.RULES.bloodMoneyCost > 0, true, '大逃杀有扣血加钱');
  assert.equal(off.RULES.bloodMoneyCost, 0, '官方变体把它关掉（0 = 未启用）');

  const money = (rulesVariant) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 71, rulesVariant }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    const lp0 = ps.lp, funds0 = ps.funds;
    const res = h.m.handle('p_0', { t: 'g.bloodMoney' });
    const out = { res, lp0, funds0, lp: ps.lp, funds: ps.funds };
    h.m.dispose();
    return out;
  };

  const brr = money('battle-royale');
  assert.equal(brr.res && brr.res.error, undefined, `大逃杀可以扣血加钱：${JSON.stringify(brr.res)}`);
  assert.equal(brr.lp, brr.lp0 - 3, '花 3 滴血');
  assert.equal(brr.funds, brr.funds0 + 1, '换 1 资金');

  const offr = money('official');
  assert.equal(offr.res && offr.res.error, 'WRONG_PHASE', '官方局拒绝');
  assert.equal(offr.lp, offr.lp0, '目标生命值不动');
  assert.equal(offr.funds, offr.funds0, '资金不动');
});

// 炎佑是「我方盟约召唤物」，在本复刻里从不作为敌人出现，也不吃炎的层数增益 —— 两个变体都得这样。
test('炎佑只作为我方召唤存在：两个变体的战场骰子池都不含它，召唤出来的炎佑也不吃层数增益', () => {
  // 1) 骰子池（第 14 回合起「全部怪物」）里没有 enemy_9012_acloon —— 否则它会被当成普通精英飞行怪刷进怪海
  for (const variant of ['battle-royale', 'official']) {
    const gd = new GameData(GAME, 'mode_multi_normal', variant === 'official' ? { variant } : null);
    const rng = createRng(12345);
    for (let i = 0; i < 600; i++) {
      const pick = JSON.stringify(rollWavePick(gd, rng, 14));
      assert.equal(pick.includes('enemy_9012_acloon'), false, `${variant}：骰子抽到了炎佑`);
    }
  }
  // 2) 25 层炎召唤出来的炎佑不吃层数增益（上游行为）：只有模板 + 30 % 总和
  const bb = bondBb('yanShip');
  const tpl = DATA.tokens.enemy_9012_acloon.stats;
  const chess = {};
  const five = [];
  for (let i = 0; i < 5; i++) { const id = `y${i}_a`; chess[id] = chessRec({ id, bonds: ['yanShip'], profession: 'WARRIOR', skill: null, stats: { atk: 1000, maxHp: 10000, def: 0, blockCnt: 2 } }); five.push(id); }
  for (const variant of ['battle-royale', 'official']) {
    const gd = new GameData(GAME, 'mode_multi_normal', variant === 'official' ? { variant } : null);
    const h = makeBattle({
      defs: { chess, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0, def: 0, res: 0 }) } },
      units: five.map((id, i) => ({ chessId: id, row: 10, col: 3 + i })),
      bonds: { yanShip: { count: 6, active: true, tier: 2, layers: 25 } },
      flags: gd.battleFlags,
    });
    h.step(1);
    const y = h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.yanyou);
    assert.ok(y, `${variant}：召唤出了炎佑`);
    const sumAtk = 5 * 1000 * (1 + bb.base_atk + bb.atk_per_stack * 25);
    assert.ok(Math.abs(y.s.atk - (tpl.atk + sumAtk * 0.3)) < 1e-6, `${variant}：炎佑 = 模板 + 30% 总和（${y.s.atk}）`);
    assert.equal(y.buffs.some((b) => b.key === 'bond:yan'), false, `${variant}：炎佑不吃层数增益`);
  }
});