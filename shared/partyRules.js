// shared/partyRules.js — 《卫戍协议·神人派对》的规则常量与配置（服务端与浏览器共用）。
//
// 设计依据：docs/development/design-full.txt / design-tables.txt（《神人派对设计方案》讨论稿）与
// docs/PARTY_MODE.md（本仓库的实现决定记录）。讨论稿没拍板的数值在这里标 【测试值】，改这一个文件就能调整。
//
// 本模式**不改动** PvE 战斗核心：战斗仍由 server/sim/ 按原有规则跑，派对模块只拦截「主战场结算」
// 这一个时点（领取漏怪扣血前后的生命值），用于古拉格的入狱判定与返场。

/** 古拉格状态（设计稿 §13「至少应区分」）。 */
export const GULAG = Object.freeze({
  CLOSED_BEFORE: 'CLOSED_BEFORE', // 还没到开放回合，或本局暴动后已关闭（见 permanentlyClosed）
  OPEN: 'OPEN',                   // 开放，可挑战
  CHALLENGING: 'CHALLENGING',     // 本回合小游戏进行中
  AWAITING_RETURN: 'AWAITING_RETURN', // 已有玩家待返场
  PERMANENTLY_CLOSED: 'PERMANENTLY_CLOSED', // 暴动后永久关闭
});

/** 玩家在古拉格维度的状态（设计稿 §13）。 */
export const INMATE_STATE = Object.freeze({
  NONE: 'NONE',                     // 从未入狱
  IN_CUSTODY: 'IN_CUSTODY',         // 在押，持有普通挑战资格
  CHALLENGING: 'CHALLENGING',       // 正在参加小游戏
  QUALIFIED_USED: 'QUALIFIED_USED', // 资格已用（普通），仍可能靠额外机会
  AWAITING_RETURN: 'AWAITING_RETURN', // 挑战成功，等下一次主战场结算返场
  RELEASED: 'RELEASED',             // 暴动释放，等下一次主战场结算返场
  RETURNED: 'RETURNED',             // 已返场
});

/** 阵营（设计稿表 3）。 */
export const FACTION = Object.freeze({
  LOYAL: 'LOYAL',                 // 忠诚派
  SPLIT: 'SPLIT',                 // 裂盟派
  OPPORTUNIST: 'OPPORTUNIST',     // 投机派
});

/** 裂盟派互认设置（设计稿 §2.2，房主开局前选择）。 */
export const SPLIT_KNOWLEDGE = Object.freeze({
  ALL: 'ALL',         // 选项 A：全部互认
  PARTIAL: 'PARTIAL', // 选项 B：部分互认（只知道指定队友）
  NONE: 'NONE',       // 选项 C：完全不互认
});

/** 本模式各阶段的阶段名（挂在 PHASE 之外，由 PartyMatch 自己维护）。 */
export const PARTY_PHASE = Object.freeze({
  BRIEFING: 'PARTY_BRIEFING',     // 本局信息与身份下发
  REPORT: 'PARTY_REPORT',         // 1. 战报与事件
  MARKET: 'PARTY_MARKET',         // 2. 抽牌与公共市场
  TRADE: 'PARTY_TRADE',           // 3. 谈判与交易
  SECRET: 'PARTY_SECRET',         // 4. 同步秘密行动
  RESPONSE: 'PARTY_RESPONSE',     // 5. 响应与反制
  RESOLVE: 'PARTY_RESOLVE',       // 6. 统一结算与线索
  GULAG: 'PARTY_GULAG',           // 古拉格小游戏（第 8 回合开放）
  SCORE: 'PARTY_SCORE',           // 8. 计分与身份线索
  ENDED: 'PARTY_ENDED',
});

/** 队伍规模（设计稿 §1.1 / §12）：首发 8–12 人。 */
export const PARTY_MIN_PLAYERS = 4;
export const PARTY_CORE_MIN_PLAYERS = 8;
export const PARTY_CORE_MAX_PLAYERS = 12;
export const PARTY_MAX_PLAYERS = 20;

/**
 * 默认规则与全部【测试值】。所有数值都可以按房间（房主）覆盖：见 normalizePartyConfig。
 * 服务端永远以自己的这份表为准，客户端只用来显示。
 */
export const PARTY_DEFAULTS = Object.freeze({
  // ── 身份配置（设计稿表 4；8–12 人为核心区间） ───────────────────────────────────────────
  /** 玩家数 → 身份人数。表中没有的人数按就近规则推导（见 factionCounts）。 */
  factionTable: Object.freeze({
    4: { LOYAL: 2, SPLIT: 1, OPPORTUNIST: 1 },
    5: { LOYAL: 3, SPLIT: 1, OPPORTUNIST: 1 },
    6: { LOYAL: 4, SPLIT: 1, OPPORTUNIST: 1 },
    7: { LOYAL: 4, SPLIT: 2, OPPORTUNIST: 1 },
    8: { LOYAL: 5, SPLIT: 2, OPPORTUNIST: 1 },
    9: { LOYAL: 6, SPLIT: 3, OPPORTUNIST: 2 },  // 表 4 把 9–12 写成 5–7 / 2–3 / 2，按总人数补齐
    10: { LOYAL: 6, SPLIT: 2, OPPORTUNIST: 2 },
    11: { LOYAL: 7, SPLIT: 2, OPPORTUNIST: 2 },
    12: { LOYAL: 7, SPLIT: 3, OPPORTUNIST: 2 },
    13: { LOYAL: 7, SPLIT: 3, OPPORTUNIST: 3 },
    14: { LOYAL: 8, SPLIT: 3, OPPORTUNIST: 3 },
    15: { LOYAL: 9, SPLIT: 3, OPPORTUNIST: 3 },
    16: { LOYAL: 10, SPLIT: 3, OPPORTUNIST: 3 },
    17: { LOYAL: 10, SPLIT: 4, OPPORTUNIST: 3 },
    18: { LOYAL: 11, SPLIT: 4, OPPORTUNIST: 3 },
    19: { LOYAL: 11, SPLIT: 4, OPPORTUNIST: 4 },
    20: { LOYAL: 12, SPLIT: 4, OPPORTUNIST: 4 },
  }),
  splitKnowledge: SPLIT_KNOWLEDGE.PARTIAL,

  // ── 资源（设计稿表 7）────────────────────────────────────────────────────────────────
  resources: Object.freeze({
    tickets: Object.freeze({ start: 5, cap: 20, incomePerRound: 2 }), // 调度券
    intel: Object.freeze({ start: 2, cap: 8, incomePerRound: 1 }),    // 情报点
    influence: Object.freeze({ start: 1, cap: 6, incomePerRound: 1 }), // 影响力
  }),

  // ── 卡组与手牌（设计稿表 6）────────────────────────────────────────────────────────────
  deck: Object.freeze({
    startHand: 4,
    drawPerRound: 2,
    handCap: 7,
    deckCap: 20,
    starters: 12,
    maxPlaysPerRound: 2,
  }),

  // ── 公共市场（设计稿 §4.2）────────────────────────────────────────────────────────────
  market: Object.freeze({
    slots: 4,
    fixedSlots: 2,
    sealedSlots: 2,
    /** 每名玩家每轮可购买固定价格卡的张数 */
    fixedBuysPerRound: 1,
    /** 起拍价（竞价卡的最低有效出价，单位：调度券） */
    minBid: 1,
  }),

  // ── PvP 限制（设计稿 §7）────────────────────────────────────────────────────────────
  pvp: Object.freeze({
    /** 单次资源损失不超过目标可用资源的比例（向下取整，至少 1） */
    maxLossRatio: 0.25,
    /** 同一目标每轮最多承受的高风险 PvP 效果次数 */
    maxHighRiskPerTargetPerRound: 1,
    /** 同一对玩家连续互刷不产生额外功绩：同一对玩家之间每 N 轮最多计入一次 */
    pairCooldownRounds: 2,
  }),

  // ── 古拉格（设计稿 §9–§10，已确定规则基准）─────────────────────────────────────────────
  gulag: Object.freeze({
    /** 正常情况下第 8 回合开放。 */
    openRound: 8,
    /** 第 6 回合进行第一次 D20 暴动检定。 */
    firstRollRound: 6,
    /** 第 6 回合没触发时，第 8 回合小游戏开始前再检定一次。 */
    secondRollRound: 8,
    /** 二十面骰，只有恰好等于该值才触发暴动。 */
    dieSides: 20,
    riotFace: 6,
    /** 队友购买一次额外挑战机会的价格（【测试值】设计稿建议 3 张调度券）。 */
    extraChanceCost: 3,
    /** 每名玩家整局最多通过队友资助获得的额外挑战机会次数（设计稿建议 1）。 */
    maxExtraChancesPerPlayer: 1,
    /** 每名玩家正常情况下只有一次普通挑战资格。 */
    normalChances: 1,
    /** 小游戏：题目数与限时（【测试值】设计稿 §11 建议 15–45 秒）。 */
    quizQuestions: 5,
    quizSeconds: 30,
    /** 返场时的目标生命值（设计稿 §15「返场时恢复多少生命」待定，这里取测试值）。 */
    returnLp: 10,
    /** 返场后的短暂保护：返还的回合数（0 = 不保护）。 */
    returnShieldRounds: 1,
  }),

  // ── 计分（设计稿表 13：总分封顶 100）───────────────────────────────────────────────────
  score: Object.freeze({
    cap: 100,
    maximums: Object.freeze({
      campaign: 35, secret: 25, team: 25, party: 10, risk: 5,
    }),
    factionWinBonus: 20,
    personalWinBonus: 15,
  }),

  // ── 房间设置：允许房主在开局前覆盖的字段（其余保持默认）─────────────────────────────────
  allowHostOverride: Object.freeze(['splitKnowledge', 'gulag.extraChanceCost']),
});

/** 深拷贝并冻结一个对象（默认表用）。 */
function frozenCopy(v) {
  if (v === null || typeof v !== 'object') return v;
  const out = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) out[k] = frozenCopy(v[k]);
  return Object.freeze(out);
}

/** 座位数上限（服务端 / 协议 / 前端共用）。 */
export const PARTY_SEATS = Object.freeze([8, 10, 12]);

/** 房主可为 8–12 人房选择的座位数；其它人数按 PARTY_MIN_PLAYERS–PARTY_MAX_PLAYERS 放行。 */
export function isValidPartySeatCount(n) {
  return Number.isInteger(n) && n >= PARTY_MIN_PLAYERS && n <= PARTY_MAX_PLAYERS;
}

/**
 * 身份人数：优先用表里的精确值；人数不在表里时按比例推导，且保证忠诚派多于裂盟派
 * （设计稿表 4 的分配思路：忠诚派 ~60%，裂盟派 ~25%，投机派 ~15%）。
 */
export function factionCounts(players, table = PARTY_DEFAULTS.factionTable) {
  if (!isValidPartySeatCount(players)) throw new RangeError(`invalid party player count: ${players}`);
  const exact = table[players];
  if (exact) {
    const total = (exact.LOYAL || 0) + (exact.SPLIT || 0) + (exact.OPPORTUNIST || 0);
    if (total === players) return { ...exact };
  }
  const opportunist = Math.max(1, Math.floor(players * 0.15));
  const split = Math.max(1, Math.floor(players * 0.25));
  const loyal = players - opportunist - split;
  return { [FACTION.LOYAL]: loyal, [FACTION.SPLIT]: split, [FACTION.OPPORTUNIST]: opportunist };
}

/**
 * 合法化一份（可能来自房间设置的）配置覆盖。只接受 allowHostOverride 里列出的路径，值必须合法，
 * 否则丢弃该覆盖并保留默认值 —— 服务端不信任客户端发来的任何设置。
 */
export function normalizePartyConfig(overrides, defaults = PARTY_DEFAULTS) {
  const out = frozenCopy(defaults);
  const mutable = JSON.parse(JSON.stringify(out));
  if (overrides && typeof overrides === 'object') {
    const knowledge = overrides.splitKnowledge;
    if (typeof knowledge === 'string' && Object.values(SPLIT_KNOWLEDGE).includes(knowledge)) mutable.splitKnowledge = knowledge;
    const cost = overrides.extraChanceCost;
    if (Number.isInteger(cost) && cost >= 1 && cost <= 10) mutable.gulag.extraChanceCost = cost;
  }
  return Object.freeze(mutable);
}

/** 本轮是否应进行暴动检定，返回应掷骰的时机名或 null。规则见设计稿 §10 与 PARTY_MODE.md。 */
export function riotRollRound(cfg, round) {
  const g = cfg.gulag;
  if (round === g.firstRollRound) return 'FIRST';
  if (round === g.secondRollRound) return 'SECOND';
  return null;
}

/**
 * 折算一次 PvP 资源损失：不超过目标的 maxLossRatio，向下取整，至少 1（设计稿 §7）。
 * wanted 为请求的数值，available 为目标的可用资源。
 */
export function clampPvpLoss(wanted, available, ratio = PARTY_DEFAULTS.pvp.maxLossRatio) {
  const have = Math.max(0, Math.floor(Number(available) || 0));
  if (have <= 0) return 0;
  const cap = Math.max(1, Math.floor(have * ratio));
  const want = Math.max(0, Math.floor(Number(wanted) || 0));
  return Math.min(have, Math.min(cap, want > 0 ? want : cap));
}

export { frozenCopy as deepFreeze };
