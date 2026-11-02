// transcript-set.mjs — the ONE implementation of "a session transcript, plus its subagents".
//
// 内层把任务派给 subagent 执行，而 subagent 的工具调用**不在主 transcript 里**——它们在
// <会话 UUID>/subagents/agent-*.jsonl。2026-08-02 实测：cost-model 派发后主 transcript 里
// 全量套件 0 命中，而 subagent transcript 正在活跃写入。不合并这些文件，任何 transcript
// 消费者在最需要它的场景（核实被委派的工作 / 审计外层派出的 subagent）都会给出「0 命中」的假结论。
//
// 为什么是 plugin/scripts 下的 `.mjs` sibling，而不是 packages/quay 内的 import：两个消费者都要能
// `node <file>` 单独跑、并随插件包发布，故本文件只 import `node:` 内建（无仓内依赖）。
// 例程 `semantic-dedup-scan` 在 2026-09-17 / 2026-09-28 / 2026-10-29 三次以
// `byte-identical-body`（Jaccard 1.0，202 vs 206 chars）报出同一份重复
// （finding `transcript-set-copy`，runId `semantic-dedup-scan-1793251416079`）——
// 处置就是把两份合成这一份；`plugin/test/transcript-set-single-implementation.test.mjs`
// 是防止它再分裂回两份的结构判据。
//
// 两个消费者（⛔ 不要再各自复制一份 body）：
//   - plugin/scripts/inner-forensics.mjs               （内层取证）
//   - plugin/scripts/manager-observation-runtime-check.ts（C3 运行时约束）

import fs from "node:fs";
import path from "node:path";

/**
 * The transcript file itself plus every `*.jsonl` under its `subagents/` sibling directory.
 * A missing `subagents/` dir is normal (sessions that never dispatched a subagent) — not an error;
 * an unreadable dir is swallowed for the same reason (the caller still scans the main transcript).
 *
 * @param {string} file path to a session transcript (`<session>.jsonl`)
 * @returns {string[]} the set of transcript paths to scan, main file first
 */
export function transcriptSet(file) {
  const set = [file];
  const dir = file.replace(/\.jsonl$/, "") + "/subagents";
  try {
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".jsonl")) set.push(path.join(dir, f));
  } catch { /* 无 subagent 目录 */ }
  return set;
}
