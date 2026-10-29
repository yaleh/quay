// goal-preview.ts — the goal PREVIEW INSTANCE (SPEC-goal-branch-2026-10-03 §4.10, rulings ⑮⑫㉒㉓).
//
// WHAT A PREVIEW INSTANCE IS. One branch-mode goal = one preview instance = the criterion worktree
// (`goalCriterionWorktreeDir`, detached at the `goal/<id>` tip — §5 B1) PLUS a `quay serve` whose
// workspace root IS that worktree. The human tries the goal's changes there before the merge; the
// pre-merge ACs are evaluated on the SAME tree, so "what the human tried" and "what the criterion
// verified" are the same object (⑮).
//
// ⚠️ THE TRIAL SURFACE IS DECLARABLE (gap-goal-branch-preview-trial-surface-declarable): the `quay
// serve` above is the DEFAULT. A workspace may declare its own product via the `.quay/config.yml`
// `preview:` section (command + health URL); see `readPreviewDecl` / `startDeclaredPreview` below.
// quay's own repo declares nothing, so the serve default is byte-identical to the pre-change path.
//
// WHO OWNS WHAT (ruling ㉒):
//   · the WORKTREE — goal-driver creates / refreshes / deletes it (it already evaluates there);
//   · the SERVE   — the human starts and stops it with `quay goal preview <GOAL> start|stop|status`.
// There is deliberately NO "has been tried" flag: an un-started preview means a live-probe AC reads
// `not-evaluated`, which blocks `quay goal merge`. 「人确实试用过」IS that reading.
//
// WHY IT CAN COEXIST WITH PRODUCTION (read from the code, 2026-10-03):
//   · `quay serve`'s admission lock is per WORKSPACE ROOT (`serve.ts` SERVE_LOCK_REL under the root)
//     ⇒ a preview root ≠ the main checkout ⇒ the two do not exclude each other.
//   · `quay serve` hosts only `web` + `control` (cli/driver-vocab.ts HOSTED_SERVICE_NAMES) — no
//     driver ⇒ a preview never dispatches tasks and never adopts production workers.
//   · a live-probe criterion finds its server by "cwd == `git rev-parse --show-toplevel`" (AC-288)
//     ⇒ evaluated in the preview worktree it matches the preview serve, with no criterion edit.
//
// ── the `.quay/` snapshot (ruling ㉓) ────────────────────────────────────────────────────────────
// A new worktree has NO `.quay/` (it is gitignored) while the serve needs at least `config.yml`.
// Each refresh copies a SNAPSHOT of the main checkout's `.quay/` into the preview — the same
// mechanism `plugin/scripts/refresh-worktree-quay.sh` already uses for task worktrees (snapshot, ⛔
// never a symlink; the preview's writes land on its own copy and are discarded on the next refresh —
// memory `task-worktree-gate-ledger-is-not-durable`).
// ⛔ INSTANCE IDENTITY FILES ARE NEVER COPIED: `server.json` (`SERVER_STATE_REL`, server-state.ts),
// `server.lock` (`SERVE_LOCK_REL`, serve.ts) and `server-services.json` (`SERVICE_STATE_REL`,
// serve.ts) name WHICH process is the host of a root. Copying the production ones would make the
// preview read the PRODUCTION instance's registration — the exact hijack the reaper's
// `isSelfRegisteredServe` guard was built to survive. So the preview starts with none of them and
// its own serve publishes its own.
// ⛔ PREVIEW CODE NEVER READS OR WRITES PRODUCTION DATA: everything the preview mutates lives under
// its own root and is thrown away by the next refresh.
//
// The heavy/wasteful exclusions below MIRROR `refresh-worktree-quay.sh`'s set (that script is the
// sibling implementation; the difference is exactly the instance-identity files above): this repo's
// `.quay/` is multi-GB (measured 5.4 GB on 2026-10-03, `node-compile-cache` alone 4 GB), so an
// unfiltered copy is not a "snapshot", it is an outage.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import YAML from "yaml";
import { goalCriterionWorktreeDir, realpathOrSelf } from "./core/goal-store.ts";
import { readServerState, pidAlive } from "./core/server-state.ts";
import { parsePreviewConfig, type PreviewConfig } from "./core/config.ts";
import {
  entryExists,
  worktreeDepsInstallCommand,
  readDeclaredWorktreeDepsInstall,
  runWorktreeDepsInstall,
  type WorktreeDepsDecision,
} from "./worktree-deps.ts";

/** The serve-lock file, restated from `serve.ts`'s `SERVE_LOCK_REL` — see the header. Not imported
 *  from `serve.ts` on purpose: this module is a LEAF (it is re-exported through the drivers' Layer 0
 *  import face), and `serve.ts` pulls the whole web/handler graph in. The two literals are pinned by
 *  this task's test (the snapshot must not carry them). */
export const PREVIEW_SERVE_LOCK_BASENAME = "server.lock";
/** The unified serve carrier, restated from `server-state.ts`'s `SERVER_STATE_REL`. */
export const PREVIEW_SERVER_STATE_BASENAME = "server.json";
/** The per-service liveness carrier, restated from `serve.ts`'s `SERVICE_STATE_REL`. */
export const PREVIEW_SERVICE_STATE_BASENAME = "server-services.json";
/** The DECLARED preview's carrier (`.quay/preview.json`) — the `preview:`-surface analogue of
 *  `server.json`: the preview mechanism writes it when it starts a declared command, and both
 *  `status` and a live-probe AC read it to locate the product's address. It names WHICH process
 *  hosts this root's preview, so it is instance identity and must never travel in a snapshot. */
export const PREVIEW_CARRIER_BASENAME = "preview.json";

/** Files that identify a RUNNING INSTANCE of a root. Never copied into a preview (header). */
export const PREVIEW_INSTANCE_FILES: readonly string[] = [
  PREVIEW_SERVER_STATE_BASENAME,
  PREVIEW_SERVE_LOCK_BASENAME,
  PREVIEW_SERVICE_STATE_BASENAME,
  PREVIEW_CARRIER_BASENAME,
];

/** Heavy/wasteful `.quay/` entries a snapshot skips — the same set `refresh-worktree-quay.sh`
 *  excludes (a compile cache is regenerable; dated logs and machine-local inboxes are irrelevant to
 *  a preview). Entries are workspace-relative to `.quay/`. */
export const PREVIEW_SNAPSHOT_SKIP_DIRS: readonly string[] = ["node-compile-cache", "manager-inbox", "outer-inbox"];
/** Skip predicate for a whole file name matching the dated full-suite log convention. */
export function isPreviewSnapshotSkippedLog(name: string): boolean {
  return /^full-suite-.*\.log$/.test(name);
}

/** The preview worktree path for a goal — the SAME derivation the criterion evaluation uses
 *  (`goalCriterionWorktreeDir`): one worktree serves both roles, so they can never diverge. */
export function previewWorktreeDir(mainRoot: string, goalId: string): string {
  return goalCriterionWorktreeDir(mainRoot, goalId);
}

// ── worktree dependency provisioning ─────────────────────────────────────────────────────────────
//
// A plain `git worktree add` carries the TRACKED tree only: `node_modules` is gitignored, so any
// `node` process started inside the fresh worktree (the preview serve, a git hook such as
// `pre-merge-commit`, the build phase of `scripts/test.sh`) dies with ERR_MODULE_NOT_FOUND. Task
// worktrees get their deps from `plugin/scripts/dispatch-worktree-setup.sh`; the goal-side worktrees
// are created by bare `git worktree add`, so they take the SAME zero-copy link here — ONE function,
// ⛔ not a copy per caller (criterion worktree + merge-verification temp worktree both call it).
//
// Semantics are ENUMERATED and never throw (硬规则 3/3b): a "no deps at the source" case must read as
// itself, never as a silent success; an already-provisioned worktree is a no-op, never an error.
//   linked        — the main checkout had `node_modules` and the symlink was created
//   installed     — a package-manager-specific install command ran INSIDE the worktree (a declared
//                   `loop.worktree_deps_install`, or pnpm auto-detected); ⛔ NO symlink — a pnpm
//                   project refuses a symlinked node_modules and its suite dies in milliseconds
//   present       — the worktree already carried a `node_modules` entry (kept untouched, idempotent)
//   source-absent — the main checkout has no `node_modules`: NO link is created, read honestly
//   failed        — the symlink could not be created, OR an install command ran and did not yield
//                   `node_modules` (readable reason, still ⛔ does not throw)
export interface WorktreeNodeModulesReading {
  state: "linked" | "installed" | "present" | "source-absent" | "failed";
  /** `<worktreeRoot>/node_modules` — where the link (or install) lives (or would live). */
  linkPath: string;
  /** The main checkout's `node_modules` the link points at; null when nothing was linked. */
  target: string | null;
  /** WHY an install command was chosen (config / pnpm-lockfile / packageManager) — present only on
   *  the `installed`/`failed` install paths; absent on the link paths (⛔ 硬规则 3b: "no marker
   *  detected" must not share a shape with "linked"). */
  decision?: WorktreeDepsDecision;
  reason: string | null;
}

/**
 * Give `worktreeRoot` the main checkout's dependencies as a zero-copy symlink, the same mechanism
 * task worktrees get from `dispatch-worktree-setup.sh`. Idempotent and non-throwing; returns an
 * enumerated reading (see `WorktreeNodeModulesReading`).
 */
export function ensureWorktreeNodeModules(mainRoot: string, worktreeRoot: string): WorktreeNodeModulesReading {
  const linkPath = path.join(worktreeRoot, "node_modules");
  if (entryExists(linkPath)) return { state: "present", linkPath, target: null, reason: null };

  // Package-manager-aware arm — the SHARED judgment with the task path
  // (packages/quay/src/worktree-deps.ts): a pnpm project (or one declaring loop.worktree_deps_install)
  // refuses a symlinked node_modules, so install INSIDE the worktree instead of linking. ⛔ ONE
  // implementation, two callers — never a copy per path.
  const judged = worktreeDepsInstallCommand({ mainRoot, declaredInstall: readDeclaredWorktreeDepsInstall(mainRoot) });
  if (judged.command !== null) {
    const r = runWorktreeDepsInstall(judged.command, worktreeRoot); // captured (not relayed): the driver's stdout stays clean
    if (r.ok && entryExists(linkPath)) return { state: "installed", linkPath, target: null, decision: judged.decision, reason: null };
    return {
      state: "failed",
      linkPath,
      target: null,
      decision: judged.decision,
      reason: r.ok ? `'${judged.command}' did not produce ${linkPath}` : `'${judged.command}' exited non-zero in ${worktreeRoot}${r.output ? `: ${r.output}` : ""}`,
    };
  }

  const target = path.join(mainRoot, "node_modules");
  let st: fs.Stats;
  try {
    st = fs.statSync(target); // follows a symlinked main's node_modules too
  } catch {
    return { state: "source-absent", linkPath, target: null, reason: `no node_modules at ${target}` };
  }
  if (!st.isDirectory()) return { state: "source-absent", linkPath, target: null, reason: `${target} is not a directory` };
  try {
    fs.symlinkSync(target, linkPath, "dir");
  } catch (err) {
    return { state: "failed", linkPath, target, reason: String((err as Error)?.message ?? err) };
  }
  return { state: "linked", linkPath, target, reason: null };
}

// ── the `.quay/` snapshot ────────────────────────────────────────────────────────────────────────

export interface QuaySnapshotReading {
  /** `copied`      — the snapshot ran (≥0 files copied);
   *  `target-is-source` — the preview root IS the main checkout (no-op, nothing copied);
   *  `source-absent`    — the main checkout has no `.quay/` (nothing to snapshot). */
  state: "copied" | "target-is-source" | "source-absent";
  copied: string[];
  /** Entries that EXIST at the source and were deliberately not copied — instance-identity files
   *  ALWAYS, plus any entry the caller's `skip` predicate protects (enumerated, ⛔ never folded into
   *  `copied` — 硬规则 3). Directories are recorded with a trailing `/`. */
  excluded: string[];
  reasons: string[];
}

/** Options for {@link snapshotQuayDirInto}. */
export interface QuaySnapshotOptions {
  /**
   * Entries the TARGET already carries and the snapshot must NOT write over: return a non-null
   * reason to skip the entry (for a directory, its whole subtree). Called for every entry with its
   * path RELATIVE TO `.quay/`; `null`/absent ⇒ nothing is protected.
   *
   *  WHY IT EXISTS — the goal→develop merge temp worktree
   *  (gap-goal-merge-temp-worktree-lacks-quay-snapshot-no-suite-tooling): a project that TRACKS part
   *  of `.quay/` (quay's own repo tracks 101 files under it) already has those checked out at the
   *  merge commit. Overwriting them with the main checkout's copy would make the TESTED tree differ
   *  from the merge commit AND dirty a tracked file. The merge caller therefore passes "the merge
   *  commit tracks this path" as the predicate; the preview/criterion callers pass nothing (their
   *  target is a bare detached checkout whose `.quay/` has no tracked files to protect).
   */
  skip?: (rel: string) => string | null;
}

function samePath(a: string, b: string): boolean {
  // 两侧都取 realpathOrSelf（而非 realpathSync + path.resolve 回落）：别名 root 下 `path.resolve` 不解析
  // 符号链接，一侧不存在时会把同一目录读成两个路径
  // （gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root，同 criterionWorktreeRegistered）。
  return realpathOrSelf(a) === realpathOrSelf(b);
}

/**
 * Copy the main checkout's `.quay/` into `previewRoot` as a snapshot, skipping instance-identity
 * files, the heavy/wasteful entries, and (when `opts.skip` is given) the caller-protected entries.
 * Idempotent (overwrites stale copies). Returns an ENUMERATED reading — what was copied, what was
 * excluded, and (when nothing was copied) why (硬规则 3/3b).
 */
export function snapshotQuayDirInto(mainRoot: string, previewRoot: string, opts: QuaySnapshotOptions = {}): QuaySnapshotReading {
  const src = path.join(mainRoot, ".quay");
  const dst = path.join(previewRoot, ".quay");
  if (samePath(src, dst)) {
    return { state: "target-is-source", copied: [], excluded: [], reasons: [`${previewRoot} is the main checkout — nothing to snapshot`] };
  }
  if (!fs.existsSync(src)) {
    return { state: "source-absent", copied: [], excluded: [], reasons: [`no ${src} to snapshot`] };
  }
  const copied: string[] = [];
  const excluded: string[] = [];
  const reasons: string[] = [];
  fs.mkdirSync(dst, { recursive: true });
  const walk = (rel: string): void => {
    const abs = path.join(src, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      reasons.push(`cannot read ${abs}: ${String((err as Error)?.message ?? err)}`);
      return;
    }
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      // Caller-protected entries are skipped FIRST — before the expensive recursion into a directory
      // and before the instance-identity/log checks, so a protected subtree is never even walked.
      const skipReason = opts.skip?.(childRel);
      if (skipReason !== undefined && skipReason !== null) {
        excluded.push(e.isDirectory() ? `${childRel}/` : childRel);
        reasons.push(`${childRel}: ${skipReason}`);
        continue;
      }
      if (e.isDirectory()) {
        if (rel === "" && PREVIEW_SNAPSHOT_SKIP_DIRS.includes(e.name)) {
          excluded.push(`${childRel}/`);
          continue;
        }
        fs.mkdirSync(path.join(dst, childRel), { recursive: true });
        walk(childRel);
        continue;
      }
      if (!e.isFile()) continue; // symlinks / sockets: not part of a data snapshot
      if (rel === "" && PREVIEW_INSTANCE_FILES.includes(e.name)) {
        excluded.push(childRel);
        continue;
      }
      if (rel === "" && isPreviewSnapshotSkippedLog(e.name)) {
        excluded.push(childRel);
        continue;
      }
      try {
        fs.copyFileSync(path.join(src, childRel), path.join(dst, childRel));
        copied.push(childRel);
      } catch (err) {
        reasons.push(`cannot copy ${childRel}: ${String((err as Error)?.message ?? err)}`);
      }
    }
  };
  walk("");
  return { state: "copied", copied, excluded, reasons };
}

// ── reading the preview's carrier ────────────────────────────────────────────────────────────────

export interface PreviewStatusReading {
  /** Four DISTINCT outcomes (硬规则 3b): `running` (carrier present, pid alive), `stale` (carrier
   *  present, pid DEAD — a killed host masquerading as a live one), `not-running` (no carrier),
   *  `not-evaluated` (carrier unreadable — could not tell, ⛔ not "not running"). */
  state: "running" | "stale" | "not-running" | "not-evaluated";
  previewRoot: string;
  pid: number | null;
  host: string | null;
  /** The `web` service port recorded in the carrier (kernel-assigned ports are knowable only here). */
  port: number | null;
  detail: string;
}

// ── the DECLARED trial surface (`.quay/config.yml` `preview:`) ───────────────────────────────────
//
// A workspace MAY declare its own preview product (SPEC-goal-branch §4.10, the fix for
// gap-goal-branch-preview-trial-surface-declarable). When it does, `goal preview start` runs that
// command instead of the hard-coded `quay.ts serve`, waits for its declared health URL to answer
// HTTP 200, and records the address in a carrier (`.quay/preview.json`) that `status`/`stop`/a
// live-probe AC all read. No declaration ⇒ the historical quay-serve path below, unchanged.

/** What `.quay/config.yml`'s `preview:` section resolves to AT THIS PREVIEW ROOT. Three states, ⛔
 *  never a boolean: `configured` / `default` (no section — the quay-serve fallback) / `unreadable`
 *  (the section is present but malformed — ⛔ NOT "default", hard rule 3b: a declared-but-broken
 *  surface must not silently become the quay serve). */
export type PreviewDeclReading =
  | { state: "configured"; config: PreviewConfig }
  | { state: "default" }
  | { state: "unreadable"; reason: string };

/** Read this preview root's `.quay/config.yml` `preview:` section. ⛔ EXACT path, no walk-up: the
 *  preview root is a criterion worktree whose own `.quay/config.yml` is the snapshot the refresh
 *  wrote; walking up could surface an unrelated ancestor config and mis-attribute a declaration. */
export function readPreviewDecl(previewRoot: string): PreviewDeclReading {
  const configPath = path.join(previewRoot, ".quay", "config.yml");
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    return { state: "default" };
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    return { state: "unreadable", reason: `.quay/config.yml did not parse: ${String((err as Error)?.message ?? err)}` };
  }
  const section = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).preview : undefined;
  if (section === undefined) return { state: "default" };
  const judged = parsePreviewConfig(section);
  if ("reason" in judged) return { state: "unreadable", reason: judged.reason };
  return { state: "configured", config: judged.config };
}

/** Substitute the `{port}` / `{host}` placeholders a `preview:` command/health template may carry. */
export function renderPreviewTemplate(template: string, vars: { port: number; host: string }): string {
  return template.replace(/\{port\}/g, String(vars.port)).replace(/\{host\}/g, vars.host);
}

/** The carrier `start` writes once it has spawned a declared preview — the `.quay/preview.json`
 *  analogue of `server.json` (hard rule 4b: the address is recorded by the thing that started the
 *  process, not derived by a reader). `healthUrl` is the RESOLVED template, so a live-probe AC reads
 *  exactly the URL `start` verified. */
export interface DeclaredPreviewCarrier {
  schemaVersion: 1;
  pid: number;
  host: string;
  port: number;
  healthUrl: string;
  command: string[];
  startedAt: string;
}

export type DeclaredCarrierReading =
  | { state: "present"; carrier: DeclaredPreviewCarrier; path: string }
  | { state: "absent"; path: string }
  | { state: "unreadable"; path: string; reason: string };

export function readDeclaredPreviewCarrier(previewRoot: string): DeclaredCarrierReading {
  const p = path.join(previewRoot, ".quay", PREVIEW_CARRIER_BASENAME);
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return { state: "absent", path: p };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { state: "unreadable", path: p, reason: `carrier is not JSON: ${String((err as Error)?.message ?? err)}` };
  }
  const c = parsed as Partial<DeclaredPreviewCarrier> | null;
  if (
    c === null || typeof c !== "object" || c.schemaVersion !== 1 ||
    typeof c.pid !== "number" || !Number.isInteger(c.pid) || c.pid < 1 ||
    typeof c.host !== "string" || c.host === "" ||
    typeof c.port !== "number" || !Number.isInteger(c.port) || c.port < 1 ||
    typeof c.healthUrl !== "string" || c.healthUrl === ""
  ) {
    return { state: "unreadable", path: p, reason: "carrier does not have the declared-preview shape (schemaVersion/pid/host/port/healthUrl)" };
  }
  return { state: "present", carrier: c as DeclaredPreviewCarrier, path: p };
}

export function writeDeclaredPreviewCarrier(previewRoot: string, carrier: DeclaredPreviewCarrier): void {
  const p = path.join(previewRoot, ".quay", PREVIEW_CARRIER_BASENAME);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(carrier, null, 2), "utf8");
}

/** A health probe's outcome — three states, ⛔ not "up"/"down" (硬规则 3b): `ok` (HTTP 200),
 *  `http-error` (answered, non-200), `unreachable` (no answer), `not-evaluated` (could not probe). */
export type HealthProbeReading =
  | { state: "ok"; status: 200 }
  | { state: "http-error"; status: number }
  | { state: "unreachable"; reason: string }
  | { state: "not-evaluated"; reason: string };

/** GET a health URL, resolving once on the FIRST terminal outcome (a timeout→error race must not
 *  double-settle the promise). */
export function probeHealthUrl(url: string, timeoutMs = 3000): Promise<HealthProbeReading> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: HealthProbeReading): void => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const mod = url.startsWith("https://") ? https : http;
    let req: ReturnType<typeof mod.get>;
    try {
      req = mod.get(url, (res) => {
        res.resume();
        settle(res.statusCode === 200 ? { state: "ok", status: 200 } : { state: "http-error", status: res.statusCode ?? 0 });
      });
    } catch (err) {
      settle({ state: "not-evaluated", reason: String((err as Error)?.message ?? err) });
      return;
    }
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`health probe timed out after ${timeoutMs}ms`)));
    req.on("error", (err) => settle({ state: "unreachable", reason: String((err as Error)?.message ?? err) }));
  });
}

/** Spawn a detached child, resolving on the FIRST of "spawned" / "could not spawn" — the 'error'
 *  event (a non-existent command) and the 'spawn' event are the two terminal arms, so a bad command
 *  is a `failed` reading, ⛔ never a started-but-then-died lie. */
function spawnDetached(
  argv: string[],
  opts: { cwd: string; logFd: number },
): Promise<{ state: "spawned"; pid: number } | { state: "failed"; reason: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: { state: "spawned"; pid: number } | { state: "failed"; reason: string }): void => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: opts.cwd,
        detached: true,
        stdio: ["ignore", opts.logFd, opts.logFd],
        env: process.env,
      });
    } catch (err) {
      settle({ state: "failed", reason: `spawn failed: ${String((err as Error)?.message ?? err)}` });
      return;
    }
    child.once("error", (err) => settle({ state: "failed", reason: `spawn failed: ${String((err as Error)?.message ?? err)}` }));
    child.once("spawn", () => {
      child.unref();
      settle({ state: "spawned", pid: child.pid as number });
    });
  });
}

/** Read a DECLARED preview's state from its own `.quay/preview.json`. `running` = carrier present +
 *  pid alive (the same carrier-trust the quay-serve path places in `server.json`'s `up` field — the
 *  HTTP-200 verification is `start`'s job, not `status`'s). */
export function readDeclaredPreviewStatus(previewRoot: string): PreviewStatusReading {
  const read = readDeclaredPreviewCarrier(previewRoot);
  if (read.state === "absent") {
    return { state: "not-running", previewRoot, pid: null, host: null, port: null, detail: `no declared preview carrier at ${read.path}` };
  }
  if (read.state === "unreadable") {
    return { state: "not-evaluated", previewRoot, pid: null, host: null, port: null, detail: read.reason };
  }
  const c = read.carrier;
  if (!pidAlive(c.pid)) {
    return { state: "stale", previewRoot, pid: c.pid, host: c.host, port: c.port, detail: `carrier names pid ${c.pid}, which is DEAD` };
  }
  return { state: "running", previewRoot, pid: c.pid, host: c.host, port: c.port, detail: `declared preview pid ${c.pid} alive; health ${c.healthUrl}` };
}

/** Read the QUAY-serve preview's state from ITS OWN root's `.quay/server.json` (never the main one). */
function readQuayPreviewStatus(previewRoot: string): PreviewStatusReading {
  const read = readServerState(previewRoot);
  if (read.kind === "absent") {
    return { state: "not-running", previewRoot, pid: null, host: null, port: null, detail: read.reason };
  }
  if (read.kind === "unreadable") {
    return { state: "not-evaluated", previewRoot, pid: null, host: null, port: null, detail: read.reason };
  }
  const st = read.state;
  const web = st.services.find((s) => s.name === "web") ?? null;
  if (!pidAlive(st.pid)) {
    return { state: "stale", previewRoot, pid: st.pid, host: web?.host ?? null, port: web?.port ?? null, detail: `carrier names pid ${st.pid}, which is DEAD` };
  }
  return {
    state: "running",
    previewRoot,
    pid: st.pid,
    host: web?.host ?? null,
    port: web?.port ?? null,
    detail: `pid ${st.pid} alive${web ? `, web on ${web.host}:${web.port}` : " (no web service entry)"}`,
  };
}

/** Read a preview instance's state — the declared surface when this root declares one, else the
 *  quay-serve carrier (the historical path, unchanged). A present-but-unreadable declaration is
 *  `not-evaluated`, ⛔ never folded into the quay-serve fallback. */
export function readPreviewStatus(previewRoot: string): PreviewStatusReading {
  const decl = readPreviewDecl(previewRoot);
  if (decl.state === "unreadable") {
    return { state: "not-evaluated", previewRoot, pid: null, host: null, port: null, detail: `preview declaration unreadable: ${decl.reason}` };
  }
  if (decl.state === "configured") return readDeclaredPreviewStatus(previewRoot);
  return readQuayPreviewStatus(previewRoot);
}

// ── stopping a preview serve ─────────────────────────────────────────────────────────────────────

export interface PreviewStopReading {
  /** `stopped`    — a host was signalled and its carrier removed;
   *  `not-running`— no live host registered at this root (idempotent);
   *  `not-evaluated` — the carrier could not be read (could not tell);
   *  `failed`     — a live host was found but not all of it could be stopped (reported, ⛔ not a lie). */
  state: "stopped" | "not-running" | "not-evaluated" | "failed";
  pid: number | null;
  /** `group` = the whole process group was signalled (the `node --watch` supervisor + its child),
   *  `pid` = only the registered pid. `null` when nothing was signalled. */
  signalled: "group" | "pid" | null;
  detail: string;
}

/**
 * Read `/proc/<pid>/stat`'s process-group id. Returns null when it cannot be read (⛔ never 0 —
 * "could not read" must not look like a real pgid, 硬规则 3b). `comm` (field 2) may contain spaces
 * and parentheses, so the parse starts after its LAST ')'.
 */
export function readProcessGroupId(pid: number): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const close = raw.lastIndexOf(")");
  if (close < 0) return null;
  // After ")": state ppid pgrp session ...
  const fields = raw.slice(close + 1).trim().split(/\s+/);
  const pgrp = Number.parseInt(fields[2] ?? "", 10);
  return Number.isInteger(pgrp) && pgrp > 0 ? pgrp : null;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The pid recorded in a root's serve LOCK (a bare `<pid>\n`), or null when absent/unreadable. */
function readLockPid(lockPath: string): number | null {
  try {
    const n = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Remove a bare-pid lock only when it still names `pid`. ⛔ Never delete a successor's record:
 *  after a kill+restart the file belongs to the NEW host. */
function removeLockIfOwned(lockPath: string, pid: number): void {
  if (readLockPid(lockPath) !== pid) return;
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    /* best-effort: the admission lock's own stale-pid path still handles a leftover */
  }
}

/** Remove the JSON carrier only when it still names `pid` (⛔ the carrier is JSON, not a bare pid —
 *  reading it with the lock parser would silently never match and leak the file). */
function removeCarrierIfOwned(carrierPath: string, pid: number): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(carrierPath, "utf8")) as { pid?: unknown };
    if (parsed?.pid !== pid) return;
    fs.rmSync(carrierPath, { force: true });
  } catch {
    /* absent / unreadable — nothing to remove */
  }
}

/** Is this pid a ZOMBIE (exited but not yet reaped)? `kill(pid, 0)` (i.e. `pidAlive`) sees a zombie as
 *  alive, because the entry still exists in the process table. A stop path must NOT: a zombie is a
 *  process that already exited and is only waiting for its parent to reap it — "stopped" for our
 *  purposes, never "still alive" (which would turn an already-dead preview into a failed stop). */
function isZombiePid(pid: number): boolean {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = raw.lastIndexOf(")");
    if (close < 0) return false;
    return raw.slice(close + 1).trim().split(/\s+/)[0] === "Z";
  } catch {
    return false;
  }
}

/** Signal a detached process and wait for it to die (SIGTERM, then SIGKILL after the grace). The
 *  SHARED kill for the quay-serve and declared-preview paths — ⛔ never two copies (hard rule 5b).
 *  `pid` is the registered child; when it is a process-group leader (start spawns detached) the whole
 *  group is signalled, otherwise only the pid. */
function stopPid(pid: number, graceMs: number): { state: "stopped" | "failed"; signalled: "group" | "pid"; detail: string } {
  const running = (): boolean => pidAlive(pid) && !isZombiePid(pid);
  const pgid = readProcessGroupId(pid);
  // ⛔ Never group-kill our OWN group: a host that shares the caller's group (e.g. one started with
  // `detached: false`) must be signalled by pid only, or we would kill ourselves and our parent.
  const ownPgid = readProcessGroupId(process.pid);
  const useGroup = pgid !== null && (ownPgid === null || pgid !== ownPgid);
  let signalled: "group" | "pid" = "pid";
  let signalErr: string | null = null;
  try {
    if (useGroup) {
      process.kill(-(pgid as number), "SIGTERM");
      signalled = "group";
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch (err) {
    signalErr = String((err as NodeJS.ErrnoException)?.code ?? (err as Error)?.message ?? err);
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && running()) sleepSync(100);
  if (running()) {
    try {
      if (useGroup) process.kill(-(pgid as number), "SIGKILL");
      else process.kill(pid, "SIGKILL");
    } catch {
      /* fall through to the liveness re-read below */
    }
    const killDeadline = Date.now() + 2000;
    while (Date.now() < killDeadline && running()) sleepSync(100);
  }
  if (running()) {
    return {
      state: "failed",
      signalled,
      detail: `pid ${pid} is STILL ALIVE after SIGTERM+SIGKILL${signalErr ? ` (first signal failed: ${signalErr})` : ""}`,
    };
  }
  return { state: "stopped", signalled, detail: `stopped ${signalled === "group" ? `process group ${pgid}` : `pid ${pid}`}` };
}

/** Stop the QUAY-serve preview registered at `previewRoot` by reading ITS OWN `.quay/server.json`. */
function stopQuayPreviewServe(previewRoot: string, opts: { graceMs?: number } = {}): PreviewStopReading {
  const graceMs = opts.graceMs ?? 5000;
  const read = readServerState(previewRoot);
  if (read.kind === "absent") return { state: "not-running", pid: null, signalled: null, detail: read.reason };
  if (read.kind === "unreadable") return { state: "not-evaluated", pid: null, signalled: null, detail: read.reason };
  const pid = read.state.pid;
  const carrierPath = read.path;
  const lockPath = path.join(previewRoot, ".quay", PREVIEW_SERVE_LOCK_BASENAME);
  if (!pidAlive(pid)) {
    // A stale carrier names a dead host. Clean it (and a matching stale lock) so the next start is
    // not blocked by residue — but report `not-running`, not `stopped` (nothing was signalled).
    removeCarrierIfOwned(carrierPath, pid);
    removeLockIfOwned(lockPath, pid);
    return { state: "not-running", pid, signalled: null, detail: `carrier names pid ${pid}, which is already DEAD — carrier cleared` };
  }
  const r = stopPid(pid, graceMs);
  removeCarrierIfOwned(carrierPath, pid);
  removeLockIfOwned(lockPath, pid);
  return { state: r.state, pid, signalled: r.signalled, detail: r.detail };
}

/** Stop a DECLARED preview by reading ITS OWN `.quay/preview.json` (⛔ no serve lock — the
 *  declaration replaces the serve admission lock). */
export function stopDeclaredPreviewServe(previewRoot: string, opts: { graceMs?: number } = {}): PreviewStopReading {
  const graceMs = opts.graceMs ?? 5000;
  const read = readDeclaredPreviewCarrier(previewRoot);
  if (read.state === "absent") return { state: "not-running", pid: null, signalled: null, detail: `no declared preview carrier at ${read.path}` };
  if (read.state === "unreadable") return { state: "not-evaluated", pid: null, signalled: null, detail: read.reason };
  const pid = read.carrier.pid;
  if (!pidAlive(pid)) {
    removeCarrierIfOwned(read.path, pid);
    return { state: "not-running", pid, signalled: null, detail: `carrier names pid ${pid}, which is already DEAD — carrier cleared` };
  }
  const r = stopPid(pid, graceMs);
  removeCarrierIfOwned(read.path, pid);
  return { state: r.state, pid, signalled: r.signalled, detail: r.detail };
}

/**
 * Stop the preview registered at `previewRoot` — the DECLARED surface when this root declares one,
 * else the quay-serve carrier. ⛔ NEVER `pkill -f`: the child's argv literally contains the pattern a
 * caller might search for, so a pattern kill can match the caller itself (or an unrelated workspace's
 * host).
 */
export function stopPreviewServe(previewRoot: string, opts: { graceMs?: number } = {}): PreviewStopReading {
  const decl = readPreviewDecl(previewRoot);
  if (decl.state === "unreadable") {
    return { state: "not-evaluated", pid: null, signalled: null, detail: `preview declaration unreadable: ${decl.reason}` };
  }
  if (decl.state === "configured") return stopDeclaredPreviewServe(previewRoot, opts);
  return stopQuayPreviewServe(previewRoot, opts);
}

// ── starting a preview serve ─────────────────────────────────────────────────────────────────────

export interface PreviewStartReading {
  state: "started" | "already-running" | "failed";
  pid: number | null;
  host: string | null;
  port: number | null;
  detail: string;
}

/** The preview serve runs the PREVIEW WORKTREE'S OWN quay code — that is the whole point (the human
 *  is trying the goal branch's changes). A worktree that carries no such entry cannot host a
 *  preview: fail with that reason rather than silently serving the main checkout's code. */
export function previewServeEntry(previewRoot: string): string {
  return path.join(previewRoot, "packages", "quay", "bin", "quay.ts");
}

export interface StartPreviewOptions {
  previewRoot: string;
  /** Explicit port, ≥ 1. `0` (kernel-assigned) is refused: a preview the human cannot address is
   *  not a preview (and it is the DEFAULT this flag exists to override — SPEC §4.10). */
  port: number;
  host?: string;
  /** `node --watch` (the dev-mode entry, CLAUDE.md): the serve restarts itself when a refresh
   *  rewrites the worktree, so no extra restart logic is needed. Off only for tests. */
  watch?: boolean;
  timeoutMs?: number;
  logPath?: string;
}

/** Start the QUAY-serve preview (the historical path): spawn the worktree's own `quay.ts serve`
 *  detached and wait for `.quay/server.json` to name a live pid. */
async function startQuayPreviewServe(opts: StartPreviewOptions): Promise<PreviewStartReading> {
  const { previewRoot, port } = opts;
  const entry = previewServeEntry(previewRoot);
  if (!fs.existsSync(entry)) {
    return { state: "failed", pid: null, host: null, port: null, detail: `no quay CLI entry at ${entry} — the preview worktree is missing or not provisioned (the preview must run the goal branch's OWN code)` };
  }
  const logPath = opts.logPath ?? path.join(previewRoot, ".quay", "preview-serve.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const argv: string[] = [];
  if (opts.watch !== false) argv.push("--watch");
  argv.push("--experimental-strip-types", entry, "serve", "--port", String(port));
  if (opts.host) argv.push("--host", opts.host);
  let logFd: number;
  try {
    logFd = fs.openSync(logPath, "a");
  } catch (err) {
    return { state: "failed", pid: null, host: null, port: null, detail: `cannot open preview log ${logPath}: ${String((err as Error)?.message ?? err)}` };
  }
  let childPid: number | undefined;
  try {
    const child = spawn(process.execPath, argv, {
      cwd: previewRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    });
    childPid = child.pid;
    child.unref();
  } catch (err) {
    fs.closeSync(logFd);
    return { state: "failed", pid: null, host: null, port: null, detail: `spawn failed: ${String((err as Error)?.message ?? err)}` };
  } finally {
    try {
      fs.closeSync(logFd);
    } catch {
      /* already closed */
    }
  }
  const timeoutMs = opts.timeoutMs ?? 30000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = readQuayPreviewStatus(previewRoot);
    if (st.state === "running") {
      return { state: "started", pid: st.pid, host: st.host, port: st.port, detail: `preview serve pid ${st.pid} up at ${previewRoot} (log ${logPath})` };
    }
    if (st.state === "stale") break; // a dead pid landed in the carrier — the spawn is not coming up
    sleepSync(200);
  }
  return {
    state: "failed",
    pid: childPid ?? null,
    host: null,
    port: null,
    detail: `no live preview serve registered at ${previewRoot} within ${timeoutMs}ms (supervisor pid ${childPid ?? "?"}; see ${logPath})`,
  };
}

/** Start a DECLARED preview: run the configured command detached, record the carrier, and wait for
 *  the declared health URL to answer HTTP 200. A command that cannot spawn, or never becomes healthy,
 *  is `failed` — ⛔ never `started` (the fail-closed AC). */
async function startDeclaredPreview(opts: StartPreviewOptions, config: PreviewConfig): Promise<PreviewStartReading> {
  const { previewRoot, port } = opts;
  const host = opts.host ?? "127.0.0.1";
  const vars = { port, host };
  const healthUrl = renderPreviewTemplate(config.healthUrl, vars);
  const argv = config.command.map((tok) => renderPreviewTemplate(tok, vars));
  const logPath = opts.logPath ?? path.join(previewRoot, ".quay", "preview.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  let logFd: number;
  try {
    logFd = fs.openSync(logPath, "a");
  } catch (err) {
    return { state: "failed", pid: null, host: null, port: null, detail: `cannot open preview log ${logPath}: ${String((err as Error)?.message ?? err)}` };
  }
  const spawned = await spawnDetached(argv, { cwd: previewRoot, logFd });
  try {
    fs.closeSync(logFd);
  } catch {
    /* already closed */
  }
  if (spawned.state === "failed") {
    return { state: "failed", pid: null, host: null, port: null, detail: spawned.reason };
  }
  const pid = spawned.pid;
  writeDeclaredPreviewCarrier(previewRoot, {
    schemaVersion: 1,
    pid,
    host,
    port,
    healthUrl,
    command: argv,
    startedAt: new Date().toISOString(),
  });
  const timeoutMs = opts.timeoutMs ?? 30000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeHealthUrl(healthUrl, 2000);
    if (probe.state === "ok") {
      return { state: "started", pid, host, port, detail: `declared preview pid ${pid} up at ${healthUrl} (log ${logPath})` };
    }
    if (!pidAlive(pid)) break; // the process died before becoming healthy
    sleepSync(200);
  }
  // Timeout or early death: clean the carrier + process so `failed` means "nothing is running" — a
  // failed start must not leave a live-but-unaddressed preview (or a carrier that later reads stale).
  stopDeclaredPreviewServe(previewRoot, { graceMs: 2000 });
  return { state: "failed", pid, host, port, detail: `declared preview did not answer ${healthUrl} with HTTP 200 within ${timeoutMs}ms (pid ${pid}; see ${logPath})` };
}

/**
 * Start a preview for `previewRoot` as a DETACHED process: the DECLARED command when this root
 * declares a `preview:` surface, else the worktree's own `quay.ts serve` (the historical path).
 * Waits until the product is up before reporting `started`.
 *
 * Idempotent: a preview whose carrier already names a live host is reported `already-running`
 * without spawning a second host.
 */
export async function startPreviewServe(opts: StartPreviewOptions): Promise<PreviewStartReading> {
  const { previewRoot, port } = opts;
  if (!Number.isInteger(port) || port < 1) {
    return { state: "failed", pid: null, host: null, port: null, detail: `--port must be an integer ≥ 1 (got ${JSON.stringify(port)}); a preview on an unknown port cannot be used` };
  }
  const decl = readPreviewDecl(previewRoot);
  if (decl.state === "unreadable") {
    return { state: "failed", pid: null, host: null, port: null, detail: `preview declaration unreadable: ${decl.reason}` };
  }
  const before = decl.state === "configured" ? readDeclaredPreviewStatus(previewRoot) : readQuayPreviewStatus(previewRoot);
  if (before.state === "running") {
    return { state: "already-running", pid: before.pid, host: before.host, port: before.port, detail: `a preview is already registered at ${previewRoot} (${before.detail})` };
  }
  if (decl.state === "configured") return startDeclaredPreview(opts, decl.config);
  return startQuayPreviewServe(opts);
}
