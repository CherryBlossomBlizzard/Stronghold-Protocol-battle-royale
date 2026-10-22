// test/match/official-baseline.js — 卫戍协议：盟约 · 大逃杀的「官方基线用例」开关。
//
// 本分支有意偏离上游 v0.3.1 的规则（见 MODIFICATIONS.md 与 server/match/battleRoyaleRules.js）：
//   1. 第 20 回合的首领战领袖血量固定 5 亿（RULES.bossHp），不再按 bloodPoint × 存活人数缩放，
//      首领战也只在第 20 回合出现（R14 / R15 的官方「最终攻势 + 隐秘核心」在这里不成立）；
//   2. 第 14 回合起出怪掷骰子、怪物血量每回合翻倍，首领本体 / 首领部件 / 次数怪本体不进普通波次；
//   3. 关闭官方的「限伤」与「次数怪吃血量加成」。
//
// 因此一批只验证上游官方数值 / 官方回合表的用例在本分支上不成立。这些用例留在仓库里作为上游契约的文档，
// 用本开关明确跳过 —— 而不是删掉，也不是把断言改成与实现循环论证。
//
// 官方行为本身的覆盖：上游 v0.3.1 的同一批用例在 sganggs/Stronghold-Protocol tag v0.3.1 原样存在；
// 本分支另有 test/match/battle-royale-rules.test.js（13 项）逐条验证本服的偏离，
// 以及 test/match/fullmatch*.test.js 整局跑通（真实出怪与 R20 首领战）。

/**
 * test() 的 options：{ skip: '原因' }。
 * @param {string} why 为什么这个用例在本分支不适用（写清对应哪一条规则）
 * @returns {{ skip: string }}
 */
export const officialBaseline = (why) => ({ skip: `官方基线用例不适用（本分支改用大逃杀规则）：${why}` });
