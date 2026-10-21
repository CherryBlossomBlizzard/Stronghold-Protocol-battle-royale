// test/match/party-gulag.test.js — 《神人派对》古拉格的硬规则（设计稿 §9–§10 + 用户「必须遵循的规则」）。
// 重点：D20 二十面骰、恰好等于 6 才触发、第六回合已触发则第八回合不再掷、暴动后永久关闭、返场幂等。

import test from 'node:test';
import assert from 'node:assert/strict';
import { Gulag, d20Source } from '../../server/match/party/gulag.js';
import { GULAG, INMATE_STATE, normalizePartyConfig } from '../../shared/partyRules.js';

/** 一个可控的骰子：按顺序吐出给定的点数（1..20）。 */
function scripted(...faces) {
  let i = 0;
  return {
    calls: 0,
    next(sides) {
      assert.equal(sides, 20, '骰子必须是二十面的');
      const f = faces[i++];
      this.calls = i;
      if (f == null) throw new Error('scripted dice exhausted');
      return f;
    },
  };
}

function makeGulag(faces = [], cfgOverrides = {}) {
  const cfg = normalizePartyConfig(cfgOverrides);
  const rng = scripted(...faces);
  const events = [];
  const g = new Gulag({ cfg, rng, onEvent: (e) => events.push(e) });
  return { g, rng, events, cfg };
}

test('二十面骰：d20Source 只产出 1..20 的整数，且上界可达', () => {
  const src = d20Source(() => 0.9999999);
  assert.equal(src.next(20), 20);
  const src2 = d20Source(() => 0);
  assert.equal(src2.next(20), 1);
  for (let i = 0; i < 500; i++) {
    const v = d20Source(Math.random).next(20);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 20, `out of range: ${v}`);
  }
});

test('第六回合：只有恰好掷出 6 才触发暴动（1、5、7、20 都不触发）', () => {
  for (const face of [1, 5, 7, 20]) {
    const { g, events } = makeGulag([face]);
    g.beginRound(6);
    const rolls = events.filter((e) => e.type === 'gulag.roll');
    assert.equal(rolls.length, 1, `face ${face} should roll once`);
    assert.equal(rolls[0].roll, face);
    assert.equal(rolls[0].sides, 20);
    assert.equal(rolls[0].triggered, false, `face ${face} must not trigger`);
    assert.equal(g.riotTriggered, false);
  }
});

test('第六回合恰好掷出 6：触发暴动，古拉格永久关闭', () => {
  const { g, events } = makeGulag([6]);
  g.beginRound(6);
  assert.equal(g.riotTriggered, true);
  assert.equal(g.permanentlyClosed, true);
  assert.equal(g.state, GULAG.PERMANENTLY_CLOSED);
  assert.ok(events.some((e) => e.type === 'gulag.riot'));
});

test('不能用 >=6 代替 ==6：掷出 6 以上不触发', () => {
  for (const face of [7, 8, 12, 19, 20]) {
    const { g } = makeGulag([face]);
    g.beginRound(6);
    assert.equal(g.riotTriggered, false, `face ${face} must not trigger`);
  }
});

test('不能把 D20 写成 D6：掷骰请求的面数必须是 20', () => {
  const { g, rng } = makeGulag([4]);
  g.beginRound(6);
  assert.equal(rng.calls, 1); // scripted() 内部断言 sides === 20
  assert.equal(g.rolls[0].sides, 20);
});

test('第 6 回合没触发，且古拉格仍开放：第 8 回合小游戏开始前再掷一次', () => {
  const { g, events } = makeGulag([2, 6]);
  g.beginRound(6);
  assert.equal(g.riotTriggered, false);
  g.beginRound(8);
  const rolls = events.filter((e) => e.type === 'gulag.roll');
  assert.equal(rolls.length, 2, '两次检定');
  assert.equal(rolls[0].when, 'FIRST');
  assert.equal(rolls[1].when, 'SECOND');
  assert.equal(rolls[1].roll, 6);
  assert.equal(g.riotTriggered, true, '第二次掷出 6 同样触发');
});

test('第 8 回合的第二次掷骰只有恰好 6 才触发', () => {
  for (const face of [1, 5, 7, 20]) {
    const { g } = makeGulag([3, face]);
    g.beginRound(6);
    g.beginRound(8);
    assert.equal(g.rolls.length, 2);
    assert.equal(g.riotTriggered, false, `second face ${face} must not trigger`);
  }
});

test('第 6 回合已触发暴动时，第 8 回合不再掷骰', () => {
  const { g, events } = makeGulag([6]);
  g.beginRound(6);
  assert.equal(g.riotTriggered, true);
  g.beginRound(8); // 骰子已耗尽；若再掷会抛错
  assert.equal(events.filter((e) => e.type === 'gulag.roll').length, 1, '总共只掷一次');
  assert.equal(g.rolls.length, 1);
});

test('同一回合不会重复掷骰（幂等）', () => {
  const { g, rng } = makeGulag([2]);
  g.beginRound(6);
  g.beginRound(6);
  assert.equal(rng.calls, 1);
});

test('第 8 回合正常开放古拉格；开放前不受理挑战', () => {
  const { g } = makeGulag([2, 3]);
  g.jail('p1', 3);
  assert.equal(g.state, GULAG.CLOSED_BEFORE);
  assert.equal(g.canChallenge('p1'), false, '没开放时不能挑战');
  g.beginRound(6);
  assert.equal(g.canChallenge('p1'), false, '第六回合仍未开放');
  g.beginRound(8);
  assert.equal(g.everOpened, true);
  assert.equal(g.state, GULAG.OPEN);
  assert.equal(g.canChallenge('p1'), true);
});

test('挑战成功 → 待返场；下一次主战场结算才返场，且只返回一次', () => {
  const { g } = makeGulag([2, 3]);
  g.beginRound(6);
  g.beginRound(8);
  g.jail('p1', 8);
  assert.equal(g.startChallenge('p1', 8, 5).ok, true);
  const res = g.submitChallenge('p1', { won: true }, 8);
  assert.equal(res.ok, true);
  assert.equal(res.awaitingReturn, true);
  assert.equal(g.record('p1').state, INMATE_STATE.AWAITING_RETURN);
  // 结算前不返场
  assert.deepEqual(g.pendingReturn().map((r) => r.playerId), ['p1']);
  const drained = g.drainReturns(8);
  assert.deepEqual(drained, ['p1']);
  assert.equal(g.record('p1').state, INMATE_STATE.RETURNED);
  // 重复结算不会重复返场
  assert.deepEqual(g.drainReturns(8), []);
  assert.deepEqual(g.drainReturns(9), []);
});

test('挑战失败消耗资格；每人正常情况下只有一次普通资格', () => {
  const { g } = makeGulag([2, 3]);
  g.beginRound(6); g.beginRound(8);
  g.jail('p1', 8);
  g.startChallenge('p1', 8, 5);
  g.submitChallenge('p1', { won: false }, 8);
  assert.equal(g.record('p1').state, INMATE_STATE.QUALIFIED_USED);
  assert.equal(g.canChallenge('p1'), false, '普通资格已用，不能再挑战');
  const again = g.startChallenge('p1', 8, 5);
  assert.equal(again.ok, false);
});

test('额外挑战机会：队友付费不直接复活，受益者仍须本人挑战并获胜', () => {
  const { g } = makeGulag([2, 3]);
  g.beginRound(6); g.beginRound(8);
  g.jail('p1', 8);
  g.startChallenge('p1', 8, 5);
  g.submitChallenge('p1', { won: false }, 8);
  // 付了钱，但人还在押、还不能挑战到赢为止
  const can = g.canSponsor('p2', 'p1', 9);
  assert.equal(can.ok, true);
  assert.equal(can.cost, 3, '测试值：3 张调度券');
  g.applySponsorship('p2', 'p1', 9, 123);
  assert.equal(g.record('p1').state, INMATE_STATE.QUALIFIED_USED, '资助不改变在押状态');
  assert.equal(g.canChallenge('p1'), true, '有额外机会了，可以再挑战');
  assert.equal(g.record('p1').extraChances, 1);
  // 仍然要本人挑战并获胜
  g.startChallenge('p1', 9, 5);
  const win = g.submitChallenge('p1', { won: true }, 9);
  assert.equal(win.awaitingReturn, true);
  assert.deepEqual(g.drainReturns(9), ['p1']);
  // 资助记录留档
  assert.equal(g.sponsorships.length, 1);
  assert.equal(g.sponsorships[0].payerId, 'p2');
  assert.equal(g.sponsorships[0].cost, 3);
});

test('额外挑战机会每名玩家整局最多被资助一次；不能自我资助', () => {
  const { g } = makeGulag([2, 3]);
  g.beginRound(6); g.beginRound(8);
  g.jail('p1', 8);
  assert.equal(g.canSponsor('p1', 'p1', 8).reason, 'self');
  g.applySponsorship('p2', 'p1', 8);
  assert.equal(g.canSponsor('p3', 'p1', 8).ok, false);
  assert.equal(g.canSponsor('p3', 'p1', 8).reason, 'already-sponsored');
});

test('暴动触发：所有在押者立即获释，挑战取消，下一次结算返场，古拉格永久关闭', () => {
  const { g, events } = makeGulag([2, 6]);
  g.beginRound(6);
  g.jail('p1', 3);
  g.jail('p2', 4);
  g.beginRound(8); // 第二次掷出 6 → 暴动
  assert.equal(g.riotTriggered, true);
  assert.equal(g.permanentlyClosed, true);
  for (const id of ['p1', 'p2']) {
    assert.equal(g.record(id).state, INMATE_STATE.RELEASED, `${id} 应立即获释`);
  }
  const riot = events.find((e) => e.type === 'gulag.riot');
  assert.deepEqual(riot.released.slice().sort(), ['p1', 'p2']);
  // 立即释放 ≠ 立即返场：仍在下一次主战场结算处理
  assert.deepEqual(g.drainReturns(8).slice().sort(), ['p1', 'p2']);
  assert.deepEqual(g.drainReturns(8), [], '不重复返场');
});

test('暴动后：不再收新囚犯、不能购买或使用新的额外挑战机会、不能挑战', () => {
  const { g } = makeGulag([6]);
  g.beginRound(6);
  assert.equal(g.permanentlyClosed, true);
  const jailRes = g.jail('p9', 7);
  assert.equal(jailRes.jailed, false);
  assert.equal(g.canChallenge('p9'), false);
  assert.equal(g.canSponsor('p1', 'p2', 7).reason, 'gulag-closed');
  g.beginRound(8); // 不再掷骰、不再开放
  assert.equal(g.state, GULAG.PERMANENTLY_CLOSED);
  assert.equal(g.rolls.length, 1);
});

test('暴动优先于挑战完成：已经赢了的人不会因为暴动获得第二份返场', () => {
  const { g } = makeGulag([2, 3]); // 两次检定都不触发，暴动由测试手动制造
  g.beginRound(6);
  g.beginRound(8);
  g.jail('p1', 8);
  g.startChallenge('p1', 8, 5);
  g.submitChallenge('p1', { won: true }, 8); // 先赢，进入待返场
  // 人为制造同一回合的暴动
  g._riot(8);
  assert.equal(g.record('p1').state, INMATE_STATE.AWAITING_RETURN, '仍是待返场，不是二次释放');
  assert.deepEqual(g.drainReturns(8), ['p1']);
  assert.deepEqual(g.drainReturns(8), []);
});

test('同一玩家重复入狱请求是幂等的，且不会重置资格', () => {
  const { g } = makeGulag([2, 3]);
  g.beginRound(6); g.beginRound(8);
  g.jail('p1', 8);
  g.jail('p1', 8);
  assert.equal(g.records.size, 1);
  assert.equal(g.record('p1').chancesUsed, 0);
});

test('非法状态迁移被拒绝（不能从待返场直接再获释）', () => {
  const { g } = makeGulag([2, 3]);
  g.beginRound(6); g.beginRound(8);
  g.jail('p1', 8);
  g.startChallenge('p1', 8, 5);
  g.submitChallenge('p1', { won: true }, 8);
  const r = g.record('p1');
  r.state = INMATE_STATE.AWAITING_RETURN;
  assert.equal(g._setState(r, INMATE_STATE.CHALLENGING), false);
});

test('额外挑战机会的价格是可配置项（房间设置），默认 3', () => {
  const cfgDefault = normalizePartyConfig();
  assert.equal(cfgDefault.gulag.extraChanceCost, 3);
  const cfgCustom = normalizePartyConfig({ extraChanceCost: 5 });
  assert.equal(cfgCustom.gulag.extraChanceCost, 5);
  // 非法值被丢弃，回落到默认
  assert.equal(normalizePartyConfig({ extraChanceCost: 0 }).gulag.extraChanceCost, 3);
  assert.equal(normalizePartyConfig({ extraChanceCost: 999 }).gulag.extraChanceCost, 3);
  assert.equal(normalizePartyConfig({ extraChanceCost: 'much' }).gulag.extraChanceCost, 3);
});

test('公开视图不含秘密信息，只含古拉格自身的公开状态', () => {
  const { g } = makeGulag([2, 3]);
  g.beginRound(6); g.beginRound(8);
  g.jail('p1', 8);
  const v = g.view();
  assert.equal(v.state, GULAG.OPEN);
  assert.equal(v.openRound, 8);
  assert.equal(v.cost, 3);
  assert.equal(v.rolls.length, 2);
  assert.ok(Array.isArray(v.inmates));
  const s = JSON.stringify(v);
  // 不允许出现任何"身份/任务"字样的字段
  assert.ok(!/faction|objective|secret/i.test(s), '古拉格视图不得泄漏身份或任务信息');
});

test('第二回合检定不会在第六回合已经没触发之前提前掷骰', () => {
  const { g, rng } = makeGulag([2, 3]);
  for (let r = 1; r <= 5; r++) g.beginRound(r);
  assert.equal(rng.calls, 0, '1–5 回合不掷骰');
});
