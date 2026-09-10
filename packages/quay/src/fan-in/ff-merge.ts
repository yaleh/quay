// fan-in/ff-merge.ts — the fan-in 持锁段 (merge-lock-guarded ff) as an importable TS module.
// (tasks/gap-execution-loop-productization-p2-p4 AC1; SPEC-execution-loop-productization-2026-08-28 §3.1)
//
// This is the TS-ification of the retired bash `plugin/scripts/fan-in-ff-merge.sh` — the human's
// 2026-08-28 verbatim ruling: "fan-in-ff-merge.sh 应该改为 .ts 模块被 import". The business the bash
// carried (merge-lock / clean-tree / escalation / ff / suite-certificate gate) now lives HERE in
// packages/quay, imported by BOTH `quay task fan-in` (cli/task-fan-in.ts) and the worker-driver
// (plugin/scripts/worker-driver.ts). No shell-out to a bash ff-merge script remains.
//
// The lock/clean-tree/escalation/ff behavior is a behavior-faithful port of the retired bash script so
// the fan-in protocol contracts (fan-in-ff-protocol-check.ts, direct-to-develop-bypass-check.ts,
// slot-refill.ts's escalation reader) keep reading the SAME carriers with the SAME shapes:
//   - .quay/fan-in-merge-lock-events.jsonl  (acquire/release, release carries landedSha)
//   - .quay/fan-in-retries.jsonl            (attempt counting, per-runId scope)
//   - .quay/fan-in-ff-escalations.jsonl     (ff-escalation / ff-escalation-resolved)
//   - <git-common-dir>/fan-in-merge.lock    (the merge lock — SEPARATE from the suite lock, AC4)
//
// DUAL-MODE (gap-fan-in-ff-ref-update-detach-develop): the ff degenerates to a PURE REF UPDATE
// (`git push .`) when the merge target is detached from the main checkout; otherwise it stays
// `git merge --ff-only` (which operates on the current branch ⇒ a clean tree is still required).
//
// L1 token gate (gap-fan-in-ff-merge-token-gate-fail-closed, carried into P2 AC1): the ff ENTRY
// requires a driver-injected one-time token (`token`). A direct call without it is fail-closed with a
// DISTINGUISHABLE refusal (⛔ never conflated with the retry exit 1 or the environment exit 2 — hard
// rule 3b). `--acquire-workflow-lock` is abolished (ADR-034); this gate is its mechanical successor.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { resolvePluginRoot } from "../plugin-root.ts";

// ── types ────────────────────────────────────────────────────────────────────────────────────────────

export interface FfMergeArgs {
  /** task id (the task branch `task/<id>` being ff'd). */
  task: string;
  /** repo root (the main checkout the merge target lives in). Default: process.cwd(). */
  root?: string;
  /** the branch the task fast-forwards into. Default `develop`. */
  mergeTarget?: string;
  runId?: string | null;
  /** per-dispatch attempt key (gap-ff-retry-counter-runid-no-longer-per-dispatch): the retry counter's
   *  grouping key. `runId` became a driver-process-lifetime id (`wk-prod-<epoch>`, constant across
   *  dispatches), so the per-runId counter (gap-fan-in-ff-retry-counter-scope) now accumulates across
   *  dispatches. The caller passes a per-dispatch identity here (the mechanical fan-in passes its
   *  per-suite runId `mfi-<task>-<epoch>-<rand>`). Absent ⇒ falls back to `runId` (direct CLI /
   *  semantic-fallback calls that predate the key). */
  attemptKey?: string | null;
  agentId?: string | null;
  /** L1 token gate: the driver-injected one-time token. Absent ⇒ fail-closed (exit 2). */
  token?: string | null;
  /** fallback authoritative suite state (full-suite-state.json): when the capture is missing/unreadable,
   *  the cert gate reads this mirror (state=green ∧ taskId matches ∧ commit 40-hex) — gap-write-suite-capture-non-blocking AC2. */
  suiteState?: string;
  /** the task's suite certificate (suite_exit=0 ∧ suite_head is an ancestor of the ff tip). */
  suiteCapture?: string;
  lockEvents?: string;
  retryRecord?: string;
  escalations?: string;
  lockWaitSecs?: number;
  worktree?: string;
  /** test seam — the plugin/scripts dir (self-bootstrapping default is the SPEC §6b resolver). */
  scriptsDir?: string;
  now?: () => Date;
}

export interface FfMergeResult {
  /** 0 = ff landed; 1 = develop advanced (retry, attempts 1-2); 2 = usage/env/token; 3 = anti-livelock. */
  code: 0 | 1 | 2 | 3;
  stdout: string;
  stderr: string;
  /** the landed merge-target tip on a successful ff; null otherwise. */
  landedSha: string | null;
}

// ── spawn helpers ────────────────────────────────────────────────────────────────────────────────────

interface ShResult {
  status: number;
  stdout: string;
  stderr: string;
}

function sh(argv: string[], cwd?: string): ShResult {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", cwd });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function git(root: string, ...args: string[]): ShResult {
  return sh(["git", "-C", root, ...args]);
}

function iso(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function epoch(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

// ── git-common-dir / ff-mode ──────────────────────────────────────────────────────────────────────────

function gitCommonDir(root: string): string {
  const r = git(root, "rev-parse", "--git-common-dir");
  const common = r.status === 0 ? r.stdout.trim() : ".git";
  return path.isAbsolute(common) ? common : path.resolve(root, common);
}

// ── L1 token gate ─────────────────────────────────────────────────────────────────────────────────────
// gap-fan-in-ff-merge-token-gate-fail-closed: block a non-mechanical direct ff. The worker-driver
// injects a per-fan-in random token; the ff ENTRY refuses a call without one. The refusal is
// DISTINGUISHABLE (its own message + exit 2) — ⛔ never the retry exit 1, never the bare env exit 2.

function tokenGate(args: FfMergeArgs): FfMergeResult | null {
  if (args.token) return null;
  return {
    code: 2,
    stdout: "",
    stderr:
      "fan-in-ff-merge: missing fan-in token — a mechanical ff must carry a driver-injected token " +
      "(L1 token 闸, gap-fan-in-ff-merge-token-gate-fail-closed). Direct/untokenized ff is refused. " +
      "Initiate the fan-in via `quay task fan-in` (worker-driver injects the token), not a raw ff.",
    landedSha: null,
  };
}

// ── AC78 agent-id self-validation (fail-closed against top-level session ids) ────────────────────────

function agentIdGate(args: FfMergeArgs, root: string): FfMergeResult | null {
  const agentId = args.agentId;
  const home = process.env.HOME;
  if (!agentId || !home) return null;
  const projDir = path.join(home, ".claude", "projects", root.split(path.sep).join("-"));
  if (!fs.existsSync(projDir)) return null;
  // A TOP-LEVEL session id resolves to <proj>/<id>.jsonl or <proj>/<id>/ — the old main-thread-executor
  // form (AC67/AC72/AC73). A real subagent uuid (subagents/agent-<id>.jsonl) has no top-level file.
  let topLevel = false;
  for (const e of fs.readdirSync(projDir)) {
    if (!e.startsWith(agentId)) continue;
    const st = fs.statSync(path.join(projDir, e));
    if (e.endsWith(".jsonl") || st.isDirectory()) { topLevel = true; break; }
  }
  if (!topLevel) return null;
  return {
    code: 2,
    stdout: "",
    stderr:
      `fan-in-ff-merge: --agent-id '${agentId}' resolves to a TOP-LEVEL session id (${projDir}/${agentId}*.jsonl exists) — ` +
      "a fan-in must be executed by a subagent, not the main session; a top-level session id is the old " +
      "main-thread-executor form (AC78 判据2(c))",
    landedSha: null,
  };
}

// ── clean-tree handling (merge mode only) ────────────────────────────────────────────────────────────
// ported from the bash: auto-converge (status-only promotion flip) + benign runtime dirty (untracked
// .quay/ outside the task's ## Touches) pass-through, then the real clean-tree refusal.

function cleanTreeCheck(args: FfMergeArgs, root: string): { ok: boolean; stderrLines: string[] } {
  const stderrLines: string[] = [];
  let porcelain = git(root, "status", "--porcelain").stdout;

  // auto-converge (gap-fan-in-clean-tree-auto-converge-promotion-status): porcelain ALL ` M tasks/*.md`
  // ∧ per-file diff hits ONLY the `status:` line ⇒ stage+commit (pathspec-limited), then re-read.
  if (porcelain.trim() !== "") {
    let convergeOk = true;
    const paths: string[] = [];
    for (const line of porcelain.split("\n")) {
      if (!line) continue;
      const pstatus = line.slice(0, 2);
      const ppath = line.slice(3);
      if (pstatus !== " M" && pstatus !== "M " && pstatus !== "MM") { convergeOk = false; break; }
      if (!/^tasks\/[^/]+\.md$/.test(ppath)) { convergeOk = false; break; }
      paths.push(ppath);
    }
    if (convergeOk && paths.length > 0) {
      for (const p of paths) {
        const d = git(root, "diff", "HEAD", "--", p);
        const lines = d.stdout.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
        if (lines.length === 0 || !lines.every((l) => /^[+-]status:/.test(l))) { convergeOk = false; break; }
      }
    }
    if (convergeOk && paths.length > 0) {
      if (
        git(root, "add", "--", ...paths).status === 0 &&
        git(root, "commit", "--no-verify", "-q", "-m", "tasks: promotion-driver 翻转（fan-in 自动收敛）", "--", ...paths).status === 0
      ) {
        stderrLines.push(`fan-in-ff-merge: converged a status-only dirty tree (promotion-driver flip) — committed ${paths.join(" ")}`);
      }
    }
    porcelain = git(root, "status", "--porcelain").stdout;
  }

  // benign runtime dirty (gap-fan-in-ff-merge-benign-runtime-dirty-no-fast-path): porcelain ALL
  // `?? .quay/…` ∧ none in the task's ## Touches ⇒ pass through (NOT committed, NOT gitignored).
  if (porcelain.trim() !== "") {
    let benignOk = true;
    const benignPaths: string[] = [];
    for (const line of porcelain.split("\n")) {
      if (!line) continue;
      const pstatus = line.slice(0, 2);
      const ppath = line.slice(3);
      if (pstatus !== "??") { benignOk = false; break; }
      if (!/^\.quay($|\/)/.test(ppath)) { benignOk = false; break; }
      benignPaths.push(ppath);
    }
    if (benignOk && benignPaths.length > 0) {
      const scriptsDir = scriptsDirOf(args) ?? "";
      const touchesScript = path.join(scriptsDir, "touches-orthogonality-check.ts");
      const verdict = sh(["node", "--experimental-strip-types", touchesScript, "--runtime-dirty", "--task", args.task, "--root", root, ...benignPaths]);
      if (verdict.status !== 0 || !verdict.stdout.trim().startsWith("BENIGN")) benignOk = false;
      else {
        stderrLines.push(`fan-in-ff-merge: passed through a benign runtime-dirty tree (untracked .quay/ runtime files outside the task's ## Touches) — ${benignPaths.join(" ")}`);
        porcelain = "";
      }
    }
  }

  if (porcelain.trim() !== "") {
    stderrLines.push(`fan-in-ff-merge: working tree not clean in ${root} — the merge-mode ff must run on a clean checkout (found uncommitted changes):`);
    for (const line of porcelain.split("\n")) {
      if (line) stderrLines.push(`fan-in-ff-merge:   ${line}`);
    }
    return { ok: false, stderrLines };
  }
  return { ok: true, stderrLines };
}

// ── suite certificate gate ───────────────────────────────────────────────────────────────────────────
// (gap-suite-concurrency-ff-gate-and-slot-ssot): the ff gate reads THIS task's capture (suite_exit=0 ∧
// suite_head is an ancestor of the ff tip ∧ the suite_head..tip delta is classified inert). Fail-closed.

function readCaptureField(capture: string, key: string): string {
  if (!fs.existsSync(capture)) return "";
  const raw = fs.readFileSync(capture, "utf8");
  // shell `source` semantics: the LAST assignment wins (a later `suite_exit=1` overrides an earlier
  // `suite_exit=0` in the same file — the retired bash dot-sourced the capture).
  let value = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith(key + "=")) value = line.slice(key.length + 1);
  }
  return value;
}

// fallback (gap-write-suite-capture-non-blocking AC2): the capture write is fail-open, so a missing
// capture must NOT be misread as a failed suite — the ff gate falls back to the authoritative mirror
// full-suite-state.json (mirrorMechanicalFanInSuiteState writes state=green + commit=suite_head +
// taskId). ⛔ no fake full-green: taskId must match ∧ state=green ∧ commit is 40-hex (a full-run green
// with no taskId, or another task's bucket green, must NOT impersonate this task's certificate).
function readGreenMirrorCommit(stateFile: string, taskId: string): string {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8")) as { state?: unknown; taskId?: unknown; commit?: unknown };
    if (s && s.state === "green" && s.taskId === taskId && typeof s.commit === "string" && /^[0-9a-f]{40}$/i.test(s.commit)) {
      return s.commit;
    }
  } catch {
    // missing/unreadable/malformed — no fallback cert
  }
  return "";
}

function suiteCertGate(args: FfMergeArgs, root: string): { ok: boolean; reason: string | null } {
  const capture = args.suiteCapture ?? `/tmp/fan-in-suite-${args.task}.env`;
  let suiteExit = readCaptureField(capture, "suite_exit");
  let suiteHead = readCaptureField(capture, "suite_head");
  const suiteTip = git(root, "rev-parse", `refs/heads/task/${args.task}`).stdout.trim();
  const exists = fs.existsSync(capture) ? "yes" : "no";
  if (!fs.existsSync(capture)) {
    const stateFile = args.suiteState ?? path.join(root, ".quay", "full-suite-state.json");
    const mirrorCommit = readGreenMirrorCommit(stateFile, args.task);
    if (mirrorCommit) { suiteExit = "0"; suiteHead = mirrorCommit; }
  }
  if (suiteExit !== "0" || !suiteHead || !suiteTip) {
    return { ok: false, reason: `capture=${capture} exists=${exists} suite_exit=${suiteExit || "<unset>"} suite_head=${suiteHead || "<unset>"} 待 ff tip=${suiteTip || "<unresolvable>"}` };
  }
  if (git(root, "merge-base", "--is-ancestor", suiteHead, suiteTip).status !== 0) {
    return { ok: false, reason: `suite_head=${suiteHead} is NOT an ancestor of 待 ff tip=${suiteTip}` };
  }
  const delta = git(root, "diff", "--name-only", suiteHead, suiteTip).stdout.trim();
  if (delta !== "") {
    const scriptsDir = scriptsDirOf(args) ?? "";
    const classifyScript = path.join(scriptsDir, "select-static-checks-for-touches.ts");
    // classify-root = the repo root the registry (scripts/test.sh) lives at — two levels up from
    // plugin/scripts (matches the bash's `dirname BASH_SOURCE/../..`).
    const classifyRoot = path.resolve(scriptsDir, "..", "..");
    const verdict = sh(["node", "--experimental-strip-types", classifyScript, "--classify-delta", "--root", classifyRoot, ...delta.split("\n").filter(Boolean)]);
    if (verdict.status !== 0 || verdict.stdout.trim() !== "") {
      return { ok: false, reason: `suite_head..tip delta classified non-inert (${verdict.stdout.trim() || "covered"})` };
    }
  }
  return { ok: true, reason: null };
}

// ── merge-lock holder (the 持锁段 lock — SEPARATE from the suite lock, AC4) ─────────────────────────
// Ported from the bash `exec {fd}>lock; flock -x -w N; …; flock -u`. Node has no native flock, so a
// non-detached bash holder acquires the lock and blocks on stdin (the SAME ADR-034 holder pattern the
// worker-driver uses for the workflow lock). Closing its stdin releases the flock; a crash closes the
// fd via kernel ⇒ auto-release (the "stale-lock recovery is almost never reached" property, §2).

const MERGE_LOCK_HOLDER = `exec {fd}>"$1" || exit 2
flock -x -w "$2" "$fd" || exit 2
echo acquired
cat >/dev/null
flock -u "$fd" 2>/dev/null || true
exit 0`;

function acquireMergeLockAsync(lockFile: string, lockWaitSecs: number): Promise<{ release: () => void; ok: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", MERGE_LOCK_HOLDER, "merge-lock-holder", lockFile, String(lockWaitSecs)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let buf = "";
    const fail = (): void => {
      if (!settled) { settled = true; resolve({ release: () => {}, ok: false }); }
    };
    child.stdout?.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      if (!settled && buf.includes("acquired")) {
        settled = true;
        resolve({
          ok: true,
          release: () => { try { child.stdin?.end(); } catch { /* already closed */ } },
        });
      }
    });
    child.on("error", fail);
    child.on("close", fail);
  });
}

// ── classify-delta (the computed inert-delta classifier, no hand-written path table) ────────────────

function classifyDelta(args: FfMergeArgs, root: string, files: string[]): string {
  const scriptsDir = scriptsDirOf(args) ?? "";
  const classifyScript = path.join(scriptsDir, "select-static-checks-for-touches.ts");
  const classifyRoot = path.resolve(scriptsDir, "..", "..");
  const r = sh(["node", "--experimental-strip-types", classifyScript, "--classify-delta", "--root", classifyRoot, ...files]);
  return r.status === 0 ? r.stdout.trim() : "__CLASSIFY_FAILED__";
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────

/** The plugin `scripts/` dir — caller override (worker-driver's worktree seam) else the canonical
 *  resolver (SPEC §6b: never the workspace root, never an import.meta.url walk-up without a worktree
 *  check — the pre-migration `MODULE_REPO_ROOT` and `root/plugin/scripts` defaults). null when
 *  unresolvable (callers fail closed). */
function scriptsDirOf(args: FfMergeArgs): string | null {
  if (args.scriptsDir) return args.scriptsDir;
  const pluginRoot = resolvePluginRoot();
  return pluginRoot ? path.join(pluginRoot, "scripts") : null;
}

/** The full 持锁段 ff, as an importable function (used by `quay task fan-in` and worker-driver.ts). */
export async function ffMerge(args: FfMergeArgs): Promise<FfMergeResult> {
  const now = args.now ?? (() => new Date());
  if (!args.task) {
    return { code: 2, stdout: "", stderr: "fan-in-ff-merge: --task <taskId> is required", landedSha: null };
  }
  const root = args.root ?? process.cwd();
  const mergeTarget = args.mergeTarget ?? "develop";
  const lockWait = args.lockWaitSecs ?? 30;
  const suiteCapture = args.suiteCapture ?? `/tmp/fan-in-suite-${args.task}.env`;
  const lockEvents = args.lockEvents ?? path.join(root, ".quay", "fan-in-merge-lock-events.jsonl");
  const retryRecord = args.retryRecord ?? path.join(root, ".quay", "fan-in-retries.jsonl");
  const escalations = args.escalations ?? path.join(root, ".quay", "fan-in-ff-escalations.jsonl");
  const scriptsDir = scriptsDirOf(args);
  if (!scriptsDir) {
    return { code: 2, stdout: "", stderr: "fan-in-ff-merge: plugin scripts dir not resolvable (SPEC §6b — no QUAY_PLUGIN_ROOT, not under a quay checkout/install)", landedSha: null };
  }
  args.scriptsDir = scriptsDir;

  const out: string[] = [];
  const err: string[] = [];

  // L1 token gate (ff ENTRY — before any lock event / retry record).
  const tg = tokenGate(args);
  if (tg) return tg;

  // AC78 agent-id self-validation (before the lock, before any record).
  const ag = agentIdGate(args, root);
  if (ag) return ag;

  if (!fs.existsSync(path.join(root, ".git")) && !fs.existsSync(path.join(root, ".git"))) {
    return { code: 2, stdout: "", stderr: `fan-in-ff-merge: not a git repo: ${root}`, landedSha: null };
  }

  // task branch pre-flight.
  if (git(root, "rev-parse", "--verify", "--quiet", `refs/heads/task/${args.task}`).status !== 0) {
    return { code: 2, stdout: "", stderr: `fan-in-ff-merge: task branch task/${args.task} not found in ${root}`, landedSha: null };
  }

  // ff-mode auto-selection (merge = target still checked out; push = pure ref update).
  const current = git(root, "branch", "--show-current").stdout.trim();
  const ffMode = current === mergeTarget ? "merge" : "push";

  // clean-tree (merge mode only; push mode needs NO clean tree).
  if (ffMode === "merge") {
    const ct = cleanTreeCheck(args, root);
    for (const l of ct.stderrLines) err.push(l);
    if (!ct.ok) return { code: 2, stdout: out.join("\n"), stderr: err.join("\n"), landedSha: null };
  }

  // suite certificate gate (fail-closed).
  const cert = suiteCertGate(args, root);
  if (!cert.ok) {
    // blocked path: run the reaper best-effort (gap-wiring-D-worktree-remove-orphans-reclaim-restore).
    const reaper = path.join(scriptsDir, "worktree-process-reaper.ts");
    if (fs.existsSync(reaper)) {
      if (args.worktree) {
        sh(["node", "--no-warnings", "--experimental-strip-types", reaper, "--worktree", args.worktree, "--root", root, "--json"]);
      }
      sh(["node", "--no-warnings", "--experimental-strip-types", reaper, "--orphans", "--stale-lock-holders-only", "--root", root, "--json"]);
    }
    err.push(
      `fan-in-ff-merge: 本任务 ${args.task} 的 suite 证书未满足 — ${cert.reason}; ` +
      "证书要求 suite_head 是待 ff tip 的祖先、且 suite_head..tip 的 delta 经 --classify-delta 判惰性（无 change/full 检查器 @static-object 覆盖 + 落 doc 面）；塞入 @static-object 覆盖路径 ⇒ 拒（可取假）。NOT acquiring the merge lock",
    );
    return { code: 2, stdout: out.join("\n"), stderr: err.join("\n"), landedSha: null };
  }

  // attempt counting (per-dispatch scope, gap-ff-retry-counter-runid-no-longer-per-dispatch).
  // The key is the per-dispatch identity (attemptKey), NOT runId: runId became a driver-process-lifetime
  // id (`wk-prod-<epoch>`, constant across dispatches), so the per-runId counter (gap-fan-in-ff-retry-
  // counter-scope — correct when runId WAS per-dispatch) now latches a task across independent dispatches.
  // Fall back to runId when attemptKey is absent (direct CLI / semantic-fallback calls that predate the key).
  const runIdJson = args.runId ?? null;
  const agentIdJson = args.agentId ?? null;
  const attemptKeyJson = args.attemptKey ?? null;
  const countKey = attemptKeyJson ?? runIdJson;
  let prior = 0;
  if (fs.existsSync(retryRecord)) {
    const text = fs.readFileSync(retryRecord, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let rec: { taskId?: string; runId?: string | null; attemptKey?: string | null } | null = null;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec && rec.taskId === args.task && (rec.attemptKey ?? rec.runId ?? null) === countKey) prior++;
    }
  }
  const attempt = prior + 1;

  fs.mkdirSync(path.dirname(lockEvents), { recursive: true });
  fs.mkdirSync(path.dirname(retryRecord), { recursive: true });
  fs.mkdirSync(path.dirname(escalations), { recursive: true });

  const lockFile = path.join(gitCommonDir(root), "fan-in-merge.lock");
  const lock = await acquireMergeLockAsync(lockFile, lockWait);
  if (!lock.ok) {
    err.push(`fan-in-ff-merge: could not acquire merge lock ${lockFile} within ${lockWait}s (another fan-in holds it?)`);
    return { code: 2, stdout: out.join("\n"), stderr: err.join("\n"), landedSha: null };
  }

  const t0 = now();
  fs.appendFileSync(lockEvents, JSON.stringify({
    event: "acquire", ts: iso(t0), epoch: epoch(t0), taskId: args.task, pid: process.pid,
    runId: runIdJson, agentId: agentIdJson,
  }) + "\n");

  const developHeadBefore = git(root, "rev-parse", mergeTarget).stdout.trim() || "unresolvable";
  let mergeRc = 0;
  let mergeErr = "";

  const ffCmd = ffMode === "push"
    ? ["git", "-C", root, "push", ".", `refs/heads/task/${args.task}:refs/heads/${mergeTarget}`]
    : ["git", "-C", root, "merge", "--ff-only", `task/${args.task}`];
  const m = sh(ffCmd);
  if (m.status !== 0) {
    mergeRc = 1;
    mergeErr = (m.stdout + m.stderr).trim().split("\n")[0] ?? "";
    // inert-delta in-lock retry (gap-fan-in-ff-retry-reruns-suite-on-inert-increment): develop advanced;
    // if the increment since suite_head is INERT, merge develop into the task branch (worktree) and re-ff.
    const developTip = git(root, "rev-parse", mergeTarget).stdout.trim();
    const wtBranch = args.worktree ? git(args.worktree, "branch", "--show-current").stdout.trim() : "";
    const suiteHead = readCaptureField(suiteCapture, "suite_head");
    if (args.worktree && wtBranch === `task/${args.task}` && suiteHead && developTip) {
      const incFiles = git(root, "diff", "--name-only", `${suiteHead}...${developTip}`).stdout.trim();
      if (incFiles !== "") {
        const codeDelta = classifyDelta(args, root, incFiles.split("\n").filter(Boolean));
        if (codeDelta !== "__CLASSIFY_FAILED__" && codeDelta === "") {
          if (git(args.worktree, "merge", "--no-edit", mergeTarget).status === 0) {
            const m2 = sh(ffCmd);
            if (m2.status === 0) { mergeRc = 0; mergeErr = ""; }
            else { mergeRc = 1; mergeErr = (m2.stdout + m2.stderr).trim().split("\n")[0] ?? ""; }
          }
        }
      }
    }
  }

  const t1 = now();
  const landedSha = mergeRc === 0 ? (git(root, "rev-parse", mergeTarget).stdout.trim() || null) : null;
  fs.appendFileSync(lockEvents, JSON.stringify({
    event: "release", ts: iso(t1), epoch: epoch(t1), taskId: args.task, pid: process.pid,
    runId: runIdJson, agentId: agentIdJson, landedSha,
  }) + "\n");
  lock.release();

  if (mergeRc !== 0) {
    const developHeadNow = git(root, "rev-parse", mergeTarget).stdout.trim() || "unresolvable";
    fs.appendFileSync(retryRecord, JSON.stringify({
      taskId: args.task, attempt, developHead: developHeadNow, ts: iso(t1), epoch: epoch(t1),
      runId: runIdJson, agentId: agentIdJson, mergeTarget, error: mergeErr, attemptKey: attemptKeyJson,
    }) + "\n");
    if (attempt >= 3) {
      fs.appendFileSync(escalations, JSON.stringify({
        event: "ff-escalation", taskId: args.task, attempt, developHead: developHeadNow, ts: iso(t1),
        epoch: epoch(t1), runId: runIdJson, agentId: agentIdJson, mergeTarget, action: "stop-retry",
        attemptKey: attemptKeyJson,
      }) + "\n");
      err.push(
        `fan-in-ff-merge: FF FAILED (attempt ${attempt} >= 3) — ANTI-LIVELOCK (SPEC §7, gap-ff-livelock-trigger-no-action): develop keeps advancing; escalating + STOPPING automatic retry. Escalation record written to ${escalations}. Do NOT auto-retry: re-merge develop and re-run the fan-in once develop settles.`,
      );
      err.push("fan-in-ff-merge: measure ff_only_locked=false");
      return { code: 3, stdout: out.join("\n"), stderr: err.join("\n"), landedSha: null };
    }
    err.push(
      `fan-in-ff-merge: FF FAILED — ${mergeErr || "develop advanced"}; not a fast-forward. Retry record written (attempt ${attempt}). Return to 无锁段 step 1 (merge develop again — 必须 merge 不得 rebase, AC75), re-judge the delta (step 2) and re-run.`,
    );
    err.push("fan-in-ff-merge: measure ff_only_locked=false");
    return { code: 1, stdout: out.join("\n"), stderr: err.join("\n"), landedSha: null };
  }

  // POST-state sanity check (the merge target must now be at the task tip).
  const postHead = git(root, "rev-parse", mergeTarget).stdout.trim() || "unresolvable";
  const taskTip = git(root, "rev-parse", `refs/heads/task/${args.task}`).stdout.trim() || "unresolvable";
  if (postHead !== taskTip) {
    err.push(`fan-in-ff-merge: post-check FAILED — ${mergeTarget} is at ${postHead}, expected task tip ${taskTip}; needs human`);
    return { code: 1, stdout: out.join("\n"), stderr: err.join("\n"), landedSha: null };
  }

  // escalation resolution (the landed signal for slot-refill's ff-starvation relief).
  fs.appendFileSync(escalations, JSON.stringify({
    event: "ff-escalation-resolved", taskId: args.task, ts: iso(t1), epoch: epoch(t1),
    runId: runIdJson, agentId: agentIdJson, mergeTarget,
  }) + "\n");

  out.push(`fan-in-ff-merge: OK — ${mergeTarget} fast-forwarded to task/${args.task} (${postHead}) [before ${developHeadBefore}]${args.runId ? ` (runId: ${args.runId})` : ""}`);
  out.push("fan-in-ff-merge: measure ff_only_locked=true");
  return { code: 0, stdout: out.join("\n"), stderr: err.join("\n"), landedSha };
}

// ── thin CLI main (argv → ffMerge → exit code) ───────────────────────────────────────────────────────
// Keeps the old bash's invocation shape (`--task … --root … --suite-capture …`) so the pinning test can
// drive the module directly via `node --experimental-strip-types …/ff-merge.ts <args>`.

function parseArgv(argv: string[]): { args: FfMergeArgs; help: boolean } {
  const args: FfMergeArgs = { task: "" };
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => argv[++i] ?? "";
    switch (a) {
      case "--task": args.task = next(); break;
      case "--root": args.root = next(); break;
      case "--merge-target": args.mergeTarget = next(); break;
      case "--run-id": args.runId = next(); break;
      case "--attempt-key": args.attemptKey = next(); break;
      case "--agent-id": args.agentId = next(); break;
      case "--token": args.token = next(); break;
      case "--suite-state": args.suiteState = next(); break;
      case "--suite-capture": args.suiteCapture = next(); break;
      case "--lock-events": args.lockEvents = next(); break;
      case "--retry-record": args.retryRecord = next(); break;
      case "--escalations": args.escalations = next(); break;
      case "--lock-wait": args.lockWaitSecs = Number(next()); break;
      case "--worktree": args.worktree = next(); break;
      case "--scripts-dir": args.scriptsDir = next(); break;
      case "--help":
      case "-h": help = true; break;
      default: break;
    }
  }
  return { args, help };
}

const HELP = `fan-in-ff-merge (TS module) — AC62 持锁段: a merge lock that wraps ONLY the ff.
Usage:
  node --experimental-strip-types packages/quay/src/fan-in/ff-merge.ts --task <taskId> [--root <repo>]
    [--merge-target <branch>] [--run-id <runId>] [--attempt-key <key>] [--agent-id <id>] [--token <token>] [--suite-capture <file>]
    [--lock-events <file>] [--retry-record <file>] [--escalations <file>] [--lock-wait <secs>] [--worktree <path>]
Exit codes: 0 = ff performed; 1 = develop advanced (retry); 2 = usage/env/token; 3 = anti-livelock.
`;

function isMainModule(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const self = import.meta.url;
  const target = pathToFileURL(argv1).href;
  if (self === target) return true;
  try { return self === pathToFileURL(fs.realpathSync(argv1)).href; } catch { return false; }
}

if (isMainModule()) {
  const { args, help } = parseArgv(process.argv.slice(2));
  if (help) {
    process.stdout.write(HELP);
    process.exitCode = 0;
  } else {
    ffMerge(args).then((r) => {
      if (r.stdout) process.stdout.write(r.stdout + "\n");
      if (r.stderr) process.stderr.write(r.stderr + "\n");
      process.exitCode = r.code;
    });
  }
}
