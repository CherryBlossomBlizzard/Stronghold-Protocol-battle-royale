// shared/partyCards.js — 《神人派对》的卡牌与秘密任务定义（服务端与浏览器共用）。
//
// 卡牌来自设计稿表 8（互坑整活 8 张）、表 9（派对挑战 6 张）、表 10（社交推理 6 张）、表 11（反制 4 张），
// 共 24 张基础卡池。数值都是【测试值】。
//
// 卡牌定义只描述「数据」；效果由服务端 server/match/party/cards.js 执行，客户端只读定义做展示。
// 服务端永远按 cardId 查自己的表，绝不执行客户端发来的效果。

import { FACTION } from './partyRules.js';

/** 卡牌类别（设计稿 §6）。 */
export const CARD_KIND = Object.freeze({
  PRANK: 'PRANK',           // 互坑整活
  PARTY: 'PARTY',           // 派对挑战
  SOCIAL: 'SOCIAL',         // 社交推理
  COUNTER: 'COUNTER',       // 反制
});

/** 目标类型：谁能被这张卡选中。 */
export const CARD_TARGET = Object.freeze({
  NONE: 'NONE',           // 无目标（全局）
  PLAYER: 'PLAYER',       // 其他玩家
  SELF: 'SELF',           // 只对自己
  CHALLENGE: 'CHALLENGE', // 本轮挑战卡的目标玩家
});

/** 响应窗口：这张卡能否在「响应与反制」阶段被回应（设计稿 §3 建议优先级里「防护/反制」最先）。 */
export const CARD_TIMING = Object.freeze({
  SECRET: 'SECRET',   // 秘密行动阶段提交
  RESPONSE: 'RESPONSE', // 只在响应阶段可用
});

/**
 * @typedef {object} CardDef
 * @property {string} id
 * @property {string} kind            CARD_KIND
 * @property {string} name           中文名（也是 msgid）
 * @property {string} text           效果说明（msgid）
 * @property {object} cost           { tickets, intel, influence }
 * @property {number} rarity         1 普通 / 2 稀有 / 3 史诗
 * @property {string} target         CARD_TARGET
 * @property {string} timing         CARD_TIMING
 * @property {boolean} highRisk      是否计入「同一目标每轮 1 次高风险」的限制
 * @property {number} copies         卡池里的份数（市场供给）
 * @property {string} effect         效果 id（server/match/party/cards.js 的 EFFECTS）
 * @property {object} [params]       效果参数
 * @property {number} [perGameLimit] 每名玩家整局可用次数
 * @property {number} [perRoundLimit] 每名玩家每轮可用次数
 * @property {string[]} [factions]   仅这些阵营可获得（空 = 所有阵营）
 */

/** @type {Record<string, CardDef>} */
export const CARDS = Object.freeze({
  // ── 6.1 互坑整活（8 张，表 8）────────────────────────────────────────────────────────
  prank_supply_blunder: {
    id: 'prank_supply_blunder', kind: CARD_KIND.PRANK, name: '军需乌龙',
    text: '减少目标下一轮获得的 1 张调度券，并留下补给异常日志。',
    cost: { tickets: 2, intel: 0, influence: 0 }, rarity: 1, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 2,
    effect: 'stripIncome', params: { resource: 'tickets', amount: 1 }, trace: 'supply',
  },
  prank_meeting_derail: {
    id: 'prank_meeting_derail', kind: CARD_KIND.PRANK, name: '会议跑题',
    text: '提出一项荒诞公共议案，若通过则获得情报点。',
    cost: { tickets: 1, intel: 0, influence: 0 }, rarity: 1, target: CARD_TARGET.NONE,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 2,
    effect: 'motion', params: { gainIntel: 2 }, perGameLimit: 1, trace: 'motion',
  },
  prank_false_alarm: {
    id: 'prank_false_alarm', kind: CARD_KIND.PRANK, name: '假警报',
    text: '给目标制造模糊线索并提高嫌疑度。',
    cost: { tickets: 2, intel: 0, influence: 0 }, rarity: 1, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 2,
    effect: 'falseClue', params: { suspicion: 2 }, trace: 'fake',
  },
  prank_shift_swap: {
    id: 'prank_shift_swap', kind: CARD_KIND.PRANK, name: '临时换班',
    text: '与另一名玩家交换本轮一个可选秘密行动目标。',
    cost: { tickets: 2, intel: 1, influence: 0 }, rarity: 2, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 1,
    effect: 'swapTarget', trace: 'swap',
  },
  prank_supply_lottery: {
    id: 'prank_supply_lottery', kind: CARD_KIND.PRANK, name: '补给抽签',
    text: '两名自愿玩家各押资源，随机决定奖池归属。',
    cost: { tickets: 1, intel: 0, influence: 0 }, rarity: 2, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 1,
    effect: 'lottery', params: { stake: 2 }, perGameLimit: 1, trace: 'lottery',
  },
  prank_everyone_reverse: {
    id: 'prank_everyone_reverse', kind: CARD_KIND.PRANK, name: '全员反着来',
    text: '发起短时公共选择，多数派若选错则少数派获得功绩。',
    cost: { tickets: 2, intel: 0, influence: 0 }, rarity: 2, target: CARD_TARGET.NONE,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 1,
    effect: 'reverseVote', params: { merit: 4 }, trace: 'vote',
  },
  prank_bounty_board: {
    id: 'prank_bounty_board', kind: CARD_KIND.PRANK, name: '乌龙悬赏',
    text: '给一名玩家挂上公开悬赏，完成指定调查者领取奖励。',
    cost: { tickets: 2, intel: 0, influence: 1 }, rarity: 2, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: true, copies: 1,
    effect: 'bounty', params: { merit: 6, intel: 1 }, trace: 'bounty',
  },
  prank_pot_from_sky: {
    id: 'prank_pot_from_sky', kind: CARD_KIND.PRANK, name: '锅从天降',
    text: '把一条未验证的负面线索转交给另一名玩家持有。',
    cost: { tickets: 2, intel: 1, influence: 0 }, rarity: 2, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: true, copies: 1,
    effect: 'transferBlame', params: { suspicion: 3 }, trace: 'blame', perRoundLimit: 1,
  },

  // ── 6.2 派对挑战（6 张，表 9）────────────────────────────────────────────────────────
  party_ten_second_council: {
    id: 'party_ten_second_council', kind: CARD_KIND.PARTY, name: '十秒军议',
    text: '全员限时投票选择支援路线。',
    cost: { tickets: 3, intel: 0, influence: 1 }, rarity: 2, target: CARD_TARGET.NONE,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 1,
    effect: 'councilSupport', params: { guardMerit: 5, intelMinority: 1 }, trace: 'council',
  },
  party_most_suspicious: {
    id: 'party_most_suspicious', kind: CARD_KIND.PARTY, name: '谁最可疑？',
    text: '匿名投票选出本轮最可疑玩家。',
    cost: { tickets: 2, intel: 1, influence: 0 }, rarity: 2, target: CARD_TARGET.NONE,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 1,
    effect: 'suspicionVote', params: { revealClueKind: 'category' }, trace: 'suspect',
  },
  party_supply_auction: {
    id: 'party_supply_auction', kind: CARD_KIND.PARTY, name: '军需拍卖会',
    text: '玩家秘密出价争夺一次性战术牌。',
    cost: { tickets: 2, intel: 0, influence: 0 }, rarity: 2, target: CARD_TARGET.NONE,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 1,
    effect: 'miniAuction', params: { prize: 'party_blind_support' }, trace: 'auction',
  },
  party_blind_support: {
    id: 'party_blind_support', kind: CARD_KIND.PARTY, name: '盲选支援',
    text: '选择保守或激进方案。',
    cost: { tickets: 1, intel: 0, influence: 0 }, rarity: 1, target: CARD_TARGET.SELF,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 2,
    effect: 'blindSupport', params: { meritSafe: 3, meritRisky: 7, failCost: 1 }, trace: 'support',
    noMarket: true, // 只能通过军需拍卖会等途径获得
  },
  party_no_same_tile: {
    id: 'party_no_same_tile', kind: CARD_KIND.PARTY, name: '别踩同一格',
    text: '玩家提交不同的支援类别，重复最多的类别不生效。',
    cost: { tickets: 2, intel: 1, influence: 0 }, rarity: 2, target: CARD_TARGET.NONE,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 1,
    effect: 'distinctSupport', params: { merit: 4 }, trace: 'distinct', perRoundLimit: 1,
  },
  party_shared_blame: {
    id: 'party_shared_blame', kind: CARD_KIND.PARTY, name: '全队背锅？',
    text: '投票决定是否共同支付小额成本换取团队增益。',
    cost: { tickets: 2, intel: 0, influence: 1 }, rarity: 2, target: CARD_TARGET.NONE,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 1,
    effect: 'sharedBlame', params: { cost: 1, teamGuard: 1 }, trace: 'blameTeam',
  },

  // ── 6.3 社交推理（6 张，表 10）──────────────────────────────────────────────────────
  social_wiretap: {
    id: 'social_wiretap', kind: CARD_KIND.SOCIAL, name: '暗线监听',
    text: '查看目标本轮是否执行过裂盟行动，返回是/否/无法确认。',
    cost: { tickets: 2, intel: 1, influence: 0 }, rarity: 2, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 2,
    effect: 'checkSplitAction', trace: 'wiretap',
  },
  social_evidence_chain: {
    id: 'social_evidence_chain', kind: CARD_KIND.SOCIAL, name: '证据链',
    text: '交叉验证两条线索，一致则提升可信度。',
    cost: { tickets: 1, intel: 2, influence: 0 }, rarity: 2, target: CARD_TARGET.SELF,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 2,
    effect: 'verifyClues', trace: 'evidence',
  },
  social_public_account: {
    id: 'social_public_account', kind: CARD_KIND.SOCIAL, name: '公开质询',
    text: '询问目标是否执行过 PvP、交易或整活行动。',
    cost: { tickets: 1, intel: 1, influence: 1 }, rarity: 1, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 2,
    effect: 'queryAction', params: { refuseSuspicion: 2 }, trace: 'account',
  },
  social_anonymous_tip: {
    id: 'social_anonymous_tip', kind: CARD_KIND.SOCIAL, name: '匿名告密',
    text: '提交一条经系统验证的行动事实并隐藏举报者。',
    cost: { tickets: 1, intel: 2, influence: 0 }, rarity: 3, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 1,
    effect: 'anonymousTip', perGameLimit: 1, trace: 'tip',
  },
  social_double_deal: {
    id: 'social_double_deal', kind: CARD_KIND.SOCIAL, name: '双面交易',
    text: '双方各付资源，交换一条线索或非任务专属情报。',
    cost: { tickets: 1, intel: 1, influence: 0 }, rarity: 2, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: false, copies: 2,
    effect: 'clueSwap', trace: 'deal',
  },
  social_ultimatum: {
    id: 'social_ultimatum', kind: CARD_KIND.SOCIAL, name: '最后通牒',
    text: '目标选择支付资源或接受一次公开调查。',
    cost: { tickets: 2, intel: 1, influence: 1 }, rarity: 3, target: CARD_TARGET.PLAYER,
    timing: CARD_TIMING.SECRET, highRisk: true, copies: 1,
    effect: 'ultimatum', params: { toll: 2 }, trace: 'ultimatum',
  },

  // ── 6.4 反制（4 张，表 11）──────────────────────────────────────────────────────────
  counter_expose: {
    id: 'counter_expose', kind: CARD_KIND.COUNTER, name: '当场拆穿',
    text: '抵消伪造证据或假警报，并公开施卡者的行动类别。',
    cost: { tickets: 1, intel: 1, influence: 0 }, rarity: 2, target: CARD_TARGET.CHALLENGE,
    timing: CARD_TIMING.RESPONSE, highRisk: false, copies: 2,
    effect: 'cancelFake', params: { revealCategory: true }, perRoundLimit: 1, trace: 'expose',
  },
  counter_refuse_swap: {
    id: 'counter_refuse_swap', kind: CARD_KIND.COUNTER, name: '拒绝换班',
    text: '取消针对自己的目标替换效果。',
    cost: { tickets: 1, intel: 0, influence: 0 }, rarity: 1, target: CARD_TARGET.SELF,
    timing: CARD_TIMING.RESPONSE, highRisk: false, copies: 2,
    effect: 'cancelSwap', perRoundLimit: 1, trace: 'refuse',
  },
  counter_emergency_audit: {
    id: 'counter_emergency_audit', kind: CARD_KIND.COUNTER, name: '紧急审计',
    text: '取消一次资源转移或破坏，并留下可调查记录。',
    cost: { tickets: 0, intel: 1, influence: 1 }, rarity: 2, target: CARD_TARGET.CHALLENGE,
    timing: CARD_TIMING.RESPONSE, highRisk: false, copies: 2,
    effect: 'cancelTransfer', perRoundLimit: 1, trace: 'audit',
  },
  counter_hold_line: {
    id: 'counter_hold_line', kind: CARD_KIND.COUNTER, name: '稳住阵线',
    text: '抵消影响本轮战役支援的小型负面效果。',
    cost: { tickets: 1, intel: 0, influence: 1 }, rarity: 1, target: CARD_TARGET.CHALLENGE,
    timing: CARD_TIMING.RESPONSE, highRisk: false, copies: 2,
    effect: 'cancelCampaignMalus', perRoundLimit: 1, trace: 'hold',
  },
});

/** 市场可出现的卡（反制卡也进市场，挑战类的一次性战术牌不进）。 */
export const MARKET_CARD_IDS = Object.freeze(Object.values(CARDS)
  .filter((c) => !c.noMarket && c.target !== CARD_TARGET.NO_OP)
  .map((c) => c.id));

/** 开局牌组构成（设计稿表 6：12 张，由基础卡、反制卡和少量身份/任务卡构成）。 */
export const STARTER_DECK = Object.freeze([
  'prank_supply_blunder', 'prank_supply_blunder',
  'prank_false_alarm',
  'social_public_account', 'social_public_account',
  'social_wiretap',
  'party_blind_support', 'party_blind_support',
  'counter_refuse_swap', 'counter_refuse_swap',
  'counter_hold_line',
  'counter_emergency_audit',
]);

/** 按 id 取卡牌定义；未知 id 返回 null（服务端据此拒绝）。 */
export function cardDef(id) {
  return Object.prototype.hasOwnProperty.call(CARDS, id) ? CARDS[id] : null;
}

/** 该阵营能否获得这张卡（裂盟派专属卡用 factions 限定）。 */
export function cardAvailableTo(def, faction) {
  if (!def) return false;
  if (Array.isArray(def.factions) && def.factions.length) return def.factions.includes(faction);
  return true;
}

// ── 秘密任务（设计稿 §2.3）───────────────────────────────────────────────────────────────
// 目标类别：后勤派（保留资源）、强攻派（完成高难战役）、谋略派（触发特殊条件）、荣誉派（关键行动）。
export const OBJECTIVE_KIND = Object.freeze({
  LOGISTICS: 'LOGISTICS',
  ASSAULT: 'ASSAULT',
  SCHEME: 'SCHEME',
  HONOR: 'HONOR',
});

/**
 * @typedef {object} ObjectiveDef
 * @property {string} id
 * @property {string} kind
 * @property {string} name
 * @property {string} text
 * @property {FACTION[]} factions  可抽到这个任务的阵营（空 = 全部）
 * @property {number} points       完成得分上限内的值（<= score.maximums.secret）
 * @property {string} check        进度检查 id（server/match/party/score.js）
 * @property {object} [params]
 */

/** @type {Record<string, ObjectiveDef>} */
export const OBJECTIVES = Object.freeze({
  // 后勤派
  obj_hoard_tickets: {
    id: 'obj_hoard_tickets', kind: OBJECTIVE_KIND.LOGISTICS, name: '囤积调度券',
    text: '对局结束时持有至少 8 张调度券。', factions: [], points: 18,
    check: 'endTicketsAtLeast', params: { amount: 8 },
  },
  obj_no_bankrupt: {
    id: 'obj_no_bankrupt', kind: OBJECTIVE_KIND.LOGISTICS, name: '账面清白',
    text: '整局结束时情报点不少于 3，且从未被紧急审计。', factions: [], points: 15,
    check: 'intelAtLeast', params: { amount: 3 },
  },
  // 强攻派
  obj_campaign_glory: {
    id: 'obj_campaign_glory', kind: OBJECTIVE_KIND.ASSAULT, name: '战役主力',
    text: '本局造成或承受的战役压力达到全队前列（贡献分前 40%）。', factions: [], points: 20,
    check: 'campaignTopFraction', params: { fraction: 0.4 },
  },
  obj_perfect_rounds: {
    id: 'obj_perfect_rounds', kind: OBJECTIVE_KIND.ASSAULT, name: '滴水不漏',
    text: '累计完成至少 3 个无漏怪回合。', factions: [], points: 16,
    check: 'perfectRoundsAtLeast', params: { amount: 3 },
  },
  // 谋略派
  obj_play_the_prank: {
    id: 'obj_play_the_prank', kind: OBJECTIVE_KIND.SCHEME, name: '整活专家',
    text: '成功打出至少 3 张整活卡。', factions: [], points: 15,
    check: 'pranksPlayedAtLeast', params: { amount: 3 },
  },
  obj_escape_detection: {
    id: 'obj_escape_detection', kind: OBJECTIVE_KIND.SCHEME, name: '瞒天过海',
    text: '本局结束时嫌疑度不超过 2。', factions: [FACTION.SPLIT, FACTION.OPPORTUNIST], points: 20,
    check: 'suspicionAtMost', params: { amount: 2 },
  },
  obj_unmask_one: {
    id: 'obj_unmask_one', kind: OBJECTIVE_KIND.SCHEME, name: '抓出内鬼',
    text: '至少一次成功指认一名裂盟派（调查/线索指认被证实）。', factions: [FACTION.LOYAL], points: 18,
    check: 'correctAccusationsAtLeast', params: { amount: 1 },
  },
  // 荣誉派
  obj_rescue_ally: {
    id: 'obj_rescue_ally', kind: OBJECTIVE_KIND.HONOR, name: '救援之手',
    text: '至少为一名队友资助过一次古拉格额外挑战机会。', factions: [], points: 15,
    check: 'sponsoredExtraAtLeast', params: { amount: 1 },
  },
  obj_survive: {
    id: 'obj_survive', kind: OBJECTIVE_KIND.HONOR, name: '坚持到底',
    text: '本局从未被淘汰进入古拉格，或从古拉格成功返场。', factions: [], points: 12,
    check: 'neverJailedOrReturned', params: {},
  },
  obj_trade_master: {
    id: 'obj_trade_master', kind: OBJECTIVE_KIND.HONOR, name: '谈判高手',
    text: '完成至少 2 笔与其他玩家的交易。', factions: [], points: 12,
    check: 'tradesAtLeast', params: { amount: 2 },
  },
  // 裂盟派专属
  obj_sabotage_campaign: {
    id: 'obj_sabotage_campaign', kind: OBJECTIVE_KIND.SCHEME, name: '渗透破坏',
    text: '本局成功执行至少 2 次裂盟破坏行动。', factions: [FACTION.SPLIT], points: 25,
    check: 'splitActionsAtLeast', params: { amount: 2 },
  },
  obj_coup_plot: {
    id: 'obj_coup_plot', kind: OBJECTIVE_KIND.SCHEME, name: '夺权图谋',
    text: '至少 1 项公共议案获得通过。', factions: [FACTION.SPLIT], points: 22,
    check: 'motionsPassedAtLeast', params: { amount: 1 },
  },
});

/** 个人挑战（低分值，设计稿 §2.3「可选增加一张低分值的个人挑战」）。 */
export const PERSONAL_CHALLENGES = Object.freeze({
  chal_seen_everything: { id: 'chal_seen_everything', name: '眼观六路', text: '本局使用过一次调查类卡牌。', points: 4, check: 'usedInvestigationOnce', params: {} },
  chal_rich_broker: { id: 'chal_rich_broker', name: '消息灵通', text: '本局至少中标过一次密封竞价。', points: 4, check: 'wonSealedAtLeastOnce', params: {} },
  chal_iron_will: { id: 'chal_iron_will', name: '寸土不让', text: '整局从未落入古拉格。', points: 5, check: 'neverJailed', params: {} },
  chal_party_animal: { id: 'chal_party_animal', name: '派对动物', text: '本局至少参与一次派对挑战。', points: 3, check: 'partyChallengeAtLeastOnce', params: {} },
});

/** 按阵营可抽的任务池。 */
export function objectivesFor(faction) {
  return Object.values(OBJECTIVES).filter((o) => !o.factions.length || o.factions.includes(faction));
}

export function objectiveDef(id) {
  return Object.prototype.hasOwnProperty.call(OBJECTIVES, id) ? OBJECTIVES[id] : null;
}

export function challengeDef(id) {
  return Object.prototype.hasOwnProperty.call(PERSONAL_CHALLENGES, id) ? PERSONAL_CHALLENGES[id] : null;
}

export const ALL_OBJECTIVE_IDS = Object.freeze(Object.keys(OBJECTIVES));
export const ALL_CHALLENGE_IDS = Object.freeze(Object.keys(PERSONAL_CHALLENGES));

/** 「裂盟行动」：这些卡的效果 id 会被计为裂盟破坏行动（设计稿「裂盟派：破坏行动」）。 */
export const SPLIT_ACTION_EFFECTS = Object.freeze([
  'stripIncome', 'falseClue', 'transferBlame', 'bounty', 'ultimatum', 'swapTarget',
]);

/** 调查类卡（用于个人挑战与线索分类）。 */
export const INVESTIGATION_CARDS = Object.freeze([
  'social_wiretap', 'social_evidence_chain', 'social_public_account', 'social_anonymous_tip',
]);
