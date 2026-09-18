#!/usr/bin/env node
// suite-lock-slots.ts — TS 侧 suite 槽路径唯一实现 (单一定义点, gap-suite-concurrency-ff-gate-and-slot-ssot).
//
// THE DEFECT THIS CLOSES: 「能跑几个 suite」曾经有三个互不一致的定义点 + 一处范畴错误 —
//   lane 除数说 = S (读 QUAY_MAX_CONCURRENT_SUITES) / 槽数说 = 2 (写死 `.0`/`.1`) / ff 闸说 = 0
//   (任一槽被持即拒, 全局)。槽路径在源码里以「恰好两个变量 _0/_1」+「恰好两个 flock 分支」结构性编码,
//   从未以数字 2 出现 — concurrency-literal-check 的字面量扫描器按构造看不见 (硬规则⑤)。
//
// THIS FILE is the single definition point for "the suite lock slots":
//   suiteLockSlotCount()  — 槽数 S, clamped at >= 1 (invalid/zero fails open to the single-suite
//                          default, never 0 slots). S precedence (same on the bash canonical):
//                          RESOURCE_GATE_CONCURRENT_SUITES (test seam env) →
//                          `<suiteLockBase>.concurrency` (scalar file, fresh read every call —
//                          gap-suite-concurrency-env-to-file-fresh-read: env is forked once per
//                          process, a file is re-read by the next detached suite process without a
//                          restart) → QUAY_MAX_CONCURRENT_SUITES (env 旋钮②, transition period) → 1.
//   suiteLockSlotPaths()  — `${base}.0 .. ${base}.S-1` (S-generated, never a hardcoded .0/.1 literal).
//   suiteLockBase()       — the base path resolution (FULL_SUITE_LOCK_FILE env override →
//                          git-common-dir → <root>/.git), SHARED by every consumer so all worktrees
//                          contend on the SAME lock files. The `.concurrency` file lives NEXT TO this
//                          base (`${base}.concurrency`) so it uses the SAME path resolution.
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
// flagVal (below) is now a one-line arity adapter over the shared `flagValue`; its algorithm was one
// of the ~73 hand-written copies of the indexOf+next-arg idiom in plugin/scripts
// (.quay/routine-findings.jsonl finding `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";

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

/** Clamp a validated numeric string to >= 1 — an invalid/zero setting fails open to the single-suite
 *  default (the old 1-slot behavior), never to 0 slots. Callers pass only `[0-9]+`-validated values
 *  (from slotVal / fileSlotVal), so `Number()` never sees a fractional or NaN form. */
function clampCount(v: string): number {
  const raw = Number(v);
  return raw >= 1 ? raw : 1;
}

/** Read the `.concurrency` scalar file NEXT TO the suite-lock base: `${base}.concurrency` (e.g. a
 *  `full-suite.lock.concurrency` next to `full-suite.lock.0/.1`). The file holds a PURE digit like
 *  `"1"` — read RAW (`fs.existsSync && fs.readFileSync(...).trim()`, NO YAML, NO parser), the same
 *  raw-read shape the bash canonical uses (`[ -f "$f" ] && cat "$f"`), so the I4 dual-implementation
 *  cross-check stays honest (故意双实现算同一个数 — 不引入 YAML 依赖, 不让 bash 转调 node).
 *  Returns undefined when the file is absent OR its content is not a pure digit (falls through to the
 *  next source / the 2 default — a malformed file never fabricates a slot count). `base` is optional:
 *  when omitted it is resolved from `suiteLockBase(process.cwd())`, so a bare `suiteLockSlotCount()`
 *  (e.g. the I4 checker) and the bash `suite_slot_count` with no arg resolve the SAME file. */
function fileSlotVal(base?: string): string | undefined {
  const b = base ?? suiteLockBase(process.cwd());
  const file = `${b}.concurrency`;
  if (!fs.existsSync(file)) return undefined;
  const v = fs.readFileSync(file, "utf8").trim();
  return v !== "" && /^[0-9]+$/.test(v) ? v : undefined;
}

/** The slot count S — the SINGLE definition point for "how many suites may run at once".
 *  Precedence (identical on the bash canonical suite-slot-lib.sh `suite_slot_count`):
 *    1. RESOURCE_GATE_CONCURRENT_SUITES — the deterministic test seam env (same convention as
 *       scripts/test.sh's derivation functions). Empty-string-as-unset (`:-`), invalid falls through.
 *    2. `<base>.concurrency` — the scalar file, fresh-read every call (no restart needed for the next
 *       detached suite process to pick up a new S). Reads the file at the SAME base the slot paths use.
 *    3. QUAY_MAX_CONCURRENT_SUITES — env 旋钮② (transition period; the file now has priority over it).
 *    4. Default 1.
 *  Clamped to >= 1 — an invalid/zero setting fails open to the single-suite default (the old 1-slot
 *  behavior), never to 0 slots. This is the SAME expression full-suite-runner.ts's
 *  concurrentSuiteSlots() delegates to. `base` is optional — pass it when the caller already resolved
 *  it (suiteLockSlotPaths), so the file is read from THAT base and never re-resolves git-common-dir
 *  (a cwd-resolution would be a different base than the slot paths' own base). */
export function suiteLockSlotCount(base?: string): number {
  const seam = slotVal("RESOURCE_GATE_CONCURRENT_SUITES");
  if (seam !== undefined) return clampCount(seam);
  const file = fileSlotVal(base);
  if (file !== undefined) return clampCount(file);
  const knob = slotVal("QUAY_MAX_CONCURRENT_SUITES");
  if (knob !== undefined) return clampCount(knob);
  return 1;
}

/** The S slot paths for a base — `${base}.0 .. ${base}.S-1`. S-generated via a loop variable, so a
 *  `full-suite.lock.<digit>` literal never appears in code (the SSoT checker greps for that shape
 *  and must find ZERO hits outside the generation loop). The count is read AT `base` (not re-resolved
 *  from cwd), so the `.concurrency` file read and the slot paths always share the same base. */
export function suiteLockSlotPaths(base: string): string[] {
  const count = suiteLockSlotCount(base);
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
  "      print the S slot paths (`base.0`..`base.S-1`) one per line (S = seam → `<base>.concurrency` → knob → 1).",
  "  node --experimental-strip-types suite-lock-slots.ts --root <repo> [--count]",
  "      resolve the repo's suite-lock base and print its S slot paths; --count prints only S (the",
  "      `.concurrency` file next to the resolved base is honored — the AC3 negative-control surface).",
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
  /** Arity-1 adapter over the shared `flagValue`: this closure captures the local `args` slice. */
  const flagVal = (name: string): string | undefined => flagValue(args, name);
  const baseArg = flagVal("--base");
  const rootArg = flagVal("--root");
  if (baseArg) {
    for (const p of suiteLockSlotPaths(baseArg)) console.log(p);
    return 0;
  }
  if (rootArg) {
    const base = suiteLockBase(path.resolve(rootArg));
    if (args.includes("--count")) {
      console.log(suiteLockSlotCount(base)); // read the `.concurrency` file at this base (AC3 negative control)
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
