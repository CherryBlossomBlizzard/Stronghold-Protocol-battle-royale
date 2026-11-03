import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { getData } from '../../server/data.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { bondBb } from '../../server/sim/content/bonds/core.js';
import { TOKEN_IDS } from '../../server/sim/content/tokens.js';

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
  // 炎盟约 13 层后炎佑吃层数增益：只有大逃杀下发这个 flag
  assert.equal(br.battleFlags.yanyouLayerBonusFrom, 13);
  assert.equal(off.battleFlags.yanyouLayerBonusFrom, undefined);
  assert.equal(off.battleFlags.yanyouLayerBonusFrom === undefined, true, '官方局绝不带这个开关');
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

test('规则变体：炎的层数增益只在大逃杀给炎佑（变体 → battleFlags → 战斗模拟，端到端）', () => {
  const br = new GameData(GAME, 'mode_multi_normal');
  const off = new GameData(GAME, 'mode_multi_normal', { variant: 'official' });
  assert.equal(bondBb('yanShip').atk_per_stack > 0, true, '炎的层数公式存在');

  const five = [];
  for (let i = 0; i < 5; i++) five.push([`y${i}_a`, ['yanShip']]);
  const chess = {};
  for (const [id, bonds] of five) {
    chess[id] = chessRec({ id, bonds, profession: 'WARRIOR', skill: null, stats: { atk: 1000, maxHp: 10000, def: 0, blockCnt: 2 } });
  }
  /** 炎 6（1 只炎佑）+ 25 层，用这一变体真实的 battleFlags 打一场 */
  const yanyouOf = (flags) => {
    const h = makeBattle({
      defs: { chess, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0, def: 0, res: 0 }) } },
      units: five.map(([id], i) => ({ chessId: id, row: 10, col: 3 + i })),
      bonds: { yanShip: { count: 6, active: true, tier: 2, layers: 25 } },
      flags,
    });
    h.step(1);
    return h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.yanyou);
  };

  const brY = yanyouOf(br.battleFlags);
  const offY = yanyouOf(off.battleFlags);
  assert.ok(brY && offY, '两边都召唤出了炎佑');
  assert.ok(brY.buffs.some((b) => b.key === 'bond:yan'), '大逃杀：25 层，炎佑吃到炎的层数增益');
  assert.equal(offY.buffs.some((b) => b.key === 'bond:yan'), false, '官方：炎佑没有这条增益，保持上游行为');
  assert.ok(brY.s.atk > offY.s.atk, `大逃杀炎佑攻击力更高（${brY.s.atk} > ${offY.s.atk}）`);
});