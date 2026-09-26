#!/usr/bin/env node
// psi-window-join.ts — 单测 PSI 时间窗联接工具（tasks/gap-perfile-psi-window-join）。
//
// THE QUESTION this script makes askable: 给定 {root, runId, file} 三元组，「这一个测试这一次跑
// 的时候，系统级 PSI(`cpu_stall`) 采样序列是什么」——以及它是否诚实地区分了「载体缺失/未命中」与
// 「查到了 0 个样本」。此前这个问题的唯一答法是每次手写一段联接脚本（gap 立案时当场手写过一次，
// 对 packages/quay/test/observation.test.mjs 的 147.5s 窗口取到 29 个采样点），没有可复用工具。
//
// APPROXIMATION (诚实标注, never implied exclusive): PSI 是 cgroup/系统级聚合量。同一时间窗口内若
// 有其他文件并发在跑，采到的 cpu_stall 反映全部并发负载的聚合读数，不是单个文件独有。本工具只做
// 「近似的时间窗联接」——把 .quay/verification-round.jsonl 的 perFile {file, startedAtMs, endedAtMs}
// 与 .quay/suite-load-<runId>.jsonl 的系统级周期采样 {t, cpu_stall}（约 1 秒一次，直接读
// /proc/pressure/cpu，不经过 cgroup diff，不受 transient scope 销毁影响）按时间窗取交集。它不是
// 「单测独占 PSI」，也不改 phases[].psi_cpu_total 的 cgroup-diff 路线（一次相边界内并发几百个文件，
// 聚合读数结构上无法拆到单文件）。
//
// FAIL-CLOSED (AC2/AC4, 复用 gap-psi-shadow-admission-controller 已坐实的纪律): 两个历史载体
// (.quay/verification-round.jsonl 与 .quay/suite-load-*.jsonl) 都是 gitignored——git worktree add
// 不带它们。载体缺失 ⇒ found:false + 明确 reason（提及 "not found"）+ CLI 退出码非 0，绝不把「缺
// 载体」伪装成「查到了 0 个样本」。载体在场、但窗口内确实 0 个采样 ⇒ found:true + sampleCount=0
// （诚实：查过了，真的没有）。
//
// REUSE (AC1/AC5): 窗口联接原语 windowMeanStall 是唯一实现（从 psi-failure-correlation-check.ts
// 抽出并成为其 import 来源），本文件不得、psi-failure-correlation-check.ts 也不再另写一份窗口聚合。
// 同理 resolveCarrierRoot 只有一份实现（perfile-failure-rate.ts），本文件 import 它 ——
// 此前「同一约定抄三份」的写法由 semantic-dedup-scan finding
// `resolve-carrier-root-three-byte-identical-silent-zero` 立案，本文件是三个落点之一。
//
// Exit codes (CLI): 0 = found:true（查到并返回采样序列）; 2 = usage error（缺 --run-id/--file）或
// found:false（载体缺失 / runId 未命中 / file 未命中）——fail-closed。
//
// Usage:
//   node --experimental-strip-types plugin/scripts/psi-window-join.ts \
//        --run-id <runId> --file <repo-relpath> [--root <repo-root>] [--json]
//   --run-id   the suite round id (matches a .quay/suite-load-<runId>.jsonl basename).
//   --file     repo-relative test path, as recorded in verification-round.jsonl perFile[].file.
//   --root     repo/carrier root (default: QUAY_MAIN_CHECKOUT → repoRoot()). Resolved by the SINGLE
//              shared resolveCarrierRoot, imported from perfile-failure-rate.ts.
//   --json     emit the raw result object as JSON.
//
//   import { joinFilePsiWindow } from "./psi-window-join.ts";
//   const r = joinFilePsiWindow(root, runId, file);
//   // r = { found:true, samples:[{t,cpu_stall}...], mean, max, sampleCount }
//   //   | { found:false, reason }

import fs from "node:fs";
import path from "node:path";
import { readJsonLines } from "./gate-script-base.ts";
import { resolveCarrierRoot } from "./perfile-failure-rate.ts";

export type PsiSample = { t: number; cpu_stall: number };

export type JoinResult =
  | { found: true; samples: PsiSample[]; mean: number; max: number; sampleCount: number }
  | { found: false; reason: string };

// loadRunSamples — read ONE runId's .quay/suite-load-<runId>.jsonl into {t, cpu_stall} samples
// (sorted ascending by t). Returns null when the carrier file is absent (caller reports found:false).
function loadRunSamples(root: string, runId: string): PsiSample[] | null {
  const file = path.join(root, ".quay", `suite-load-${runId}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const samples: PsiSample[] = [];
  for (const obj of readJsonLines(file)) {
    const t = obj.t as number | undefined;
    const cs = obj.cpu_stall as number | undefined;
    if (typeof t === "number" && Number.isFinite(t) && typeof cs === "number" && Number.isFinite(cs)) {
      samples.push({ t, cpu_stall: cs });
    }
  }
  samples.sort((a, b) => a.t - b.t);
  return samples;
}

// samplesInWindow — the reusable window-join primitive: samples whose t ∈ [startMs, endMs].
// Assumes `samples` sorted ascending by t (the suite-load loader guarantees it), so it can break
// early once a sample exceeds endMs.
export function samplesInWindow(samples: PsiSample[], startMs: number, endMs: number): PsiSample[] {
  const out: PsiSample[] = [];
  for (const s of samples) {
    if (s.t > endMs) break; // sorted ascending — nothing after this can be in-window
    if (s.t >= startMs) out.push(s);
  }
  return out;
}

// windowMeanStall — the CANONICAL window-join aggregation (mean cpu_stall over the window). This is
// the single definition shared with psi-failure-correlation-check.ts (which imports it; AC1/A5: 不得
// 有两份独立的窗口联接实现). Returns null when the window contains zero samples.
export function windowMeanStall(samples: PsiSample[], startMs: number, endMs: number): number | null {
  const inWindow = samplesInWindow(samples, startMs, endMs);
  if (inWindow.length === 0) return null;
  let sum = 0;
  for (const s of inWindow) sum += s.cpu_stall;
  return sum / inWindow.length;
}

// joinFilePsiWindow — the public query: 「这个测试这一次跑的时候，系统级 PSI 采样序列是什么」。
// fail-closed on missing carriers / missing perFile record; returns found:true + (possibly empty)
// sample series when both carriers are present and the file's window is resolved.
export function joinFilePsiWindow(root: string, runId: string, file: string): JoinResult {
  const vrf = path.join(root, ".quay", "verification-round.jsonl");
  if (!fs.existsSync(vrf)) {
    return { found: false, reason: `carrier not found: ${vrf}` };
  }

  let window: { startedAtMs: number; endedAtMs: number } | null = null;
  for (const raw of readJsonLines(vrf)) {
    if (typeof raw.runId !== "string" || raw.runId !== runId) continue;
    const pf = raw.perFile;
    if (!Array.isArray(pf)) continue;
    for (const r of pf as Record<string, unknown>[]) {
      if (String(r.file ?? "") !== file) continue;
      const s = r.startedAtMs as number | undefined;
      const e = r.endedAtMs as number | undefined;
      if (typeof s === "number" && Number.isFinite(s) && typeof e === "number" && Number.isFinite(e)) {
        window = { startedAtMs: s, endedAtMs: e };
        break;
      }
    }
    if (window) break;
  }
  if (!window) {
    return { found: false, reason: `perFile record not found for file="${file}" in runId="${runId}"` };
  }

  const samples = loadRunSamples(root, runId);
  if (samples === null) {
    return { found: false, reason: `suite-load carrier not found for runId="${runId}"` };
  }

  const inWindow = samplesInWindow(samples, window.startedAtMs, window.endedAtMs);
  const stallVals = inWindow.map((s) => s.cpu_stall);
  return {
    found: true,
    samples: inWindow,
    mean: stallVals.length === 0 ? Number.NaN : stallVals.reduce((a, b) => a + b, 0) / stallVals.length,
    max: stallVals.length === 0 ? Number.NaN : Math.max(...stallVals),
    sampleCount: inWindow.length,
  };
}

// resolveCarrierRoot is IMPORTED (single definition in perfile-failure-rate.ts) — see the REUSE note
// in the header. It used to be a private byte-identical copy of the same 4-line convention here, and
// a copy of the same convention in psi-failure-correlation-check.ts (semantic-dedup-scan finding
// `resolve-carrier-root-three-byte-identical-silent-zero`): three homes for ONE rule meant a change
// to the resolution order landing in one copy only, silently, in the other two.

function parseArgs(argv: string[]) {
  const out = { runId: "", file: "", root: "", json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--run-id" && v) { out.runId = v; i++; }
    else if (a === "--file" && v) { out.file = v; i++; }
    else if (a === "--root" && v) { out.root = v; i++; }
    else if (a === "--json") out.json = true;
  }
  return out;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "n/a";
}

function printText(args: ReturnType<typeof parseArgs>, r: JoinResult): void {
  if (r.found) {
    console.log(`found:true  runId=${args.runId}  file=${args.file}`);
    console.log(`sampleCount=${r.sampleCount}  mean=${fmt(r.mean)}  max=${fmt(r.max)}`);
    for (const s of r.samples) console.log(`  t=${s.t}  cpu_stall=${s.cpu_stall.toFixed(2)}`);
  } else {
    console.log(`found:false  reason=${r.reason}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "psi-window-join.ts — 单测 PSI 时间窗联接（回答「这个测试这次跑的时候机器多忙」）\n" +
      "usage: node --experimental-strip-types plugin/scripts/psi-window-join.ts " +
      "--run-id <runId> --file <repo-relpath> [--root <repo-root>] [--json]\n"
    );
    return;
  }
  if (!args.runId || !args.file) {
    process.stderr.write("error: --run-id and --file are required\n");
    process.exitCode = 2;
    return;
  }
  const root = resolveCarrierRoot(args.root);
  const result = joinFilePsiWindow(root, args.runId, args.file);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printText(args, result);
  }
  if (!result.found) process.exitCode = 2; // fail-closed: not-found is not an empty-but-valid result
}

const isDirect =
  process.argv[1] && path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "psi-window-join";
if (isDirect) {
  main();
}
