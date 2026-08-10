export const meta = {
  name: 'manager-tick-judge',
  description: '管理者 tick 的语义判定段：AC 状态词 / A16 绕过命中的真伪 / B3 五条判词——机械读数由调用方用脚本采好经 args 传入，本 workflow 只做需要语义的那部分',
  whenToUse: '每轮 manager tick，在机械读数采集完成之后。算术与门槛不进这里（ADR-033）。',
  phases: [
    { title: 'Judge', detail: 'AC 状态词 / A16 命中真伪 / B3 判词，三路并行' },
  ],
}

// ── 为什么是 workflow 而不是"我这一轮记得做" ──────────────────────────────────────
// 人 2026-08-09T15:27 驳回过「workflow 的价值=扇出」这个说法：它的价值是**控制流是代码**
// ——A 段读数被跑是因为脚本跑它，B 段产出被写是因为脚本要它，**与该轮注意力无关**。
// 今晚全部失效（机制在场没被调用、读数在场没被判、no-action 零成本）都是意志/注意力失效。
// 授权：人 2026-08-07T11:16「授权你在 manager tick 应用 workflow」。
//
// 边界（ADR-033 值来源）：算术、门槛比较、计数、排序 —— 全部由调用方脚本做完再传进来；
// 本文件只把**需要语义的三件**交给 schema agent，返回后仍由普通 JS 汇总。

const AC_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['达成', '待观察', '不适用', '不可判', '违反'] },
    evidence: { type: 'string' },
    action_if_violated: { type: 'string' },
  },
  required: ['status', 'evidence'],
}

const HIT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['real-bypass', 'false-positive'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
}

const B3_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['no-action', 'correct', 'escalate'] },
    forced_actions: { type: 'array', items: { type: 'string' } },
    divergence: { type: 'string', enum: ['none', 'K1-report', 'K2-escalate', 'K3-close-gate'] },
    row_summary: { type: 'string' },
  },
  required: ['verdict', 'forced_actions', 'divergence', 'row_summary'],
}

const a = args || {}
const acs = a.acs || []          // [{id, measure_cmd, output}]
const hits = a.a16_hits || []    // [{ts, snippet}]
const b3 = a.b3 || {}            // 五条读数 + 上一轮 nyf/deficit（供背离度用）

phase('Judge')

const [acVerdicts, hitVerdicts, b3Verdict] = await Promise.all([
  parallel(acs.map((ac) => () =>
    agent(
      `判定 AC 状态词。AC: ${ac.id}\n判据命令: ${ac.measure_cmd}\n实测输出: ${ac.output}\n` +
      `只根据这段实测输出判，不要去猜没给出的东西。输出不足以判定就返回「不可判」，不要返回「达成」。`,
      { label: `ac:${ac.id}`, phase: 'Judge', schema: AC_SCHEMA }
    ).then((v) => ({ id: ac.id, ...v }))
  )),
  parallel(hits.map((h, i) => () =>
    agent(
      `判定这条 A16 命中是真绕过还是假阳性。\n时刻: ${h.ts}\n命中片段: ${h.snippet}\n` +
      `判据：只有当 "tmux send-keys" 出现在**命令位置**（行首/&&/;/管道后，且不在引号内）、` +
      `且未经 supervisor-deliver.sh / send-keys-reliable.sh 封装时，才是 real-bypass。` +
      `出现在消息正文、grep 模式、JSON 字符串里的一律 false-positive。`,
      { label: `a16:${i}`, phase: 'Judge', schema: HIT_SCHEMA }
    ).then((v) => ({ ...h, ...v }))
  )),
  agent(
    `给出本轮 manager tick 的判词。五条不等式读数（已由脚本算好，不要重算）：\n` +
    `${JSON.stringify(b3, null, 2)}\n` +
    `规则：① in_flight<cap 且 recommended 非空 ⇒ 空槽必须报；② pool<floor 必须报；` +
    `③ nyf>0 且工作已落地 ⇒ done-flip 积压必须报；④ integration 领先 develop 且 suite 绿 ⇒ 该批量合；` +
    `⑤ suite red 必须报。**no-action 是需要举证的判词**：只有五条全为假才合法。\n` +
    `背离度：③ nyf 与 ② deficit 连续 K 轮不下降且同期 ① 至少翻转过一次 ⇒ K1 报外层 / K2 升级给人 / K3 关生产闸（不是 .halt，会死锁）。\n` +
    `row_summary 用中文，给 tick-log 那一行的"仲裁"列用，一两句，带上具体数字。`,
    { label: 'b3', phase: 'Judge', schema: B3_SCHEMA }
  ),
])

// ── 汇总全部用普通 JS（ADR-033：算术不进 agent）──────────────────────────────────
const violated = acVerdicts.filter(Boolean).filter((v) => v.status === '违反')
const unjudgeable = acVerdicts.filter(Boolean).filter((v) => v.status === '不可判')
const realBypass = hitVerdicts.filter(Boolean).filter((v) => v.verdict === 'real-bypass')

log(`AC: ${acVerdicts.length} 判 / ${violated.length} 违反 / ${unjudgeable.length} 不可判 | ` +
    `A16: ${hits.length} 命中 / ${realBypass.length} 真绕过 | B3: ${b3Verdict?.verdict}`)

return {
  acVerdicts,
  violatedAcs: violated.map((v) => v.id),
  unjudgeableAcs: unjudgeable.map((v) => v.id),
  a16: { hits: hits.length, realBypass: realBypass.length, detail: hitVerdicts },
  b3: b3Verdict,
}
