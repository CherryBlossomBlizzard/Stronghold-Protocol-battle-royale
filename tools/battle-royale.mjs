// tools/battle-royale.mjs — 卫戍协议：盟约 · 大逃杀的运维开关（不需要重启服务器）。
//
//   node tools/battle-royale.mjs status           查看当前规则与扣血上限开关
//   node tools/battle-royale.mjs lp-cap on        开启：一回合最多扣 10 点血
//   node tools/battle-royale.mjs lp-cap off       关闭：扣血无限制（漏多少扣多少）
//   node tools/battle-royale.mjs lp-cap toggle    取反
//
// 开关写在 <项目目录>/runtime/battle-royale.json，运行中的服务器约 1 秒内读到（server/match/battleRoyaleRules.js）。
// i18n-ignore-file: 运维命令行输出，不是玩家界面文本

import { RULES, readRules, writeLpCap, rulesFile } from '../server/match/battleRoyaleRules.js';
import { ROOT } from '../server/http/config.js';

const [cmd, arg] = process.argv.slice(2);
const rules = readRules();

function status() {
  const on = rules.lpCapEnabled !== false;
  console.log(`  本服名称：${RULES.name}`);
  console.log(`  血量上限：${RULES.startLp}（所有策略 / 所有玩家）`);
  console.log(`  回合扣血上限：${on ? '已开启 · 一回合最多扣 10 点血' : '已关闭 · 扣血无限制'}`);
  console.log(`  出怪：掷骰子（每一波从全部怪物里随机抽）；前 ${RULES.rollWaveEarlyRounds} 回合只出「中等及以下」`
    + `（属性强度 ≤ 全部怪物的 ${Math.round(RULES.rollWaveMidShare * 100)}% 分位），第 ${RULES.rollWaveEarlyRounds + 1} 回合起全开`);
  console.log(`  怪物倍率：第 1–13 回合官方表，第 14 回合按比例，第 15 回合起血量每回合翻四倍`);
  console.log(`  首领战：第 ${RULES.bossRound} 回合强制进入，领袖血量 ${RULES.bossHp}，限时 ${RULES.bossTimeLimitSec} 秒，打完即结束这一把`);
  console.log(`  扣血加钱：${RULES.bloodMoneyCost} 滴血换 ${RULES.bloodMoneyGain} 资金（低于 ${RULES.bloodMoneyCost} 滴不能用，刚好 ${RULES.bloodMoneyCost} 滴用完当场淘汰）`);
  console.log(`  卡池：角色无限张（概率不变，上限 ×${RULES.poolCapMultiplier}）；装备：无限量供应，无共享库存上限`);
  console.log(`  联防：已删除（漏怪直接扣血）；首领战：第 ${RULES.bossRound} 回合强制进入（十亿血 · 限时 ${RULES.bossTimeLimitSec} 秒，打完即结束这一局）`);
  console.log(`  禁用阵营：保留上游原值（被禁盟约与其干员不出现）`);
  console.log(`  规则文件：${rulesFile(ROOT)}`);
}

switch (String(cmd || 'status').toLowerCase()) {
  case 'status': case 'show': case '':
    status();
    break;
  case 'lp-cap': case 'lpcap': case 'cap': {
    const want = String(arg || '').toLowerCase();
    let next;
    if (['on', '1', 'true', '开启'].includes(want)) next = true;
    else if (['off', '0', 'false', '关闭'].includes(want)) next = false;
    else if (['toggle', ''].includes(want)) next = rules.lpCapEnabled === false;
    else { console.error('用法：node tools/battle-royale.mjs lp-cap on|off|toggle'); process.exit(2); }
    writeLpCap(next);
    console.log(`  回合扣血上限已${next ? '开启（一回合最多扣 10 点血）' : '关闭（扣血无限制）'} —— 运行中的服务器约 1 秒内生效。`);
    break;
  }
  default:
    console.error('用法：node tools/battle-royale.mjs [status | lp-cap on|off|toggle]');
    process.exit(2);
}
