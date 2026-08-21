#!/usr/bin/env node
// suite-slot-ssot-check.ts — suite 并发量单一定义点行为层不变量
// (tasks/gap-suite-concurrency-ff-gate-and-slot-ssot, AC4 — 人 2026-08-18「把系统真正做对」).
//
// THE DEFECT THIS CLOSES: 「能跑几个 suite」曾经有三个互不一致的定义点 + 一处范畴错误 (lane 除数说 = S /
// 槽数说 = 2 写死 / ff 闸说 = 0 全局), 三者靠散文注释维系, 零可执行不变量。槽数 2 在源码里从未以数字 2
// 出现 — 被编码成「恰好两个变量 _0/_1」+「恰好两个 flock 分支」, concurrency-literal-check 的字面量扫描器
// 按构造看不见 (硬规则⑤: 同一容器两类 population, 只用覆盖其一的工具判空会把非空读成空)。⇒ 字面量检查
// 没用, 不变量必须在行为层陈述。
//
// THIS CHECKER makes the behavioral invariants mechanical (each can take false):
//   I1 — ff 闸不引用任何跨任务 suite 状态 (按位置): fan-in-ff-merge.sh 的 CODE (comments/strings masked)
//       不得出现 `full-suite.lock`。ff 闸只读本任务 suite capture (AC1 收窄), 不读全局锁。
//   I2 — 全仓不得存在除唯一槽路径实现外的 `full-suite.lock.<数字>` 字面量 (按位置 grep 槽文件名模式):
//       槽路径由 canonical 以循环变量生成 (`base.${i}`), 字面量 `.0`/`.1` 出现即违规 — 直接对着表现
//       形式, 不依赖谁读 S (能同时抓住 test.sh:1067 与 full-suite-runner.ts:1632 的注释断言同形)。
//   I3 — 四处消费者全部改读唯一实现:
//         scripts/test.sh              source plugin/scripts/suite-slot-lib.sh   (bash canonical)
//         full-suite-runner.ts         import ./suite-lock-slots.ts              (TS canonical)
//         worktree-process-reaper.ts   import ./suite-lock-slots.ts              (TS canonical)
//         fan-in-ff-merge.sh           covered by I1 (不得引用任何 suite 锁).
//   I4 — bash canonical 与 TS canonical 的槽数一致 (runtime 跨语言对照): suite_slot_count (bash) ==
//       suiteLockSlotCount() (TS) under the same env — the two canons cannot silently drift.
//   I5 — 运行时并发 suite 数 ≤ S (行为层): 对隔离锁基并发跑 N=S+2 个槽获取者, 实测持槽数 ≤ S
//       (gap-suite-slot-lock-not-enforcing-concurrency AC1/AC3)。排他性被【执行】而非【断言】——
//       flock 一旦非独占, 全部 N 个获取者同时持槽 ⇒ 红 (4-concurrent-suite 的实相)。
//
// MODES:
//   --gate [--root <dir>]   gate mode (wired into scripts/test.sh run_static_checks). Exit 1 iff any
//                           invariant is RED.
//   --scan [--root <dir>]   measure mode — print every check's verdict. Exit 0 always.
//   --json                  machine-readable output.
// Exit codes: 0 = PASS / measure, 1 = gate FAIL (>=1 RED), 2 = usage/env error.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
import { suiteLockSlotCount, suiteLockBase } from "./suite-lock-slots.ts";

/** I2 — the slot-path literal shapes in CODE positions (直接对着表现形式 — the 槽文件名模式). The
 *  canonical generation loops emit `${base}.${i}` (a variable digit) and the variable is never named
 *  `FULL_SUITE_LOCK_<digit>`, so BOTH patterns must match ZERO hits:
 *   (a) the contiguous literal `full-suite.lock.<digit>` (the old worktree-process-reaper form);
 *   (b) the numbered variable `FULL_SUITE_LOCK_<digit>` (the old scripts/test.sh _0/_1 form). */
export const SLOT_PATH_LITERAL_RE = /full-suite\.lock\.\d+/g;
export const SLOT_PATH_VAR_RE = /FULL_SUITE_LOCK_[0-9]/g;
/** I1 — the ff gate must not reference the global suite lock at all (base OR a numbered slot). */
export const FF_SUITE_LOCK_RE = /full-suite\.lock/g;

/** The executable surface — the same explicit enumeration concurrency-literal-check scans (plugin/
 *  scripts + scripts + .claude/workflows + plugin/workflows; docs and tests excluded — tests
 *  legitimately spell `full-suite.lock.0` as a fixture name). */
const SCAN_ROOTS: Array<{ dir: string; rel: string; ext: RegExp }> = [
  { dir: "plugin/scripts", rel: "plugin/scripts", ext: /\.(ts|sh)$/ },
  { dir: "scripts", rel: "scripts", ext: /\.(ts|sh)$/ },
  { dir: ".claude/workflows", rel: ".claude/workflows", ext: /\.js$/ },
  { dir: "plugin/workflows", rel: "plugin/workflows", ext: /\.js$/ },
];

export function scanSurface(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, base: string, ext: RegExp) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const abs = path.join(dir, f);
      const s = fs.statSync(abs);
      if (s.isDirectory()) {
        if (f === "node_modules" || f === ".git" || f === "test" || f === "checker-mutation-cases") continue;
        walk(abs, path.join(base, f), ext);
      } else if (ext.test(f)) {
        out.push(path.join(base, f));
      }
    }
  };
  for (const { dir, rel, ext } of SCAN_ROOTS) walk(path.join(root, dir), rel, ext);
  return out.sort();
}

/** Comment-only mask (line slashes, block slashes-star, and shell `#`) — strings/template literals
 *  are NOT masked (a hardcoded slot path inside a string IS a runtime value, the I2 manifestation). */
export function buildCommentMask(src: string, isShell: boolean): Uint8Array {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      mask[i] = 1; mask[i + 1] = 1; i += 2;
      while (i < n && src[i] !== "\n") { mask[i] = 1; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      mask[i] = 1; mask[i + 1] = 1; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { mask[i] = 1; i++; }
      if (i < n) { mask[i] = 1; mask[i + 1] = 1; i += 2; }
      continue;
    }
    if (isShell && c === "#") {
      const prev = i === 0 ? "\n" : src[i - 1];
      if (/\s/.test(prev)) { while (i < n && src[i] !== "\n") { mask[i] = 1; i++; } continue; }
    }
    i++;
  }
  return mask;
}

/** Comment-excluded scan of one file for a pattern: a hit is REPORTED unless its start is inside a
 *  comment (strings/template literals count as code — the I1/I2 manifestation is a runtime path value:
 *  the old ff gate and the hardcoded slot paths both lived in strings). */
export function scanCommentsExcluded(src: string, re: RegExp, isShell: boolean): Array<{ index: number; text: string }> {
  const mask = buildCommentMask(src, isShell);
  const out: Array<{ index: number; text: string }> = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(src)) !== null) {
    const start = m.index;
    if (start < mask.length && mask[start] === 1) { if (m[0].length === 0) rx.lastIndex++; continue; }
    out.push({ index: start, text: m[0] });
    if (m[0].length === 0) rx.lastIndex++;
  }
  return out;
}

export interface SsotVerdict {
  id: string;
  ok: boolean;
  evaluated: boolean;
  detail: string;
}

/** The declared-exception marker token (a hit whose line or attached comment block carries this is a
 *  NON-slot-path reference — e.g. a retired-clause archive marker that spells the old suite-lock name
 *  as historical text, never generating/reading a slot path). Same mechanism as concurrency-literal-
 *  check's `concurrency-default-fallback` (禁「悄悄写死」, 不禁「有理由的引用」). */
export const EXCEPTION_MARKER = "suite-slot-ssot-exception";

/** The marker token appears in the hit line or in the attached comment block (the contiguous comment
 *  lines immediately above the hit — a marker glued to a DIFFERENT declaration several lines up must
 *  not authorize this hit). */
export function carriesExceptionMarker(srcLines: string[], hitLineIdx: number): boolean {
  const block: string[] = [srcLines[hitLineIdx] ?? ""];
  for (let i = hitLineIdx - 1; i >= 0; i--) {
    const t = srcLines[i].trim();
    if (t === "") continue;
    if (/^(\/\/|\*|#)/.test(t)) { block.push(srcLines[i]); continue; }
    break;
  }
  return block.some((l) => l.includes(EXCEPTION_MARKER));
}

/** I2 — no hardcoded slot-path literal anywhere in the executable surface's CODE. */
export function checkNoSlotPathLiterals(root: string): SsotVerdict {
  const files = scanSurface(root);
  const violations: Array<{ file: string; line: number; text: string }> = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    const isShell = rel.endsWith(".sh");
    const srcLines = src.split("\n");
    const collect = (h: { index: number; text: string }) => {
      const line = src.slice(0, h.index).split("\n").length;
      if (carriesExceptionMarker(srcLines, line - 1)) return; // declared exception — not a slot-path
      violations.push({ file: rel, line, text: h.text });
    };
    for (const h of scanCommentsExcluded(src, SLOT_PATH_LITERAL_RE, isShell)) collect(h);
    for (const h of scanCommentsExcluded(src, SLOT_PATH_VAR_RE, isShell)) collect(h);
  }
  if (violations.length === 0) {
    return { id: "I2", ok: true, evaluated: true, detail: "no full-suite.lock.<digit> literal nor FULL_SUITE_LOCK_<digit> variable in code across the surface (0 violations)" };
  }
  return {
    id: "I2", ok: false, evaluated: true,
    detail: `hardcoded slot-path form found in code (槽路径必须由 canonical 以循环变量生成): ${violations.map((h) => `${h.file}:${h.line} ${h.text}`).join("; ")}`,
  };
}

/** I1 — fan-in-ff-merge.sh's CODE/STRING must not reference the global suite lock at all. A reference
 *  inside a string literal IS a red flag (the old gate read `full-suite.lock.0/.1` from strings);
 *  only a comment mention (doc) is ignored — hence scanCommentsExcluded, not the full code mask. */
export function checkFfNoGlobalSuiteLock(root: string): SsotVerdict {
  const rel = "plugin/scripts/fan-in-ff-merge.sh";
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    return { id: "I1", ok: false, evaluated: false, detail: `${rel} not found (cannot judge — NOT-EVALUATED, never conflated with green)` };
  }
  const src = fs.readFileSync(abs, "utf8");
  const hits = scanCommentsExcluded(src, FF_SUITE_LOCK_RE, true);
  if (hits.length === 0) {
    return { id: "I1", ok: true, evaluated: true, detail: `${rel} code contains no 'full-suite.lock' read (ff 闸只读本任务 capture)` };
  }
  return {
    id: "I1", ok: false, evaluated: true,
    detail: `${rel} code references the global suite lock ${hits.length}× (${hits.map((h) => `@${h.index}`).join(", ")}) — the ff 闸 must not read any cross-task suite state (AC1)`,
  };
}

/** I3 — the consumers read the canonical implementation (by import/source). */
export function checkConsumersReadCanonical(root: string): SsotVerdict {
  const reads = (rel: string, needles: string[]): string | null => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return `missing ${rel}`;
    const src = fs.readFileSync(abs, "utf8");
    for (const n of needles) if (src.includes(n)) return null;
    return `${rel} does not reference the canonical (needles: ${needles.join(", ")})`;
  };
  const problems: string[] = [];
  const t1 = reads("scripts/test.sh", ["suite-slot-lib.sh"]);
  if (t1) problems.push(t1);
  const t2 = reads("plugin/scripts/full-suite-runner.ts", ["suite-lock-slots.ts"]);
  if (t2) problems.push(t2);
  const t3 = reads("plugin/scripts/worktree-process-reaper.ts", ["suite-lock-slots.ts"]);
  if (t3) problems.push(t3);
  if (problems.length === 0) {
    return { id: "I3", ok: true, evaluated: true, detail: "scripts/test.sh sources suite-slot-lib.sh; full-suite-runner.ts + worktree-process-reaper.ts import suite-lock-slots.ts (fan-in-ff-merge.sh covered by I1)" };
  }
  return { id: "I3", ok: false, evaluated: true, detail: `consumer(s) do not read the canonical: ${problems.join("; ")}` };
}

/** I4 — the bash canonical and the TS canonical agree on the slot count under the same env
 *  (a cross-language drift detector — the two canons cannot silently diverge). */
export function checkBashTsCountAgree(root: string): SsotVerdict {
  const lib = path.join(root, "plugin", "scripts", "suite-slot-lib.sh");
  if (!fs.existsSync(lib)) {
    return { id: "I4", ok: false, evaluated: false, detail: "suite-slot-lib.sh not found (cannot judge)" };
  }
  const ts = suiteLockSlotCount();
  // NOTE: since gap-suite-lock-slot-seam-asymmetry + gap-suite-concurrency-env-to-file-fresh-read,
  // BOTH canons read the same precedence — RESOURCE_GATE_CONCURRENT_SUITES (test seam) →
  // `<suiteLockBase>.concurrency` (scalar file, fresh-read) → QUAY_MAX_CONCURRENT_SUITES (旋钮②) → 2,
  // with empty-string-as-unset (`:-`) on both. They therefore agree under ANY env AND any
  // `.concurrency` file (production or a test seam); a drift here means one side's semantics changed
  // independently, which is exactly what I4 detects. The file read is RAW on both sides (`[ -f ] &&
  // cat` / `fs.existsSync && readFileSync().trim()`) — no YAML, no bash→node delegation — so I4
  // stays an honest dual-implementation cross-check (硬规则④: never a self-referential single read).
  const file = `${suiteLockBase(process.cwd())}.concurrency`;
  const fileState = fs.existsSync(file)
    ? `file ${path.basename(file)}=${fs.readFileSync(file, "utf8").trim() || "<empty>"}`
    : "file <absent>";
  const res = spawnSync("bash", ["-c", `source "${lib}"; suite_slot_count`], { encoding: "utf8", env: process.env });
  if (res.status !== 0) {
    return { id: "I4", ok: false, evaluated: false, detail: `suite_slot_count failed: ${res.stderr}` };
  }
  const bashCount = Number(res.stdout.trim());
  if (!Number.isFinite(bashCount) || bashCount < 1) {
    return { id: "I4", ok: false, evaluated: false, detail: `suite_slot_count returned non-positive '${res.stdout.trim()}'` };
  }
  if (bashCount === ts) {
    return { id: "I4", ok: true, evaluated: true, detail: `bash canonical suite_slot_count=${bashCount} == TS canonical suiteLockSlotCount=${ts} (${fileState}; env QUAY_MAX_CONCURRENT_SUITES=${process.env.QUAY_MAX_CONCURRENT_SUITES ?? "<unset>"})` };
  }
  return { id: "I4", ok: false, evaluated: true, detail: `bash canonical suite_slot_count=${bashCount} != TS canonical suiteLockSlotCount=${ts} (${fileState}) — the two canons drifted` };
}

/** I5 — the runtime concurrency cap (behavioral, not asserted): spawn N = S+2 concurrent slot
 *  acquirers against a HERMETIC temp lock base (never the real git-common-dir lock, so it can never
 *  contend with a live suite) and count how many hold a slot simultaneously. With an EXCLUSIVE flock
 *  exactly S acquire (the rest block on `flock -n`); if the flock is made non-exclusive (the
 *  `flock -s` shared injection, or the slot logic broken) all N acquire ⇒ acquired > S ⇒ RED. The
 *  exclusivity is EXERCISED, not read off a comment — it can take false (AC3).
 *
 *  The probe's slot COUNT is pinned to the checker's S via a `.concurrency` file at the hermetic base
 *  (plus a sanitized probe env) — without that pin the holders resolve their own count from the
 *  ambient env (default 2), which drifts from a production `.concurrency` file (e.g. S=1) ⇒ the probe
 *  contends on 2 slots while the checker compares against 1 ⇒ FALSE RED while real suites queue
 *  (gap-suite-slot-ssot-i5-false-positive: the reported "2/3 held (> S=1)" with a healthy host). */
export interface ConcurrencyProbeResult {
  acquired: number;
  status: number;
  stderr: string;
}

/** Generate a holder script that acquires one slot via the bash canonical (suite_slot_paths) and
 *  reports `acquired`/`blocked`, then holds ~400ms so the N concurrent holders overlap. `flockFlag`
 *  selects the lock MODE: `-n` = exclusive non-blocking (the real mechanism), `-s -n` = shared
 *  non-blocking (the falsifiability injection — all N acquire, proving the verdict can go RED). */
export function holderScript(lib: string, flockFlag: string): string {
  return `#!/usr/bin/env bash
source "${lib}"
_base="\$1"; _out="\$2"
_slots=()
while IFS= read -r _s; do _slots+=("\$_s"); done < <(suite_slot_paths "\$_base")
_fds=()
for _s in "\${_slots[@]}"; do exec {_fd}>"\$_s"; _fds+=("\$_fd"); done
_held=""
for _fd in "\${_fds[@]}"; do if flock ${flockFlag} "\$_fd"; then _held=1; break; fi; done
if [ -n "\$_held" ]; then echo acquired > "\$_out"; else echo blocked > "\$_out"; fi
sleep 0.4
`;
}

/** Run N concurrent acquirers (each `bash <holderScript> <base> <outFile>`) and count `acquired`.
 *  Pure orchestration — the holder's lock mode is the caller's choice, so the falsifiability test
 *  can inject a shared-mode holder and observe acquired == N (the RED half of AC3). `env` lets the
 *  caller pin the holder subprocess's environment (the I5 checker sanitizes it so the hermetic base's
 *  `.concurrency` file is authoritative — ambient seam/knob cannot shadow it). */
export function runConcurrencyProbe(script: string, base: string, N: number, env: NodeJS.ProcessEnv = process.env): ConcurrencyProbeResult {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "suite-slot-i5-"));
  const hs = path.join(tmp, "holder.sh");
  fs.writeFileSync(hs, script);
  const driver = `set -u\nfor i in $(seq 1 ${N}); do bash "${hs}" "${base}" "${tmp}/r\${i}.txt" & done\nwait\n`;
  const res = spawnSync("bash", ["-c", driver], { encoding: "utf8", timeout: 15000, env });
  let acquired = 0;
  for (let i = 1; i <= N; i++) {
    const f = path.join(tmp, `r${i}.txt`);
    if (fs.existsSync(f) && fs.readFileSync(f, "utf8").trim() === "acquired") acquired++;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  // A spawn error/timeout (`res.error`, `status === null`) must NOT be conflated with a clean exit
  // (status 0) — reading a failed probe as GREEN is the 硬规则 3b shape (读不懂 ⇒ 与合格同形). Sentinel
  // status -1 is never a real exit code, so the caller's `status !== 0` guard routes it to NOT-EVALUATED.
  if (res.error) return { acquired, status: -1, stderr: res.error.message };
  return { acquired, status: res.status ?? 0, stderr: res.stderr ?? "" };
}

/** I5 — S+2 concurrent acquirers, at most S may hold (exclusive flock). RED iff acquired > S.
 *  The probe is HERMETIC: it contends only with its own acquirers on a temp base, so external
 *  production holders (live suites) physically cannot be mixed into the count. `S` is the canonical
 *  slot count (seam → `.concurrency` file → knob → 2), and the probe's holders are pinned to exactly
 *  that S via a `.concurrency` file at the temp base + a sanitized probe env (seam cleared, knob=S) —
 *  the two sources agree, so ambient drift cannot make the probe contend on a different slot count
 *  than the checker compares against (gap-suite-slot-ssot-i5-false-positive). The flock mode is
 *  exclusive by default; `QUAY_TEST_SSOT_I5_FLOCK=shared` injects a shared flock so the checker
 *  itself can go RED end-to-end (硬规则 3b — a verdict that can never go RED is a false guarantee). */
export function checkRuntimeConcurrencyCapped(root: string): SsotVerdict {
  const lib = path.join(root, "plugin", "scripts", "suite-slot-lib.sh");
  if (!fs.existsSync(lib)) {
    return { id: "I5", ok: false, evaluated: false, detail: "suite-slot-lib.sh not found (cannot judge — NOT-EVALUATED, never conflated with green)" };
  }
  const S = suiteLockSlotCount();
  const N = S + 2;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "suite-slot-i5-base-"));
  const base = path.join(tmp, "full-suite.lock");
  // Pin the probe's holders to EXACTLY S slots: a `.concurrency` file at the hermetic base makes the
  // holder's suite_slot_count read S (the canonical reads seam → file → knob; the file now carries S).
  fs.writeFileSync(`${base}.concurrency`, String(S), "utf8");
  const probeEnv = { ...process.env };
  delete probeEnv.RESOURCE_GATE_CONCURRENT_SUITES; // the test seam must not shadow the hermetic file
  probeEnv.QUAY_MAX_CONCURRENT_SUITES = String(S); // belt-and-suspenders: the knob agrees with the file
  const flock = process.env.QUAY_TEST_SSOT_I5_FLOCK === "shared" ? "-s -n" : "-n";
  const { acquired, status, stderr } = runConcurrencyProbe(holderScript(lib, flock), base, N, probeEnv);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (status !== 0) {
    return { id: "I5", ok: false, evaluated: false, detail: `concurrency probe failed (status=${status}, stderr=${stderr.trim() || "<empty>"}) — NOT-EVALUATED` };
  }
  const ok = acquired <= S;
  const hermetic = "hermetic temp base (the probe's own S+2 acquirers only — external production holders are isolated and cannot be counted)";
  return {
    id: "I5", ok, evaluated: true,
    detail: ok
      ? `${acquired}/${N} concurrent acquirers held a slot on the ${hermetic} — ≤ S=${S} — slot exclusivity holds`
      : `${acquired}/${N} concurrent acquirers held a slot on the ${hermetic} — > S=${S} — slot exclusivity VIOLATED among the probe's own acquirers (the 4-concurrent-suite manifestation)`,
  };
}

export function runAll(root: string): SsotVerdict[] {
  return [
    checkFfNoGlobalSuiteLock(root),
    checkNoSlotPathLiterals(root),
    checkConsumersReadCanonical(root),
    checkBashTsCountAgree(root),
    checkRuntimeConcurrencyCapped(root),
  ];
}

const usage = `suite-slot-ssot-check.ts — suite 并发量单一定义点行为层不变量
(tasks/gap-suite-concurrency-ff-gate-and-slot-ssot, AC4)

Invariants (each can take false):
  I1 — fan-in-ff-merge.sh code contains no 'full-suite.lock' read (ff 闸只读本任务 capture)
  I2 — no 'full-suite.lock.<digit>' literal in code across the executable surface
  I3 — the four consumers read the canonical (suite-slot-lib.sh / suite-lock-slots.ts)
  I4 — bash canonical slot count == TS canonical slot count under the same env
  I5 — runtime concurrent suites ≤ S (S+2 concurrent acquirers, ≤ S hold — exclusivity exercised)

Usage:
  node --experimental-strip-types suite-slot-ssot-check.ts --gate [--root <dir>] [--json]
      gate mode — exit 1 iff any invariant is RED.
  node --experimental-strip-types suite-slot-ssot-check.ts --scan [--root <dir>] [--json]
      measure mode — print every check's verdict; exit 0 always.
  node --experimental-strip-types suite-slot-ssot-check.ts --help

Exit codes: 0 PASS/measure · 1 gate FAIL (>=1 RED) · 2 usage/env error.`;

function resolveRoot(rootArg: string | undefined): string {
  return path.resolve(rootArg ?? process.cwd());
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const flagVal = (name: string) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const asJson = args.includes("--json");
  const root = resolveRoot(flagVal("--root"));
  const verdicts = runAll(root);

  if (args.includes("--scan") || args.includes("--gate")) {
    if (asJson) {
      console.log(JSON.stringify({
        mode: args.includes("--gate") ? "gate" : "scan",
        ok: verdicts.every((v) => v.ok),
        verdicts: verdicts.map((v) => ({ ...v })),
      }, null, 2));
    } else {
      for (const v of verdicts) {
        const tag = !v.evaluated ? "NOT-EVALUATED" : v.ok ? "PASS" : "RED";
        console.log(`  [${tag}] ${v.id}: ${v.detail}`);
      }
      const red = verdicts.filter((v) => v.ok === false);
      if (red.length === 0) {
        console.log("PASS — every suite-slot SSoT invariant holds (0 RED)");
      } else {
        console.log(`FAIL — ${red.length} suite-slot SSoT invariant(s) RED:`);
        for (const v of red) console.log(`  - ${v.id}: ${v.detail}`);
      }
    }
    if (args.includes("--gate")) return verdicts.every((v) => v.ok) ? 0 : 1;
    return 0;
  }

  console.error(usage);
  return 2;
}

if (isDirectEntry(import.meta, undefined, "suite-slot-ssot-check")) {
  process.exit(main(process.argv));
}
