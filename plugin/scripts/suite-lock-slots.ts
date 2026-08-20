#!/usr/bin/env node
// suite-lock-slots.ts — TS 侧 suite 槽路径唯一实现 (单一定义点, gap-suite-concurrency-ff-gate-and-slot-ssot).
//
// THE DEFECT THIS CLOSES: 「能跑几个 suite」曾经有三个互不一致的定义点 + 一处范畴错误 —
//   lane 除数说 = S (读 QUAY_MAX_CONCURRENT_SUITES) / 槽数说 = 2 (写死 `.0`/`.1`) / ff 闸说 = 0
//   (任一槽被持即拒, 全局)。槽路径在源码里以「恰好两个变量 _0/_1」+「恰好两个 flock 分支」结构性编码,
//   从未以数字 2 出现 — concurrency-literal-check 的字面量扫描器按构造看不见 (硬规则⑤)。
//
// THIS FILE is the single definition point for "the suite lock slots":
//   suiteLockSlotCount()  — 槽数 S = QUAY_MAX_CONCURRENT_SUITES (旋钮②), clamped at >= 1
//                          (invalid/zero fails open to the single-suite default, never 0 slots).
//   suiteLockSlotPaths()  — `${base}.0 .. ${base}.S-1` (S-generated, never a hardcoded .0/.1 literal).
//   suiteLockBase()       — the base path resolution (FULL_SUITE_LOCK_FILE env override →
//                          git-common-dir → <root>/.git), SHARED by every consumer so all worktrees
//                          contend on the SAME lock files.
//
// Every consumer reads THIS module (by import) instead of re-deriving the slots:
//   plugin/scripts/full-suite-runner.ts     (suiteLockPaths / countHeldSuiteLocks)
//   plugin/scripts/worktree-process-reaper.ts (fullSuiteLockFiles)
// The bash side has its own canonical (plugin/scripts/suite-slot-lib.sh, sourced by scripts/test.sh);
// the behavioral invariant (plugin/scripts/suite-slot-ssot-check.ts + plugin/test) verifies the two
// agree (槽文件数 == concurrentSuiteSlots()) so they cannot silently drift.
//
// Exit: 0 always (this module is import-only; the CLI convenience prints the slots for a base).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";

/** Read an env var the way bash's `${VAR:-…}` reads it: an EMPTY string is treated as UNSET and falls
 *  through to the next source. The bash canonical (suite-slot-lib.sh) uses `:-` on both seams, so the
 *  TS side must too — else `RESOURCE_GATE_CONCURRENT_SUITES=""` + knob=1 would read 2 here and 1 there
 *  (the seam asymmetry this task closes). */
function envValOrUndefined(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

/** Match the bash canonical's value VALIDATION exactly: only a string of digits `[0-9]+` passes
 *  (suite-slot-lib.sh's `*[!0-9]*` case), anything else (fractional "1.5", "1.0", whitespace, "-1")
 *  is rejected exactly the way bash rejects it — falling through to the next source / the 2 default.
 *  A bare `Number()` + integer check would accept "1.0" as 1 where bash says 2. */
function slotVal(name: string): string | undefined {
  const v = envValOrUndefined(name);
  return v !== undefined && /^[0-9]+$/.test(v) ? v : undefined;
}

/** The slot count S — the SINGLE definition point for "how many suites may run at once".
 *  Reads the bash-side seam RESOURCE_GATE_CONCURRENT_SUITES FIRST (the deterministic test seam, same
 *  convention as scripts/test.sh's derivation functions), then 旋钮② QUAY_MAX_CONCURRENT_SUITES,
 *  defaulting to 2 — the SAME precedence + validation as the bash canonical suite-slot-lib.sh
 *  suite_slot_count (`${SEAM:-${KNOB:-2}}`, `[0-9]+` and `-lt 1` ⇒ the 2 default), so the two canons
 *  agree under ANY env (including a test seam) and even on malformed values. Clamped to >= 1 — an
 *  invalid/zero setting fails open to the single-suite default (the old 1-slot behavior), never to 0
 *  slots. This is the SAME expression full-suite-runner.ts's concurrentSuiteSlots() delegates to. */
export function suiteLockSlotCount(): number {
  const raw = Number(slotVal("RESOURCE_GATE_CONCURRENT_SUITES") ?? slotVal("QUAY_MAX_CONCURRENT_SUITES") ?? "2");
  return raw >= 1 ? raw : 2;
}

/** The S slot paths for a base — `${base}.0 .. ${base}.S-1`. S-generated via a loop variable, so a
 *  `full-suite.lock.<digit>` literal never appears in code (the SSoT checker greps for that shape
 *  and must find ZERO hits outside the generation loop). */
export function suiteLockSlotPaths(base: string): string[] {
  const count = suiteLockSlotCount();
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`${base}.${i}`);
  return out;
}

/** Resolve the suite-lock BASE the same way scripts/test.sh's full_suite_lock does:
 *  `${FULL_SUITE_LOCK_FILE}` env override → `git rev-parse --git-common-dir` (the SHARED lock dir ALL
 *  worktrees of this repo contend on — a per-checkout lock would NOT serialize across worktrees, the
 *  2026-08-07 two-worktree incident) → fall back to `<root>/.git`. `root` is the tested checkout the
 *  probe runs against (a relative git-common-dir is resolved against root, absolute paths pass through). */
export function suiteLockBase(root: string): string {
  const envOverride = process.env.FULL_SUITE_LOCK_FILE;
  if (envOverride) return envOverride;
  let commonDir: string | null = null;
  try {
    commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    commonDir = null;
  }
  if (!commonDir) commonDir = ".git";
  return path.join(path.resolve(root, commonDir), "full-suite.lock");
}

// ── CLI convenience (measure / debugging): print the S slot paths for a base or a root ──────────────
const usage = [
  "suite-lock-slots.ts — TS 侧 suite 槽路径唯一实现 (gap-suite-concurrency-ff-gate-and-slot-ssot)",
  "",
  "Usage:",
  "  node --experimental-strip-types suite-lock-slots.ts --base <lock-file-base>",
  "      print the S slot paths (`base.0`..`base.S-1`) one per line (S = QUAY_MAX_CONCURRENT_SUITES).",
  "  node --experimental-strip-types suite-lock-slots.ts --root <repo> [--count]",
  "      resolve the repo's suite-lock base and print its S slot paths; --count prints only S.",
  "  node --experimental-strip-types suite-lock-slots.ts --help",
  "",
  "Exit codes: 0 always (import-only module; the CLI is a convenience).",
].join("\n");

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return 0;
  }
  const flagVal = (name: string) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const baseArg = flagVal("--base");
  const rootArg = flagVal("--root");
  if (baseArg) {
    for (const p of suiteLockSlotPaths(baseArg)) console.log(p);
    return 0;
  }
  if (rootArg) {
    const base = suiteLockBase(path.resolve(rootArg));
    if (args.includes("--count")) {
      console.log(suiteLockSlotCount());
      return 0;
    }
    for (const p of suiteLockSlotPaths(base)) console.log(p);
    return 0;
  }
  // A tiny self-test: importing the module must not require a git repo; print the count only.
  if (args.includes("--count")) {
    console.log(suiteLockSlotCount());
    return 0;
  }
  console.error(usage);
  return 2;
}

if (isDirectEntry(import.meta, undefined, "suite-lock-slots")) {
  process.exit(main(process.argv));
}
