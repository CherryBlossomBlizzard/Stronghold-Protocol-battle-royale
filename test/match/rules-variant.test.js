import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { getData } from '../../server/data.js';

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
});

test('规则变体：真实对局里两边的开局数值', () => {
  const h1 = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 71 }).start();
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