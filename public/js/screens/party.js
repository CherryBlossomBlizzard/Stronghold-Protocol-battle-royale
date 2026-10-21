// public/js/screens/party.js — 《卫冕协议·神人派对》的界面：
//   PartyScreen       对局主界面（简报 / 战报 / 市场 / 交易 / 秘密行动 / 响应 / 古拉格 / 计分 / 结果）
//   PartyRoomSettings 房间设置（房主，仅在等待房间里显示）
//
// 约定：这里只做"显示 + 发 intent"。任何合法性判断都在服务端（server/match/party/PartyMatch.js）；
// 界面上的禁用态只用来提示，不能当作安全边界。

import { useState, useEffect, useMemo } from '../../vendor/hooks.module.js';
import { html, Button, MicroLabel } from '../ui/components.js';
import { useStore } from '../store.js';
import { net } from '../net.js';
import {
  partyViewState, handRows, marketRows, gulagPanel, otherPlayers, secondsLeft,
  partySettingsPayload, validatePartySettings, PHASE_LABEL, FACTION_NAME, INMATE_LABEL,
} from '../ui/party/partyLogic.js';
import { cardDef } from '../../../shared/partyCards.js';
import { PARTY_PHASE } from '../../../shared/partyRules.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 发一条派对 intent；返回 { ok } | { error }。 */
function sendParty(op, fields = {}) {
  return net.request('g.party', { op, requestId: `${op}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...fields });
}

function Cost({ cost }) {
  const bits = [];
  if (cost?.tickets) bits.push(`${cost.tickets} 券`);
  if (cost?.intel) bits.push(`${cost.intel} 情报`);
  if (cost?.influence) bits.push(`${cost.influence} 影响`);
  if (!bits.length) return html`<span class="party-cost free">免费</span>`;
  return html`<span class="party-cost">${bits.join(' · ')}</span>`;
}

function CardFace({ def, footer, count }) {
  if (!def) return null;
  return html`<div class=${cx('party-card', `kind-${String(def.kind).toLowerCase()}`)}>
    <div class="party-card-top">
      <span class="party-card-name">${def.name}${count > 1 ? ` ×${count}` : ''}</span>
      <${MicroLabel}>${def.kind === 'PRANK' ? '整活' : def.kind === 'PARTY' ? '派对' : def.kind === 'SOCIAL' ? '推理' : '反制'}<//>
    </div>
    <div class="party-card-text">${def.text}</div>
    <div class="party-card-bottom"><${Cost} cost=${def.cost} />${footer}</div>
  </div>`;
}

/** 计时条。 */
function Countdown({ deadline }) {
  const [, force] = useState(0);
  useEffect(() => {
    const h = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(h);
  }, []);
  const s = secondsLeft(deadline);
  if (s == null) return null;
  return html`<span class=${cx('party-countdown', s <= 10 && 'hot')}>${s}s</span>`;
}

function ResourceBar({ priv }) {
  if (!priv) return null;
  const r = priv.resources || {};
  return html`<div class="party-resources">
    <span title="调度券">🎫 ${r.tickets ?? 0}</span>
    <span title="情报点">🔍 ${r.intel ?? 0}</span>
    <span title="影响力">📣 ${r.influence ?? 0}</span>
    <span title="功绩">⭐ ${r.merit ?? 0}</span>
  </div>`;
}

function PlayerTable({ pub, meId }) {
  const players = Array.isArray(pub.players) ? pub.players : [];
  return html`<table class="party-players">
    <thead><tr>
      <th>座位</th><th>玩家</th><th>🎫</th><th>🔍</th><th>📣</th><th>⭐</th><th>嫌疑</th><th>手牌</th>
    </tr></thead>
    <tbody>
      ${players.map((p) => html`<tr key=${p.playerId} class=${cx(p.playerId === meId && 'me', p.left && 'gone')}>
        <td>${(p.seat ?? 0) + 1}</td>
        <td>${p.name}${p.isBot ? '（AI）' : ''}${p.connected === false ? ' ⚠断线' : ''}</td>
        <td>${p.tickets}</td><td>${p.intel}</td><td>${p.influence}</td><td>${p.merit}</td>
        <td>${p.suspicion}</td><td>${p.handCount}</td>
      </tr>`)}
    </tbody>
  </table>`;
}

/** 选择目标的下拉。 */
function TargetPick({ pub, meId, value, onChange, excludeInactive = true }) {
  const opts = otherPlayers(pub.players, meId).filter((p) => !excludeInactive || !p.left);
  return html`<select value=${value || ''} onChange=${(e) => onChange(e.currentTarget.value)}>
    <option value="">选择目标…</option>
    ${opts.map((p) => html`<option key=${p.playerId} value=${p.playerId}>${p.name}</option>`)}
  </select>`;
}

/** 我的角色卡片（只给自己看）。 */
function RoleCard({ priv }) {
  const role = priv && priv.role;
  if (!role) return null;
  const known = Array.isArray(role.knownSplits) && role.knownSplits.length
    ? `认识的裂盟派：${role.knownSplits.length} 人`
    : '你不认识任何其他裂盟派';
  return html`<div class="party-role">
    <h3>你的身份：<span class=${cx('faction', role.faction)}>${FACTION_NAME[role.faction] || role.faction}</span></h3>
    ${role.faction === 'SPLIT' ? html`<p class="dim">${known}</p>` : null}
    ${role.objective ? html`<p><b>秘密任务</b>：${role.objective.name} — ${role.objective.text}
      <span class="dim">（${role.objective.points} 分${role.objectiveDone ? '，已完成' : ''}）</span></p>` : null}
    ${role.challenge ? html`<p><b>个人挑战</b>：${role.challenge.name} — ${role.challenge.text}
      <span class="dim">（${role.challenge.points} 分${role.challengeDone ? '，已完成' : ''}）</span></p>` : null}
  </div>`;
}

/** 战报与事件。 */
function ReportPanel({ pub }) {
  const log = Array.isArray(pub.log) ? pub.log.slice(-14).reverse() : [];
  const c = pub.campaign || {};
  return html`<div class="party-section">
    <h3>战报与事件</h3>
    <p class="dim">共同战役：${c.victory ? '仍在坚守' : '有失守记录'}；失守 ${c.losses || 0} 次</p>
    <ul class="party-log">${log.map((e, i) => html`<li key=${i}>${describeEvent(e, pub)}</li>`)}</ul>
  </div>`;
}

/** 把一条公开事件描述成中文（服务端只发结构化事件）。 */
export function describeEvent(e, pub) {
  if (!e || !e.kind) return '';
  const name = (id) => {
    const p = (pub.players || []).find((x) => x.playerId === id);
    return p ? p.name : id;
  };
  switch (e.kind) {
    case 'jail': return `${name(e.playerId)} 被淘汰，进入古拉格`;
    case 'riot-roll': return `第 ${e.round} 回合暴动检定（${e.when === 'FIRST' ? '第一次' : '第二次'}）：D${e.sides} = ${e.roll}${e.triggered ? ' → 暴动触发！' : ''}`;
    case 'riot': return `古拉格暴动！${(e.released || []).length} 人立刻获释，古拉格永久关闭`;
    case 'gulag-open': return `第 ${e.round} 回合：古拉格开放`;
    case 'challenge-won': return `${name(e.playerId)} 通过了古拉格挑战，将在下一次主战场结算时返场`;
    case 'challenge-lost': return `${name(e.playerId)} 古拉格挑战失败`;
    case 'gulag.return': case 'return': return `${name(e.playerId)} 已返回主战场`;
    case 'sponsor': return `${name(e.payerId)} 为 ${name(e.beneficiaryId)} 购买了额外挑战机会（${e.cost} 张调度券）`;
    case 'eliminated': return `${name(e.playerId)} 被淘汰`;
    case 'trade': return `${name(e.fromId)} 与 ${name(e.toId)} 完成了一笔交易`;
    case 'accusation': return `${name(e.by)} 公开指控了 ${name(e.targetId)}`;
    case 'motion-passed': return `${name(e.actorId)} 的议案获得通过`;
    case 'countered': return `${name(e.by)} 成功反制了一次行动`;
    case 'sponsor-blocked': return '资助被拒绝';
    case 'action': return '有人采取了行动';
    default: return e.kind;
  }
}

/** 市场。 */
function MarketPanel({ pub, priv }) {
  const rows = marketRows(pub.market, priv && priv.market, priv && priv.resources);
  const [bidSlot, setBidSlot] = useState(null);
  const [bidAmount, setBidAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  const act = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return html`<div class="party-section">
    <h3>公共市场 <span class="dim">（每轮 2 张固定价 + 2 张密封竞价）</span></h3>
    <div class="party-market">
      ${rows.map((s) => html`<div class="party-market-slot" key=${s.slot}>
        <${CardFace} def=${s.def} />
        <div class="party-market-meta">
          ${s.mode === 'fixed'
            ? html`<span>固定价 ${s.price} 券 · 剩 ${s.remaining}</span>`
            : html`<span>密封竞价 · 起拍 ${s.price} · 已有 ${s.bidderCount} 人报价${s.myBid ? ` · 你的报价 ${s.myBid}` : ''}</span>`}
        </div>
        ${s.mode === 'fixed'
          ? html`<${Button} size="sm" disabled=${!s.canBuy || busy} onClick=${() => act(() => sendParty('buy', { slot: s.slot }))}>购买<//>`
          : html`<div class="party-bid">
              ${bidSlot === s.slot
                ? html`<input type="number" min="1" max="99" value=${bidAmount} onInput=${(e) => setBidAmount(Number(e.currentTarget.value) || 1)} />
                    <${Button} size="sm" disabled=${!s.canBid || busy} onClick=${() => act(async () => { await sendParty('bid', { slot: s.slot, amount: bidAmount }); setBidSlot(null); })}>确认报价<//>`
                : html`<${Button} size="sm" disabled=${!s.canBid || busy} onClick=${() => { setBidSlot(s.slot); setBidAmount(s.price); }}>出价<//>`}
            </div>`}
      </div>`)}
    </div>
    <p class="dim">报价在结算前不扣费；未中标者不损失任何资源。</p>
    <div class="party-actions"><${Button} size="sm" onClick=${() => act(() => sendParty('ready'))}>结束市场<//></div>
  </div>`;
}

/** 交易。 */
function TradePanel({ pub, priv, meId }) {
  const [target, setTarget] = useState('');
  const [give, setGive] = useState(1);
  const [want, setWant] = useState(0);
  const [busy, setBusy] = useState(false);
  const trades = (priv && priv.trades) || [];
  const act = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return html`<div class="party-section">
    <h3>谈判与交易</h3>
    <div class="party-trade-form">
      <${TargetPick} pub=${pub} meId=${meId} value=${target} onChange=${setTarget} />
      <label>付出 🎫 <input type="number" min="0" max="20" value=${give} onInput=${(e) => setGive(Number(e.currentTarget.value) || 0)} /></label>
      <label>换取 🔍 <input type="number" min="0" max="20" value=${want} onInput=${(e) => setWant(Number(e.currentTarget.value) || 0)} /></label>
      <${Button} size="sm" disabled=${!target || (!give && !want) || busy}
        onClick=${() => act(() => sendParty('tradeOffer', {
          targetId: target,
          give: give > 0 ? [{ resource: 'tickets', amount: give }] : [],
          want: want > 0 ? [{ resource: 'intel', amount: want }] : [],
        }))}>提出交易<//>
    </div>
    <h4>交易记录</h4>
    <ul class="party-log">
      ${trades.length ? trades.map((tr) => html`<li key=${tr.id}>
        ${tr.fromId === meId ? '我方' : '对方'}提出：付 ${JSON.stringify(tr.give)} 换 ${JSON.stringify(tr.want)} — ${tr.status}
        ${tr.toId === meId && tr.status === 'pending'
          ? html` <${Button} size="sm" onClick=${() => act(() => sendParty('tradeAccept', { tradeId: tr.id }))}>接受<//>
                  <${Button} size="sm" variant="ghost" onClick=${() => act(() => sendParty('tradeCancel', { tradeId: tr.id }))}>拒绝<//>`
          : null}
      </li>`) : html`<li class="dim">还没有交易</li>`}
    </ul>
    <p class="dim">身份、秘密任务与战斗阵容不可交易；双方确认后才生效，并留内部审计记录。</p>
  </div>`;
}

/** 秘密行动。 */
function SecretPanel({ pub, priv, meId }) {
  const rows = handRows(priv && priv.hand, priv && priv.resources, pub.phase);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const playsLeft = (priv && priv.playsLimit != null ? priv.playsLimit : 2) - ((priv && priv.playsThisRound) || 0);
  const act = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return html`<div class="party-section">
    <h3>同步秘密行动 <span class="dim">（本轮还可打出 ${Math.max(0, playsLeft)} 张）</span></h3>
    <div class="party-target-row">目标：<${TargetPick} pub=${pub} meId=${meId} value=${target} onChange=${setTarget} />
      <span class="dim">（不需要目标的卡会忽略此项）</span></div>
    <div class="party-hand">
      ${rows.length ? rows.map((r) => html`<div class="party-hand-item" key=${r.cardId}>
        <${CardFace} def=${r.def} count=${r.count} />
        <${Button} size="sm" disabled=${!r.playable || playsLeft <= 0 || busy}
          onClick=${() => act(() => sendParty('play', { uid: r.uid, targetId: target || undefined }))}>出牌<//>
      </div>`) : html`<p class="dim">手牌是空的</p>`}
    </div>
    <div class="party-actions"><${Button} size="sm" variant="ghost" onClick=${() => act(() => sendParty('pass'))}>本轮不出牌<//></div>
  </div>`;
}

/** 响应与反制。 */
function ResponsePanel({ pub, priv, meId }) {
  const counters = handRows(priv && priv.hand, priv && priv.resources, pub.phase).filter((r) => r.def.timing === 'RESPONSE');
  const [busy, setBusy] = useState(false);
  // 本轮针对我的行动：服务端在公共日志里发 `action` 事件（带 targetId），这里只挑指向自己的
  const log = Array.isArray(pub.log) ? pub.log.slice(-20).reverse() : [];
  const threats = log.filter((e) => e.kind === 'action' && e.targetId === meId);
  const [against, setAgainst] = useState('');
  const act = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const target = against || (threats.length === 1 ? threats[0].id : '');
  return html`<div class="party-section">
    <h3>响应与反制 <span class="dim">（每轮最多 1 张，超时视为不响应）</span></h3>
    <p class="dim">反制只能针对影响你自己的行动。服务端按固定优先级结算，不按到达顺序。</p>
    ${threats.length > 1 ? html`<div class="party-target-row">针对：
      <select value=${against} onChange=${(e) => setAgainst(e.currentTarget.value)}>
        <option value="">选择要反制的行动…</option>
        ${threats.map((t) => html`<option key=${t.id} value=${t.id}>行动 #${t.seq ?? t.id}</option>`)}
      </select>
    </div>` : null}
    ${!threats.length ? html`<p class="dim">本轮没有针对你的行动。</p>` : null}
    <div class="party-hand">
      ${counters.length ? counters.map((r) => html`<div class="party-hand-item" key=${r.cardId}>
        <${CardFace} def=${r.def} count=${r.count} />
        <${Button} size="sm" disabled=${!r.playable || !target || busy}
          onClick=${() => act(() => sendParty('respond', { uid: r.uid, againstActionId: target }))}>反制<//>
      </div>`) : html`<p class="dim">手里没有反制卡</p>`}
    </div>
    <div class="party-actions"><${Button} size="sm" variant="ghost" onClick=${() => act(() => sendParty('ready'))}>不响应<//></div>
  </div>`;
}

/** 古拉格：挑战小游戏 + 资助。 */
function GulagPanel({ pub, priv, meId }) {
  const panel = gulagPanel(pub, priv, meId);
  const [challenge, setChallenge] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sponsorTarget, setSponsorTarget] = useState('');
  const others = otherPlayers(pub.players, meId).filter((p) => {
    const r = panel.inmates.find((x) => x.playerId === p.playerId);
    return r && (r.state === 'IN_CUSTODY' || r.state === 'QUALIFIED_USED' || r.state === 'CHALLENGING');
  });
  const act = async (fn) => { if (busy) return; setBusy(true); try { return await fn(); } finally { setBusy(false); } };

  const start = () => act(async () => {
    const res = await net.request('g.partyChallenge', { op: 'start' });
    if (res && res.ok && res.challenge) { setChallenge(res.challenge); setAnswers({}); setResult(null); }
  });
  const finish = () => act(async () => {
    const res = await net.request('g.partyChallenge', { op: 'finish' });
    if (res && res.ok) setResult(res);
    setChallenge(null);
  });
  const answer = (index, choice) => {
    setAnswers((a) => ({ ...a, [index]: choice }));
    net.request('g.partyChallenge', { op: 'answer', index, choice });
  };

  return html`<div class="party-section party-gulag">
    <h3>古拉格 <span class=${cx('gulag-state', panel.permanentlyClosed && 'closed')}>${panel.label}</span></h3>
    <p class="dim">第 ${panel.openRound} 回合开放；第 6 回合与第 8 回合各检定一次 D20，
      只有恰好掷出 6 才触发暴动（触发后古拉格永久关闭）。挑战成功者在下一次主战场结算时返场。</p>
    ${panel.rolls.length ? html`<p>检定记录：${panel.rolls.map((r) => `第${r.round}回合 D${r.sides}=${r.roll}${r.triggered ? '（暴动！）' : ''}`).join('；')}</p>` : null}
    ${panel.inmates.length ? html`<table class="party-players">
      <thead><tr><th>囚犯</th><th>状态</th><th>已用资格</th><th>额外机会</th></tr></thead>
      <tbody>${panel.inmates.map((r) => {
        const p = (pub.players || []).find((x) => x.playerId === r.playerId);
        return html`<tr key=${r.playerId}>
          <td>${p ? p.name : r.playerId}</td>
          <td>${INMATE_LABEL[r.state] || r.state}</td>
          <td>${r.chancesUsed}</td><td>${r.extraChances}</td>
        </tr>`;
      })}</tbody>
    </table>` : html`<p class="dim">没有在押囚犯</p>`}

    ${panel.canChallenge && !challenge ? html`<div class="party-actions">
      <${Button} size="sm" disabled=${busy} onClick=${start}>参加古拉格挑战<//>
    </div>` : null}

    ${challenge ? html`<div class="party-minigame">
      <h4>派对小游戏（限时 ${challenge.seconds} 秒）</h4>
      <ol>${challenge.questions.map((q, i) => html`<li key=${i}>
        <p>${q.prompt}</p>
        <div class="party-choices">
          ${q.options.map((o, k) => html`<button key=${k} class=${cx('party-choice', answers[i] === k && 'picked')}
            onClick=${() => answer(i, k)}>${o}</button>`)}
        </div>
      </li>`)}</ol>
      <${Button} size="sm" disabled=${busy} onClick=${finish}>提交作答<//>
    </div>` : null}

    ${result ? html`<p class=${cx('party-mini-result', result.passed ? 'win' : 'lose')}>
      ${result.passed ? '挑战成功！下一次主战场结算时返场。' : `挑战失败（答对 ${result.correct}/${result.total}）`}
    </p>` : null}

    ${!panel.permanentlyClosed && others.length ? html`<div class="party-sponsor">
      <h4>资助队友一次额外挑战机会（${panel.cost} 张调度券）</h4>
      <p class="dim">资助不会直接复活任何人：受益者必须本人完成小游戏并获胜；每人整局最多被资助一次。</p>
      <div class="party-target-row">
        <select value=${sponsorTarget} onChange=${(e) => setSponsorTarget(e.currentTarget.value)}>
          <option value="">选择队友…</option>
          ${others.map((p) => html`<option key=${p.playerId} value=${p.playerId}>${p.name}</option>`)}
        </select>
        <${Button} size="sm" disabled=${!sponsorTarget || busy}
          onClick=${() => act(() => sendParty('sponsor', { playerId: sponsorTarget }))}>出资<//>
      </div>
    </div>` : null}
  </div>`;
}

/** 结果。 */
function ResultPanel({ view }) {
  const r = view.result || (view.pub && view.pub.outcome) || null;
  const rows = (r && Array.isArray(r.rows)) ? r.rows : [];
  return html`<div class="party-section">
    <h3>对局结束</h3>
    ${r && r.outcome ? html`<p>结局：<b>${r.outcome}</b>；战役${r.campaign && r.campaign.victory ? '守住' : '失守'}</p>` : null}
    ${r && r.winner && r.winner.playerId ? html`<p>个人排名第一：<b>${r.winner.name}</b>（${r.winner.finalScore} 分）</p>` : null}
    <table class="party-players">
      <thead><tr><th>名次</th><th>玩家</th><th>阵营</th><th>得分</th><th>任务</th></tr></thead>
      <tbody>${rows.map((row) => html`<tr key=${row.playerId}>
        <td>${row.rank}</td><td>${row.name}</td><td>${FACTION_NAME[row.faction] || row.faction}</td>
        <td>${row.finalScore}</td><td>${row.personalWin ? '完成' : '未完成'}</td>
      </tr>`)}</tbody>
    </table>
  </div>`;
}

/** 主界面。 */
export function PartyScreen() {
  const pub = useStore((s) => s.match.party);
  const priv = useStore((s) => s.match.partyPrivate);
  const result = useStore((s) => s.match.partyResult);
  const meId = useStore((s) => s.me.playerId);
  const room = useStore((s) => s.room);
  const view = useMemo(() => partyViewState({ party: pub, partyPrivate: priv, partyResult: result }, room), [pub, priv, result, room]);

  if (view.kind === 'waiting' || view.kind === 'none') {
    return html`<div class="screen party"><div class="party-loading">
      <p>正在等待对局开始…</p>
    </div></div>`;
  }
  const phase = view.pub.phase;
  const locked = phase === PARTY_PHASE.ENDED;

  return html`<div class="screen party">
    <header class="party-header">
      <div class="party-title">
        <b>卫冕协议 · 神人派对</b>
        <span class="dim">第 ${view.pub.round} / ${view.pub.maxRounds} 回合</span>
      </div>
      <div class="party-phase">
        <span class=${cx('party-phase-badge', `phase-${String(phase).toLowerCase()}`)}>
          ${PHASE_LABEL[phase] || phase}
        </span>
        <${Countdown} deadline=${view.pub.deadline} />
      </div>
      <${ResourceBar} priv=${priv} />
    </header>

    <${RoleCard} priv=${priv} />

    <div class="party-body">
      ${view.kind === 'briefing' ? html`<div class="party-section"><h3>本局信息</h3>
        <p>《卫冕协议·神人派对》：共同 PvE 战役 + 隐藏身份与秘密任务 + 卡牌驱动的有限 PvP + 公共市场 + 同步秘密行动。</p>
        <p class="dim">你的身份与任务只显示在你自己屏幕上；服务端不会把它们发给其他人。</p>
      </div>` : null}
      ${view.kind === 'report' ? html`<${ReportPanel} pub=${view.pub} />` : null}
      ${view.kind === 'market' ? html`<${MarketPanel} pub=${view.pub} priv=${priv} />` : null}
      ${view.kind === 'trade' ? html`<${TradePanel} pub=${view.pub} priv=${priv} meId=${meId} />` : null}
      ${view.kind === 'secret' ? html`<${SecretPanel} pub=${view.pub} priv=${priv} meId=${meId} />` : null}
      ${view.kind === 'response' ? html`<${ResponsePanel} pub=${view.pub} priv=${priv} />` : null}
      ${view.kind === 'gulag' ? html`<${GulagPanel} pub=${view.pub} priv=${priv} meId=${meId} />` : null}
      ${view.kind === 'result' ? html`<${ResultPanel} view=${view} />` : null}
      ${locked ? null : html`<${PlayerTable} pub=${view.pub} meId=${meId} />`}
    </div>

    ${view.kind !== 'gulag' ? html`<div class="party-actions">
      <${Button} size="sm" variant="ghost" onClick=${() => sendParty('ready')}>我准备好了<//>
    </div>` : null}
  </div>`;
}

/** 房间设置（房主在等待房间看到）。 */
export function PartyRoomSettings({ room, isHost }) {
  const initial = {
    partyMode: !!(room && room.party),
    splitKnowledge: (room && room.party && room.party.splitKnowledge) || 'PARTIAL',
    extraChanceCost: (room && room.party && room.party.extraChanceCost) || 3,
    rounds: (room && room.party && room.party.rounds) || 12,
  };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const apply = async (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    const errs = validatePartySettings(next);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      const res = await net.request('room.party', partySettingsPayload(next));
      if (res && res.error) setErrors([res.detail || res.error]);
    } finally {
      setBusy(false);
    }
  };

  if (!isHost) {
    return room && room.party
      ? html`<div class="party-room-settings readonly">
          <p>本房已开启 <b>神人派对</b> 模式（房主设置）。</p>
        </div>`
      : null;
  }

  return html`<div class="party-room-settings">
    <label class="party-toggle">
      <input type="checkbox" checked=${form.partyMode} disabled=${busy}
        onChange=${(e) => apply({ partyMode: e.currentTarget.checked })} />
      开启《卫冕协议·神人派对》模式（4–20 人，推荐 8–12 人）
    </label>
    ${form.partyMode ? html`<div class="party-settings-grid">
      <label>裂盟派互认
        <select value=${form.splitKnowledge} disabled=${busy} onChange=${(e) => apply({ splitKnowledge: e.currentTarget.value })}>
          <option value="ALL">全部互认</option>
          <option value="PARTIAL">部分互认</option>
          <option value="NONE">完全不互认</option>
        </select>
      </label>
      <label>额外挑战机会价格（调度券）
        <input type="number" min="1" max="10" value=${form.extraChanceCost} disabled=${busy}
          onInput=${(e) => set('extraChanceCost', Number(e.currentTarget.value) || 0)}
          onChange=${(e) => apply({ extraChanceCost: Number(e.currentTarget.value) || 0 })} />
      </label>
      <label>主战场回合数
        <input type="number" min="4" max="30" value=${form.rounds} disabled=${busy}
          onInput=${(e) => set('rounds', Number(e.currentTarget.value) || 0)}
          onChange=${(e) => apply({ rounds: Number(e.currentTarget.value) || 0 })} />
      </label>
    </div>` : null}
    ${errors.length ? html`<ul class="party-errors">${errors.map((e, i) => html`<li key=${i}>${e}</li>`)}</ul>` : null}
    <p class="dim">古拉格第 8 回合开放；第 6 与第 8 回合各检定一次 D20，恰好掷出 6 触发暴动。</p>
  </div>`;
}

export { cardDef, t };
