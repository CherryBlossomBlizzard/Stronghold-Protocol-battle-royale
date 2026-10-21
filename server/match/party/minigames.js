// server/match/party/minigames.js — 古拉格派对小游戏（设计稿 §11 表 16）。
//
// 服务端权威：题目与正确答案**只在服务端**生成；发给客户端的只有题目和选项（不含答案下标）。
// 得分由服务端 runChallenge() 判定，客户端提交的 choice 只是"作答"，不能决定输赢。
//
// 四种小游戏（表 16）：
//   极限反应   reaction   按提示点击正确的目标符号
//   记忆审判   memory     短暂展示序列后回忆
//   数字陷阱   math       限时完成数字规律
//   真假通缉令 truth      根据短线索判断陈述真假（预设题库，避免歧义）

/** 小游戏种类。 */
export const MINIGAME_KINDS = Object.freeze(['reaction', 'memory', 'math', 'truth']);

const SYMBOLS = ['◆', '●', '▲', '■', '★', '✚'];

/**
 * 创建一个挑战实例（题目 + 答案）。确定性地使用注入 rng。
 * @param {{int:(n:number)=>number, shuffle:(a:any[])=>void}} rng
 * @param {object} gulagCfg  cfg.gulag（quizQuestions / quizSeconds）
 * @returns {{kind:string, questions:Array, passLine:number, publicQuestions:()=>Array}}
 */
export function createChallengeInstance(rng, gulagCfg) {
  const count = Math.max(3, gulagCfg.quizQuestions || 5);
  const kind = MINIGAME_KINDS[rng.int(MINIGAME_KINDS.length)];
  const builders = { reaction: buildReaction, memory: buildMemory, math: buildMath, truth: buildTruth };
  const questions = builders[kind](rng, count);
  // 通过线：半数以上正确（向上取整）；测验"轻松即可"但不白送
  const passLine = Math.ceil(questions.length * 0.6);
  return {
    kind,
    questions,
    passLine,
    /** 发给客户端的题目：**去掉 answer**。 */
    publicQuestions() {
      return questions.map((q) => ({ prompt: q.prompt, options: q.options }));
    },
  };
}

/**
 * 判定一份作答。answers[index] = 选中的 option 下标（未作答为 undefined）。
 * 返回正确题数。
 */
export function runChallenge(instance, answers) {
  let correct = 0;
  for (let i = 0; i < instance.questions.length; i++) {
    const a = answers[i];
    if (typeof a === 'number' && a === instance.questions[i].answer) correct += 1;
  }
  return correct;
}

// ── 各小游戏的题目生成 ────────────────────────────────────────────────────────────────

/** 极限反应：给出目标符号，选出正确的那一个。 */
function buildReaction(rng, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const opts = SYMBOLS.slice();
    rng.shuffle(opts);
    const options = opts.slice(0, 4);
    const answer = rng.int(options.length);
    out.push({ prompt: `目标符号：${options[answer]}`, options, answer });
  }
  return out;
}

/** 记忆审判：给出一段符号序列，问序列里的第 n 位是什么。 */
function buildMemory(rng, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const len = 3 + rng.int(3); // 3..5
    const seq = [];
    for (let k = 0; k < len; k++) seq.push(SYMBOLS[rng.int(SYMBOLS.length)]);
    const pos = rng.int(len);
    const options = SYMBOLS.slice();
    rng.shuffle(options);
    const opts = options.slice(0, 4);
    if (!opts.includes(seq[pos])) opts[rng.int(4)] = seq[pos];
    const answer = opts.indexOf(seq[pos]);
    out.push({ prompt: `序列 ${seq.join(' ')} — 第 ${pos + 1} 个符号是？`, options: opts, answer });
  }
  return out;
}

/** 数字陷阱：等差/等比数列的下一项。 */
function buildMath(rng, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const start = 1 + rng.int(9);
    const step = 1 + rng.int(6);
    const seq = [start, start + step, start + step * 2, start + step * 3];
    const answerValue = start + step * 4;
    const opts = [answerValue];
    while (opts.length < 4) {
      const cand = answerValue + (rng.int(11) - 5) * (rng.int(3) + 1);
      if (cand !== answerValue && cand > 0 && !opts.includes(cand)) opts.push(cand);
    }
    rng.shuffle(opts);
    out.push({ prompt: `找规律：${seq.join(' , ')} , ?`, options: opts.map(String), answer: opts.indexOf(answerValue) });
  }
  return out;
}

/** 真假通缉令：预设题库（避免歧义），判断陈述真假。 */
function buildTruth(rng, count) {
  const bank = TRUTH_BANK.slice();
  rng.shuffle(bank);
  const out = [];
  for (let i = 0; i < count; i++) {
    const item = bank[i % bank.length];
    out.push({ prompt: item.prompt, options: ['真', '假'], answer: item.answer });
  }
  return out;
}

/**
 * 预设题库（全部与《卫戍协议·神人派对》公开规则一致，答案明确）。
 * answer 是选项下标：0 = "真"，1 = "假"（与 options: ['真', '假'] 对应）。
 */
export const TRUTH_BANK = Object.freeze([
  { prompt: '古拉格正常在第 8 回合开放。', answer: 0 },
  { prompt: '古拉格暴动的 D20 掷出 6 或以上即触发。', answer: 1 }, // 只有恰好 6
  { prompt: '每名玩家正常情况下只有一次古拉格挑战资格。', answer: 0 },
  { prompt: '队友可以花调度券直接替囚犯复活。', answer: 1 }, // 只能买一次额外机会，本人须获胜
  { prompt: '暴动后古拉格在本局永久关闭。', answer: 0 },
  { prompt: '挑战成功者立即回到主战场，无需等待结算。', answer: 1 }, // 下一次主战场结算才返场
  { prompt: '第 6 回合已触发暴动时，第 8 回合不再掷骰。', answer: 0 },
  { prompt: '密封竞价中最高出价平局时，按先到先得决定。', answer: 1 }, // 按轮换优先级
  { prompt: '古拉格暴动使用二十面骰（D20）。', answer: 0 },
  { prompt: '公共市场每轮有 2 张固定价格卡与 2 张密封竞价卡。', answer: 0 },
  { prompt: '每名玩家每轮可以对多张竞价卡各报一次价。', answer: 1 }, // 只能对 1 张
  { prompt: '个人总分建议封顶 100 分。', answer: 0 },
]);
