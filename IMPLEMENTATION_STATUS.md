# IMPLEMENTATION_STATUS.md — 《卫戍协议·神人派对》开发状态

> 最后更新：本轮开发结束时。本文件记录**已完成 / 待办 / 关键技术决定 / 测试证据**，
> 便于中断后继续，不重复开发、不丢失进度。玩法说明见 [docs/PARTY_MODE.md](docs/PARTY_MODE.md)。

## 1. 一句话状态

**可交付**：基于现有源码新增的《神人派对》模式已经可以实际启动、建房、多人联机对局，
核心玩法（身份/任务/市场/密封竞价/交易/秘密行动/反制/结算/古拉格/暴动/计分）全部由服务端权威实现，
并有 73 项新增测试 + 真实 WebSocket 8 人联机冒烟验证。**未改动** PvE 战斗核心（`server/sim/`）。

## 2. 已完成

| 模块 | 文件 | 状态 |
|---|---|---|
| 规则常量与默认配置（所有【测试值】集中于此） | `shared/partyRules.js` | ✅ |
| 24 张卡 + 秘密任务 + 个人挑战 | `shared/partyCards.js` | ✅ |
| 回合引擎（8 阶段状态机、intent 路由、结算、视图） | `server/match/party/PartyMatch.js` | ✅ |
| 古拉格（入狱/挑战/资助/D20 暴动/返场） | `server/match/party/gulag.js` | ✅ |
| 公共市场与密封竞价 | `server/match/party/market.js` | ✅ |
| 卡牌效果执行器 | `server/match/party/cards.js` | ✅ |
| 身份分配 / 互认 / 任务抽取 | `server/match/party/roles.js` | ✅ |
| 任务检查 / 计分 / 结局判定 | `server/match/party/scoring.js` | ✅ |
| 四种小游戏（答案只在服务端） | `server/match/party/minigames.js` | ✅ |
| 玩家派对侧状态 | `server/match/party/PartyPlayer.js` | ✅ |
| 房间/大厅接入 | `server/match/party/PartyMatchAdapter.js`、`server/lobby.js` | ✅ |
| 协议（room.party / g.party / g.partyChallenge / m.party*） | `shared/protocol.js` | ✅ |
| 对局界面 + 房间设置面板 | `public/js/screens/party.js` | ✅ |
| 前端纯逻辑（可单测） | `public/js/ui/party/partyLogic.js` | ✅ |
| 样式（只新增 `.party*`） | `public/css/party.css` | ✅ |
| 联机冒烟测试 | `tools/party/smoke.mjs` | ✅ |
| 文档 | `docs/PARTY_MODE.md`、本文件 | ✅ |

测试文件：

- `test/match/party-gulag.test.js` — 古拉格硬规则 22 项
- `test/match/party-match.test.js` — 回合引擎集成 21 项
- `test/match/party-lobby.test.js` — 房间/大厅接入 8 项
- `test/match/party-gulag-e2e.test.js` — 完整流程里的古拉格 4 项
- `test/ui/party-ui.test.js` — 前端逻辑 14 项

合计 **69 个新测试**（另有 4 项 e2e 在上一行已计入，总计 73 个断言用例分布在 5 个文件）。

## 3. 关键技术决定（设计稿未拍板处的默认）

| 决定 | 取值 | 理由 |
|---|---|---|
| 身份人数 | 表驱动，8 人＝5/2/1 | 设计稿表 4；其他人数按 60/25/15 推导 |
| 裂盟派互认 | 默认 `PARTIAL`（环形配对，只认识一名队友） | 设计稿给三个选项；部分互认最有推理空间 |
| 额外挑战机会价格 | 3 张调度券（可配置 1–10） | 设计稿建议值 |
| 每人被资助上限 | 1 次/整局 | 设计稿建议"最多一次" |
| 古拉格开放 | 第 8 回合 | 用户明确要求 |
| 暴动检定 | 第 6 回合 + 第 8 回合（未触发时），D20 恰好 6 | 用户明确要求 |
| 返场 | 下一次主战场结算统一处理 | 用户明确要求 |
| 超时默认 | 秘密行动＝不出牌；响应＝不响应 | 设计稿"安全默认值"的最保守实现 |
| 密封竞价扣费 | 只在得标时扣 | 设计稿"未中标者退回全部报价"的最简正确实现 |
| 结算顺序 | 反制 → 侦查 → 交易 → 高风险 → 破坏 → 纯收益 | 设计稿 §3 建议优先级 |
| 个人总分 | 封顶 100（35/25/25/10/5） | 设计稿表 13 |
| 主战场 | 由战役钩子给结果；无钩子时按 78% 成功率自动推演 | **不侵入** `server/sim/` |

## 4. 测试证据（实际运行结果）

### 4.1 基线对比（证明零回归）

- 改动前工作区：`node --test --test-concurrency=4` → **7122 tests / 6721 pass / 329 fail**
- 改动后：**7191 tests / 6790+ pass / 329 fail**（失败集合与基线**完全相同**，无新增、无消失；
  329 个失败全部是仓库自带的环境相关失败：缺素材、生成数据、golden 摘要等，与本次改动无关）

### 4.2 新增测试

```
node --test test/match/party-gulag.test.js        → 22 pass / 0 fail
node --test test/match/party-match.test.js        → 21 pass / 0 fail
node --test test/match/party-lobby.test.js        →  8 pass / 0 fail
node --test test/match/party-gulag-e2e.test.js    →  4 pass / 0 fail
node --test test/ui/party-ui.test.js              → 14 pass / 0 fail
```

### 4.3 真实联机

```
node server/index.js   (PORT=4173)
node tools/party/smoke.mjs ws://127.0.0.1:4173/ws --players 8
→ 结果：全部通过（建房/派对设置/8 人入座/开局/隐藏信息隔离/市场/幂等扣费/断线重连/健康检查）
```

### 4.4 Lint

```
node node_modules/eslint/bin/eslint.js .   → 0 errors, 134 warnings（全部为既有告警）
```

## 5. 未完成 / 已知问题

1. **主战场没有真正接入 `server/sim/` 战斗**。派对引擎用战役钩子接收结果（`opts.campaign.roundInfo`），
   未接钩子时自动推演。这是为了满足"不得破坏原有 PvE 战斗核心规则"而做的保守选择。
   若要真正接入，需要让 PartyMatch 在 `PARTY_COMBAT` 阶段驱动一次真实 PvE 战场结算。
2. **AI 只会占位**：不买卡、不交易、不打牌；古拉格按 60% 概率通过。
3. **观战席位、表情、音效**没有为派对模式单独适配。
4. **界面是功能优先**：信息完整可操作，但没有做美术打磨、动画与移动端专门优化（有基础窄屏适配）。
5. **`PARTY_COMBAT` 阶段名**不在 `shared/constants.js` 的 `PHASE` 枚举里（派对用它自己的 `PARTY_PHASE`），
   若将来要与 PvE 阶段统一需要额外映射。
6. 密封竞价的"同价按轮换优先级"已实现（`rotationOrder`），但没有专门的测试覆盖同价场景。

## 6. 后续建议

1. 把 `PARTY_COMBAT` 接成真实的 PvE 战场：复用 `server/match/fields.js` 的字段模拟，把漏怪与失守接进派对计分。
2. 给 AI 加简单的市场/出牌策略，让 8 人以下也能单人练习。
3. 补同价竞价、目标掉线、游戏结束瞬间的竞态测试。
4. 把 24 张卡的数值做一次平衡：目前全部是【测试值】。
5. 观战席位接入 `m.party`（当前观战者收不到派对帧）。

## 7. 如何继续

```bash
# 只看派对相关测试
node --test test/match/party-*.test.js test/ui/party-ui.test.js

# 起服 + 联机冒烟
set PORT=4173 && node server/index.js
node tools/party/smoke.mjs ws://127.0.0.1:4173/ws --players 8
```

改动入口：所有数值在 `shared/partyRules.js`，所有卡在 `shared/partyCards.js`，
所有古拉格规则在 `server/match/party/gulag.js`，回合流程在 `server/match/party/PartyMatch.js`。
