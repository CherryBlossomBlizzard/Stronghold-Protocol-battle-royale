// server/match/party/PartyMatchAdapter.js — 把 PartyMatch 接到现有房间/网络平台上的适配层。
//
// 复用现有 server/lobby.js 的房间、座位、断线重连、主持人与观战，只在这里把「模式」分流：
//   * 房间带 partyMode = true 时，room.start 用本适配器创建 PartyMatch 而不是 PvE 的 Match；
//   * 协议层（shared/protocol.js）新增 room.party / g.party / g.partyChallenge，已在这里处理；
//   * 客户端收到的仍是 m.* 帧（m.party / m.partyPrivate / m.partyResult），与其它模式下发帧方式一致。
//
// 这一层刻意做得很薄：规则全在 PartyMatch 里，适配层只做「平台契约」的转换。

import { PartyMatch } from './PartyMatch.js';
import { PARTY_MIN_PLAYERS, PARTY_MAX_PLAYERS, normalizePartyConfig } from '../../../shared/partyRules.js';

export { PartyMatch };

/**
 * 从房间对象生成 PartyMatch 的构造参数（不含 send/broadcast/onEnd，由 lobby 提供）。
 * @param {object} args
 * @param {object} args.room          server/lobby.js 的 Room
 * @param {Array}  args.seats         座位列表（含 isBot / connected）
 * @param {string[]} [args.spectators]
 * @param {number} args.seed
 * @param {number} args.matchNo
 */
export function partyMatchOptions({ room, seats, spectators = [], seed, matchNo, data, log, now, ...platform }) {
  return {
    roomCode: room.code,
    partyMode: true,
    seats: seats.map((s) => ({ seat: s.seat, playerId: s.playerId, name: s.name, isBot: !!s.isBot, connected: !!s.connected })),
    spectators,
    seed,
    matchNo,
    partyConfig: normalizePartyConfig(room.partyConfig || {}),
    rounds: Number.isInteger(room.partyRounds) && room.partyRounds > 0 ? room.partyRounds : 12,
    data,
    log,
    now,
    // send / broadcast / onEnd from the lobby (the same platform contract Match receives)
    ...platform,
  };
}

/**
 * 房间设置能否开始派对（服务端权威校验，与协议、前端座位界面一致）。
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePartyRoom(room) {
  const humans = room.activeHumans ? room.activeHumans() : [];
  const all = (room.seats || []).filter(Boolean);
  if (all.length < PARTY_MIN_PLAYERS) return { ok: false, error: 'PARTY_TOO_FEW', detail: `至少需要 ${PARTY_MIN_PLAYERS} 名玩家（含 AI）` };
  if (all.length > PARTY_MAX_PLAYERS) return { ok: false, error: 'PARTY_TOO_MANY', detail: `最多 ${PARTY_MAX_PLAYERS} 名玩家` };
  if (!humans.length) return { ok: false, error: 'NOT_READY', detail: '至少需要 1 名真人玩家' };
  return { ok: true };
}

/** 房间的派对设置（合法化后）。 */
export function partyRoomSettings(room) {
  const cfg = normalizePartyConfig(room.partyConfig || {});
  return {
    partyMode: !!room.partyMode,
    splitKnowledge: cfg.splitKnowledge,
    extraChanceCost: cfg.gulag.extraChanceCost,
    openRound: cfg.gulag.openRound,
    rounds: Number.isInteger(room.partyRounds) && room.partyRounds > 0 ? room.partyRounds : 12,
    minPlayers: PARTY_MIN_PLAYERS,
    maxPlayers: PARTY_MAX_PLAYERS,
  };
}
