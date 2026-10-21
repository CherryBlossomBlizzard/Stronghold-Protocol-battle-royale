// test/ui/party-ui.test.js — 《神人派对》前端纯逻辑（public/js/ui/party/partyLogic.js）单测。
// 不需要浏览器：只验证面板选择、手牌/市场整理与设置校验。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  partyViewState, handRows, marketRows, gulagPanel, otherPlayers, secondsLeft,
  partySettingsPayload, validatePartySettings, isPartyMatch, PHASE_LABEL, FACTION_NAME,
} from '../../public/js/ui/party/partyLogic.js';
import { PARTY_PHASE, GULAG, INMATE_STATE, FACTION } from '../../shared/partyRules.js';
import { CARDS } from '../../shared/partyCards.js';

const pub = (phase, extra = {}) => ({ t: 'm.party', phase, round: 1, players: [], market: { slots: [] }, gulag: { state: GULAG.CLOSED_BEFORE, rolls: [], inmates: [] }, log: [], ...extra });

test('面板选择：每种阶段映射到正确的面板', () => {
  assert.equal(partyViewState({}, null).kind, 'none');
  assert.equal(partyViewState({}, { party: { partyMode: true } }).kind, 'waiting');
  assert.equal(partyViewState({ party: pub(PARTY_PHASE.BRIEFING) }, null).kind, 'briefing');
  assert.equal(partyViewState({ party: pub(PARTY_PHASE.MARKET) }, null).kind, 'market');
  assert.equal(partyViewState({ party: pub(PARTY_PHASE.TRADE) }, null).kind, 'trade');
  assert.equal(partyViewState({ party: pub(PARTY_PHASE.SECRET) }, null).kind, 'secret');
  assert.equal(partyViewState({ party: pub(PARTY_PHASE.RESPONSE) }, null).kind, 'response');
  assert.equal(partyViewState({ party: pub(PARTY_PHASE.GULAG) }, null).kind, 'gulag');
  assert.equal(partyViewState({ party: pub('PARTY_COMBAT') }, null).kind, 'report');
  assert.equal(partyViewState({ party: pub(PARTY_PHASE.REPORT) }, null).kind, 'report');
  assert.equal(partyViewState({ party: pub(PARTY_PHASE.ENDED) }, null).kind, 'result');
});

test('每个阶段都有中文标签', () => {
  for (const phase of Object.values(PARTY_PHASE)) {
    assert.ok(PHASE_LABEL[phase], `missing label for ${phase}`);
  }
  assert.equal(FACTION_NAME[FACTION.SPLIT], '裂盟派');
});

test('手牌整理：同 id 合并、标出是否买得起、是否在正确阶段', () => {
  const hand = [
    { uid: 'c1', cardId: 'prank_false_alarm' },
    { uid: 'c2', cardId: 'prank_false_alarm' },
    { uid: 'c3', cardId: 'counter_refuse_swap' },
    { uid: 'c4', cardId: 'not_a_card' },
  ];
  const rows = handRows(hand, { tickets: 1, intel: 0, influence: 0 }, PARTY_PHASE.SECRET);
  assert.equal(rows.length, 2, 'unknown cards dropped, duplicates merged');
  const prank = rows.find((r) => r.cardId === 'prank_false_alarm');
  assert.equal(prank.count, 2);
  assert.equal(prank.playable, false, '1 ticket is not enough for a 2-ticket card');
  const counter = rows.find((r) => r.cardId === 'counter_refuse_swap');
  assert.equal(counter.playable, false, 'counter cards are not playable in the secret phase');
});

test('手牌：资源充足且在秘密阶段时整活卡可打', () => {
  const rows = handRows([{ uid: 'c1', cardId: 'prank_false_alarm' }], { tickets: 9, intel: 9, influence: 9 }, PARTY_PHASE.SECRET);
  assert.equal(rows[0].playable, true);
});

test('市场行：固定价卡与竞价卡的可操作性与限额', () => {
  const market = {
    slots: [
      { slot: 0, cardId: 'prank_supply_blunder', mode: 'fixed', price: 2, stock: 2, sold: 0, remaining: 2, bids: [] },
      { slot: 1, cardId: 'prank_false_alarm', mode: 'fixed', price: 2, stock: 1, sold: 1, remaining: 0, bids: [] },
      { slot: 2, cardId: 'social_wiretap', mode: 'sealed', price: 2, stock: 1, sold: 0, remaining: 1, bids: ['p1'] },
      { slot: 3, cardId: 'social_evidence_chain', mode: 'sealed', price: 1, stock: 1, sold: 0, remaining: 1, bids: [] },
    ],
  };
  const rows = marketRows(market, { fixedLimit: 1, fixedBought: 0, bidSlot: null }, { tickets: 5 });
  assert.equal(rows[0].canBuy, true);
  assert.equal(rows[1].canBuy, false, 'sold out');
  assert.equal(rows[2].canBid, true);
  // 已经买过一张固定卡后
  const rows2 = marketRows(market, { fixedLimit: 1, fixedBought: 1, bidSlot: 3 }, { tickets: 5 });
  assert.equal(rows2[0].canBuy, false, 'fixed limit reached');
  assert.equal(rows2[2].canBid, false, 'already bid on another slot');
});

test('市场行：买不起时不允许购买', () => {
  const market = { slots: [{ slot: 0, cardId: 'prank_supply_blunder', mode: 'fixed', price: 5, stock: 1, sold: 0, remaining: 1, bids: [] }] };
  const rows = marketRows(market, { fixedLimit: 1, fixedBought: 0, bidSlot: null }, { tickets: 1 });
  assert.equal(rows[0].canBuy, false);
});

test('古拉格面板：暴动后永久关闭，所有人都不能再挑战', () => {
  const p = gulagPanel(
    { gulag: { state: GULAG.PERMANENTLY_CLOSED, permanentlyClosed: true, cost: 3, rolls: [{ round: 6, when: 'FIRST', roll: 6, sides: 20, triggered: true }], inmates: [] } },
    { gulag: { me: { state: INMATE_STATE.RELEASED, canChallenge: false } } },
    'p0',
  );
  assert.equal(p.permanentlyClosed, true);
  assert.equal(p.canChallenge, false);
  assert.equal(p.rolls.length, 1);
});

test('古拉格面板：在押且有资格时可挑战，也可被队友资助', () => {
  const p = gulagPanel(
    { gulag: { state: GULAG.OPEN, cost: 3, rolls: [], inmates: [{ playerId: 'p0', state: INMATE_STATE.IN_CUSTODY, canChallenge: true }] } },
    { gulag: { me: { state: INMATE_STATE.IN_CUSTODY, canChallenge: true } } },
    'p0',
  );
  assert.equal(p.canChallenge, true);
  assert.equal(p.canBeSponsored, true);
  assert.equal(p.cost, 3);
});

test('其他玩家列表排除自己', () => {
  const players = [{ playerId: 'p0' }, { playerId: 'p1' }, { playerId: 'p2' }];
  assert.deepEqual(otherPlayers(players, 'p0').map((p) => p.playerId), ['p1', 'p2']);
});

test('倒计时秒数', () => {
  assert.equal(secondsLeft(0), null);
  assert.equal(secondsLeft(null), null);
  assert.equal(secondsLeft(10000, 5000), 5);
  assert.equal(secondsLeft(1000, 5000), 0, 'never negative');
});

test('设置载荷只带改动过的字段', () => {
  assert.deepEqual(partySettingsPayload({ partyMode: true }), { partyMode: true });
  assert.deepEqual(partySettingsPayload({ partyMode: true, splitKnowledge: 'ALL', extraChanceCost: 4 }), {
    partyMode: true, splitKnowledge: 'ALL', extraChanceCost: 4,
  });
});

test('设置校验与服务端规则一致', () => {
  assert.deepEqual(validatePartySettings({ extraChanceCost: 3, rounds: 12, splitKnowledge: 'NONE' }), []);
  assert.equal(validatePartySettings({ extraChanceCost: 0 }).length, 1);
  assert.equal(validatePartySettings({ extraChanceCost: 11 }).length, 1);
  assert.equal(validatePartySettings({ rounds: 3 }).length, 1);
  assert.equal(validatePartySettings({ rounds: 31 }).length, 1);
  assert.equal(validatePartySettings({ splitKnowledge: 'EVERYONE' }).length, 1);
});

test('isPartyMatch 认得派对房间与派对对局', () => {
  assert.equal(isPartyMatch({ party: pub(PARTY_PHASE.MARKET) }, null), true);
  assert.equal(isPartyMatch({}, { party: { partyMode: true }, inMatch: true }), true);
  assert.equal(isPartyMatch({}, { party: null, inMatch: true }), false);
  assert.equal(isPartyMatch({}, null), false);
});

test('卡牌表里的每张卡都有中文名与说明（界面要用）', () => {
  for (const [id, def] of Object.entries(CARDS)) {
    assert.ok(def.name && def.name.length > 0, `${id} needs a name`);
    assert.ok(def.text && def.text.length > 0, `${id} needs a description`);
  }
});
