// quay-native core: task store logic (raw file ops).
// One core implementation, consumed identically by the CLI (bin/quay-native.js)
// and the MCP server (src/mcp-server.ts) — design §6 CLI/MCP symmetry.
//
// Canonical task view-model (quay-native-design.md §2, quay-proposal.md §7.1):
//   id, title, status, labels, parent, children  (+ body markdown)
// status ∈ {todo, ready, done, needs-human, superseded}   (design §3 + superseded terminal)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { TASK_STATUSES, TASK_STATUS, isTaskStatus, type Task, type TaskStatus } from '../../quay/src/abi.ts';
// gap-unified-frontmatter-parser: the ONE complete frontmatter parser now lives in the product layer
// (packages/quay/src/task-parsing.ts, next to abi.ts — gap-abi-promote-section-parsing-flip-store-
// reverse-import). This store READS through it rather than re-deriving a private YAML.parse —
// parseTask/readDependsOn/store.parse all delegate to the same function, so the schema can never
// drift across the three readers. The write-side serialize()/validateWrittenYaml() keep their own
// YAML.stringify/YAML.parse: serialization correctness is the store's, not the schema's.
import { parseFrontmatterCompletely } from "../../quay/src/task-parsing.ts";
// SPEC-store-commit-unification §4: the commit-after-write PRIMITIVE (four-state return, rev-parse
// root, pathspec-limited add+commit) lives in the product layer next to task-parsing.ts. This store
// delegates its add/commit to it and keeps only its own branch-aware ff-to-develop propagation —
// the primitive's "develop" propagate is too coarse for task/ worktree branches (fan-in ff-merge is
// the sole path into develop from a task worktree).
import { commitStoreWrite } from "../../quay/src/store-commit.ts";
// gap-shape-section-tables-dual-copy-no-single-source: the shape section-heading lists (which
// headings count as proposal/plan/ac/dod per shape) live in ONE place — plugin/scripts/shape-
// sections.ts — imported by BOTH this store (product judge) and ready-pool-check.ts (methodology
// judge). They live in plugin/scripts/ (not packages/) because quay-init lays the mechanism layer
// but NOT the packages/ source tree into consumers, so a laid-down ready-pool-check.ts can only
// reach a sibling plugin/scripts file; esbuild inlines this import into the self-contained dist
// bundle so the product build stays standalone.
import { SHAPE_SECTIONS } from "../../../plugin/scripts/shape-sections.ts";

export const VALID_STATUSES: readonly string[] = TASK_STATUSES;

/**
 * SHAPE_REGISTRY (AC1, single source of truth): the one place the task-shape →
 * required-artifact mapping lives, shared by the `check()` gate and the tests.
 * This replaces the old one-size-fits-all literal checks (`has("Proposal")`,
 * `has("Plan")`, ...) that encoded a retired task shape:
 *
 *   - ADR-022 (2026-08-03) replaced `## Plan` with `## Contract` for quay's
 *     fast-mode tasks → the `contract` shape fills the plan-slot with
 *     `## Contract` and additionally requires all six Contract keys
 *     (measure/band/invariant/invoke/control/resume) — STRICTER than a prose
 *     Plan section, not looser (the task's Chosen-mechanism constraint 2).
 *   - meta-cc's DIR template uses `## Finding` in place of `## Proposal` →
 *     the `finding` shape fills the proposal-slot with `## Finding`. A
 *     Finding task has NO `## Plan` by construction (ADR-001), so the
 *     finding shape's required-section set OMITS `plan` entirely — it is not
 *     a Plan-less shape that lazily skips the check, but a shape whose own
 *     complete contract (Finding / AC / DoD) simply has no plan dimension.
 *   - The classic milestone template is the `plan` shape (unchanged).
 *
 * Every shape's contract is complete on its own dimension; the gate dispatches
 * by shape rather than waiving checks (invariant 分派 ≠ 豁免).
 */

// gap-shape-section-tables-dual-copy-no-single-source: the section-heading lists (proposal/plan/
// ac/dod per shape) and the suffixed/draft heading variants previously lived HERE and were
// hand-copied into ready-pool-check.ts (drifted twice). They now live in ONE place —
// plugin/scripts/shape-sections.ts (imported at the top of this file) — and this registry DERIVES
// its `sections` from it. `planKeys` (the contract shape's extra artifact keys) stay here: they are
// not part of the AC/DoD heading-list drift and only the store consumes them. Adding a heading
// variant to shape-sections.ts is seen by BOTH this store (check()) and ready-pool-check.ts
// (artifactsComplete()) at once.
export const SHAPE_REGISTRY = {
  contract: {
    planKeys: ["measure", "band", "invariant", "invoke", "control", "resume"],
    // `## 人的裁定` is the directive-variant proposal-slot (DIR-123-aarch64,
    // gap-cli-quay-init-collides): a directive task carries the human ruling as proposal, the
    // implementation contract in `## Contract`.
    sections: SHAPE_SECTIONS.contract,
  },
  finding: {
    planKeys: [],
    sections: SHAPE_SECTIONS.finding,
  },
  plan: {
    planKeys: [],
    sections: SHAPE_SECTIONS.plan,
  },
  // proposal shape (2026-08-11, DIR-127 + gap-mcp-server-test-deadlocks): a task whose own complete
  // contract is Proposal / AC / DoD with NO plan dimension — symmetric with `finding` (which uses
  // `## Finding` as its proposal-slot), but the proposal-slot is the literal `## Proposal`.
  proposal: {
    planKeys: [],
    sections: SHAPE_SECTIONS.proposal,
  },
} as const;

export type TaskShape = keyof typeof SHAPE_REGISTRY | "unknown";

/** Escape regex-special characters so a heading is matched LITERALLY. Without this, a registered
 *  heading like `AC (draft)` or `Acceptance Criteria (runnable)` would be built into a `^##\s+<h>\s*$`
 *  regex where the parentheses become capture groups and NEVER match the literal `## AC (draft)` line.
 *  All the pre-variant headings are plain section names (no special chars), so escaping is a no-op for
 *  them — it only matters for the parenthesized suffix/draft variants now registered in SHAPE_REGISTRY.
 *  Mirrors ready-pool-check.ts's own escapeRegExp (same byte semantics — the single-judge contract). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `body` contain a `## <heading>` line that is EXACTLY that heading
 *  (trailing whitespace allowed)? Exact match prevents false positives from
 *  subheadings like `## Finding (measured ...)` or `## Plan execution record`.
 *  Detection uses exact match; section content extraction uses the looser
 *  `\b` match (existing behavior) once the shape is known. */
function hasExactHeading(body: string, heading: string): boolean {
  return new RegExp(`^##\\s+${heading}\\s*$`, "im").test(body);
}

/**
 * Detect a task's shape from its body, per the registered registry.
 * Precedence: contract → finding → plan. `## Finding` is checked BEFORE
 * `## Plan` because meta-cc's DIR template carries BOTH headings (Finding
 * replaces Proposal, Plan stays); classifying it as `plan` would demand a
 * `## Proposal` section the template does not have.
 *
 * A body matching none of the registered shapes is "unknown" — the gate must
 * FAIL CLOSED on it (AC5), never fall into a lenient branch.
 */
export function detectShape(body: string): TaskShape {
  if (hasExactHeading(body, "Contract")) return "contract";
  if (hasExactHeading(body, "Finding")) return "finding";
  if (hasExactHeading(body, "Plan")) return "plan";
  // proposal shape: a literal `## Proposal` section with no contract/finding/plan
  // heading. Checked AFTER contract/finding/plan so a task that carries `## Proposal`
  // alongside its shape's own proposal-slot heading still resolves to its true shape
  // (e.g. a contractBody test carries both `## Proposal` and `## Contract`).
  // A subheading like `## Finding (measured ...)` does NOT match the proposal
  // detection — exact-heading match only, so the existing unknown-shape negative
  // control (Proposal + `## Finding (measured ...)` subheading) still fails closed.
  if (hasExactHeading(body, "Proposal")) return "proposal";
  return "unknown";
}

/**
 * Extract a body section: the content after the first `## <heading>` (first
 * alias that matches) up to the next `## ` heading or the end of the body.
 * Moved to module scope (was `extractSection` inside createStore) so the
 * shape helpers below can share one implementation (single source of truth).
 */
export function sectionAfterHeading(body: string, headings: string[]): string {
  for (const h of headings) {
    // Whole-line EXACT heading match — deliberately NOT `\b`. A `\b` is only a
    // boundary between a `\w` char and a non-`\w` char; both the last char of a
    // CJK heading (e.g. 定 in `## 人的裁定`) and the following newline are
    // non-`\w`, so `\b` is a no-op there and a CJK alias NEVER matches — the
    // registered `人的裁定` proposal-slot was dead code, diverging from
    // ready-pool-check.ts (which uses task-schema.ts extractSection's
    // `^(##+)\s*<heading>\s*$` whole-line match and recognizes the same alias).
    // `^##\s+<h>\s*$` matches ASCII headings byte-for-byte as before and CJK
    // headings the same way — one consistent `\b`-free semantics as the single
    // judge.
    //
    // QN-005 fix (iteration 2): `\Z` is NOT a valid JavaScript regex
    // end-of-string anchor (JS has no \Z metacharacter) — the engine took
    // it as a literal capital "Z", and with the `i` (case-insensitive)
    // flag this also matched a bare lowercase "z" anywhere in the
    // section's prose, truncating capture early (found and root-caused
    // by the iteration-1 G3 audit against QN-005's own AC text, which
    // contains the word "zero"). Correct JS end-of-string lookahead is
    // `(?![\s\S])` (no characters remain).
    const headingRe = new RegExp(`^##\\s+${escapeRegExp(h)}\\s*$`, "im");
    const m = headingRe.exec(body);
    if (!m) continue;
    // Content = everything after the heading line up to the next `## ` heading
    // (or end of body). `^##\s` (a line starting with exactly two hashes +
    // whitespace) is the next-heading boundary — nested `### ` subheadings do
    // NOT terminate the section (unchanged from the previous `(?=^##\s|…)`).
    const rest = body.slice(m.index + m[0].length);
    const nextRe = /^##\s/m;
    const next = rest.match(nextRe);
    return next ? rest.slice(0, next.index) : rest;
  }
  return "";
}

/**
 * Contract shape (AC4): verify the `## Contract` section carries ALL six
 * mandatory keys (measure/band/invariant/invoke/control/resume) — the format
 * `task-contract-check.ts` consumes. Returns a per-key boolean
 * map. Only meaningful when `detectShape(body) === "contract"`.
 */
export function contractKeysPresent(body: string): Record<string, boolean> {
  const section = sectionAfterHeading(body, ["Contract"]);
  const present: Record<string, boolean> = {};
  for (const k of SHAPE_REGISTRY.contract.planKeys) {
    present[k] = new RegExp(`^[ \\t]*${k}\\b`, "m").test(section);
  }
  return present;
}

/**
 * DIR-047: validate a `default_task_status` value from config.
 * Returns the value unchanged when valid; throws a clear error when illegal.
 * This is the single-source validator for the config key — call it at config
 * load time so callers (CLI, MCP server) fail closed before any task is created.
 *
 * @param {string} value the raw value from .quay/config.yml
 * @returns {string} the value, confirmed valid
 * @throws {Error} when value is not in VALID_STATUSES
 */
export function resolveDefaultStatus(value: string): string {
  if (!VALID_STATUSES.includes(value)) {
    throw new Error(
      `invalid default_task_status "${value}" — must be one of ${VALID_STATUSES.join(", ")}`
    );
  }
  return value;
}

/**
 * gap-serve-search-timeout-all-body-fetch: strip structural heading lines from
 * a task body before using it as a search index, so template boilerplate
 * (`## Proposal`, `## Plan`, `## AC`, `## DoD`) does not produce false positives
 * when a search term matches a standard section name. This is the native-store
 * mirror of Core's serve-render.stripHeadings (the exact function the web UI's
 * own client-side search filter used) — byte-for-byte the same semantics, so a
 * server-side `search` filter returns exactly the tasks the web UI's
 * (now-removed-for-native) client-side filter would have. Heading lines outside
 * fenced code blocks are stripped; `# comment` lines inside ``` fences are
 * preserved (they are code content, still searchable).
 */
function stripHeadingsForSearch(text: string | undefined | null): string {
  let inFence = false;
  return (text || "").split("\n").filter((line) => {
    if (/^```/.test(line)) { inFence = !inFence; return true; }
    if (inFence) return true; // preserve code content (including # comment lines)
    return !/^#+\s/.test(line); // strip structural headings outside fences
  }).join(" ");
}

/**
 * QN-015: thrown by `write()` when a caller supplies `expectedStatus` and the
 * task's actual current status (read inside the same lock acquisition used
 * for the read-modify-write) does not match — a distinguishable class (not a
 * generic `Error`) so callers can `catch (err) { if (err instanceof
 * ConflictError) ... }` to detect a lost-update race specifically, rather
 * than parsing an error message string.
 */
export class ConflictError extends Error {
  id: string;
  expectedStatus: string | null | undefined;
  actualStatus: string | null;
  constructor(id: string, expectedStatus: string | null | undefined, actualStatus: string | null) {
    super(
      `CAS conflict on ${id}: expected status "${expectedStatus}" but ` +
        `actual current status is "${actualStatus}" — another writer changed ` +
        `it first; refusing to overwrite (write() aborted, nothing written to disk)`
    );
    this.name = "ConflictError";
    this.id = id;
    this.expectedStatus = expectedStatus;
    this.actualStatus = actualStatus;
  }
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * M89 (exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH): post-write YAML validation.
 *
 * After writing any task file, re-parse the YAML frontmatter block to confirm
 * the serialized content is valid YAML. If parsing fails, throw a descriptive
 * error so the caller knows immediately — before the corrupted file can crash
 * task_list for every other task in the store.
 *
 * gap-task-write-accepts-a-title-that-breaks-its-own-frontmatter: when the
 * intended frontmatter is supplied, ALSO verify every STRING scalar round-trips
 * byte-identically (`parsed[key] === intended[key]`). This is the fail-closed
 * "reject" path the task mandates for any value that genuinely cannot be
 * safely serialized: the write side auto-quotes via `YAML.stringify` (see
 * serialize()); if a value ever slips through that still does NOT read back
 * byte-identical (or silently truncates — the 2026-08-03 defect), the write is
 * rejected and rolled back HERE, at write time, rather than surfacing hours
 * later at render time. Non-string values (labels/children arrays, extra
 * objects, null parent) are structural and not subject to scalar quoting, so
 * they are not compared here.
 *
 * Root cause of the original defect: a task file manually (or otherwise) written with
 * an unquoted YAML value containing `: ` (colon-space) — e.g.
 *   dirStatus: mechanism-landed; routines: run (...)
 * — causes YAML.parse() to throw "Nested mappings are not allowed", which
 * propagates from list()'s per-task get() call and crashes the ENTIRE list.
 *
 * Note: YAML.stringify() already quotes string values containing `: ` when
 * called from serialize(), so correctly-routed writes produce valid YAML. This
 * gate is a belt-and-suspenders catch for any path that might produce invalid
 * YAML (e.g. direct fs.writeFileSync calls in helpers like removeChildRef /
 * addChildRef that do NOT go through serialize(), or future code additions).
 *
 * @param {string} filePath - the path of the file just written
 * @param {string} id - the task id (for the error message)
 * @param {Record<string, unknown>} [frontmatter] - the intended frontmatter the
 *   caller asked to serialize; when provided, every string scalar it declares
 *   must round-trip byte-identically or the write is rejected.
 * @throws {Error} if the written file's YAML frontmatter fails to parse, or a
 *   string scalar does not round-trip byte-identically
 */
function validateWrittenYaml(filePath: string, id: string, frontmatter?: Record<string, unknown>): void {
  let written: string;
  try {
    written = fs.readFileSync(filePath, "utf8");
  } catch (readErr) {
    throw new Error(
      `post-write YAML validation failed for task "${id}": ` +
        `could not read back the written file — ${(readErr as Error).message}`
    );
  }
  const m = FRONTMATTER_RE.exec(written);
  if (!m) {
    throw new Error(
      `post-write YAML validation failed for task "${id}": ` +
        `written file has no valid YAML frontmatter block`
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>;
  } catch (yamlErr) {
    throw new Error(
      `post-write YAML validation failed for task "${id}": ` +
        `the written frontmatter is not valid YAML — ${(yamlErr as Error).message}. ` +
        `Hint: string values containing ": " must be quoted. ` +
        `The file has NOT been left in a corrupted state — this write was rejected.`
    );
  }
  if (frontmatter) {
    for (const [key, intended] of Object.entries(frontmatter)) {
      if (typeof intended !== "string") continue; // non-string scalars are not subject to scalar quoting
      const actual = parsed[key];
      if (actual !== intended) {
        throw new Error(
          `post-write YAML validation failed for task "${id}": ` +
            `string scalar "${key}" did not round-trip byte-identically — ` +
            `wrote ${JSON.stringify(intended)} but read back ${JSON.stringify(actual)}. ` +
            `The value could not be safely serialized; the write was rejected and rolled back.`
        );
      }
    }
  }
}

/**
 * @param {string} tasksDir absolute path to the tasks directory
 * @param {{ defaultStatus?: string }} [opts] optional configuration
 *   opts.defaultStatus — the per-provider `default_task_status` from
 *   .quay/config.yml; applied when creating a NEW task with no explicit status.
 *   Must be a validated value (call resolveDefaultStatus() before passing here).
 *   Omit or pass undefined to preserve the original "todo" fallback (ADR-004:
 *   single-source — this is the ONE place the creation default is resolved).
 */
export function createStore(tasksDir: string, opts?: { defaultStatus?: string }) {
  const storeDefaultStatus = opts?.defaultStatus ?? TASK_STATUS.TODO;
  fs.mkdirSync(tasksDir, { recursive: true });

  // M26-adversarial-eval finding ADV-004 (highest-severity real finding of
  // this audit): filePathFor()/lockPathFor() previously did `path.join(
  // tasksDir, id + ".md")` with NO validation of `id` at all. `path.join`
  // does not sandbox against ".." segments -- an id like
  // "../../../../tmp/somewhere/pwned" resolves to an absolute path OUTSIDE
  // tasksDir entirely. Confirmed exploitable end-to-end via BOTH `quay-native
  // task create <id>` (CLI) and the MCP task_write tool (protocol-level, no
  // CLI needed) during this audit -- both wrote an arbitrary .md file to a
  // path chosen entirely by the (possibly untrusted, e.g. a task title/id
  // proposed by an LLM-driven caller) `id` argument, with no error and no
  // indication anything unusual happened. This is a real arbitrary-file-write
  // vulnerability, not a theoretical one. Fixed by validating `id` at this
  // single chokepoint (every read/write/lock path in this module funnels
  // through filePathFor/lockPathFor) BEFORE building the path: reject any id
  // containing a path separator (forward or back slash) or a literal ".."
  // segment, and confirm (defense in depth) the resolved path's directory is
  // still exactly tasksDir. A rejected id throws a clear, named error --
  // callers (CLI/MCP) already have top-level catch-and-report handling (see
  // bin/quay-native.js's main().catch and mcp-server.js's per-tool
  // try/catch), so this degrades safely (clear error, no crash, no file
  // written) rather than needing new plumbing.
  function assertSafeId(id) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`invalid task id: must be a non-empty string (got ${JSON.stringify(id)})`);
    }
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) {
      throw new Error(
        `invalid task id "${id}": must not contain a path separator or null byte (path-traversal guard, ADV-004)`
      );
    }
    if (id === "." || id === "..") {
      throw new Error(`invalid task id "${id}": must not be "." or ".." (path-traversal guard, ADV-004)`);
    }
    const resolved = path.resolve(tasksDir, `${id}.md`);
    if (path.dirname(resolved) !== path.resolve(tasksDir)) {
      // Defense in depth -- should be unreachable given the checks above,
      // but fail closed rather than silently writing outside tasksDir if
      // some future id shape this function didn't anticipate slips through.
      throw new Error(`invalid task id "${id}": resolves outside the task store (path-traversal guard, ADV-004)`);
    }
    return id;
  }

  function filePathFor(id) {
    assertSafeId(id);
    return path.join(tasksDir, `${id}.md`);
  }

  function lockPathFor(id) {
    assertSafeId(id);
    return path.join(tasksDir, `${id}.md.lock`);
  }

  const STALE_LOCK_MS = 5000;
  const LOCK_RETRY_MS = 20;
  const LOCK_TIMEOUT_MS = 3000;

  /**
   * Acquire an advisory exclusive lock for `id` (design §6: "shared locking
   * ... symmetry of interface must not become asymmetry of data integrity").
   * Uses exclusive-create (`wx`) as the atomic primitive; retries with
   * backoff; reclaims a stale lock (holder crashed) after STALE_LOCK_MS.
   */
  function acquireLock(id) {
    const lockPath = lockPathFor(id);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        const fd = fs.openSync(lockPath, "wx");
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return lockPath;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        // Check staleness: if the lock is older than STALE_LOCK_MS, reclaim it.
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
            fs.rmSync(lockPath, { force: true });
            continue; // retry acquisition immediately
          }
        } catch {
          // lock disappeared between EEXIST and stat — retry
          continue;
        }
        if (Date.now() > deadline) {
          throw new Error(`timed out acquiring lock for ${id} (held by another writer)`);
        }
        // Busy-wait with backoff (v0: simplest correct mechanism, no external
        // lock service — see QN-006 proposal).
        const until = Date.now() + LOCK_RETRY_MS;
        while (Date.now() < until) {
          /* spin */
        }
      }
    }
  }

  function releaseLock(lockPath) {
    fs.rmSync(lockPath, { force: true });
  }

  /** Run `fn` (a read-modify-write) holding the lock for `id`. */
  function withLock(id, fn) {
    const lockPath = acquireLock(id);
    try {
      return fn();
    } finally {
      releaseLock(lockPath);
    }
  }

  // M35: writing a task's `parent` field touches multiple files (the child
  // itself, plus its old and new parent(s)) -- withLock() alone (single id)
  // is not enough. Deadlock-safety strategy: always acquire every lock this
  // operation needs in one fixed, GLOBAL total order (ids sorted
  // lexicographically) BEFORE running the read-modify-write body, and
  // release in reverse order. Two concurrent multi-file writers that
  // reference the same set of ids (in any order the CALLER supplied them)
  // therefore always attempt to acquire those same locks in the SAME
  // sequence -- the classic "lock ordering" deadlock-avoidance discipline
  // (never let two lock-holders wait on each other in opposite order).
  // Re-entrant/duplicate ids (e.g. old parent === new parent) are
  // de-duplicated first so the same lock is never acquired twice by one
  // call (acquireLock is not re-entrant; a duplicate would either deadlock
  // against itself or double-release).
  function withLocks(ids, fn) {
    const sorted = [...new Set(ids)].sort();
    const lockPaths = [];
    try {
      for (const id of sorted) {
        lockPaths.push(acquireLock(id));
      }
      return fn();
    } finally {
      for (const lockPath of lockPaths.reverse()) {
        releaseLock(lockPath);
      }
    }
  }

  function listIds() {
    return fs
      .readdirSync(tasksDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
  }

  function readRaw(id) {
    const p = filePathFor(id);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf8");
  }

  function parse(raw) {
    const m = FRONTMATTER_RE.exec(raw);
    if (!m) {
      throw new Error("malformed task file: missing YAML frontmatter block");
    }
    // gap-unified-frontmatter-parser: delegate to the single complete frontmatter parser (shared with
    // task-schema.ts's parseTask/readDependsOn) — full YAML.parse semantics, one schema source.
    const frontmatter = parseFrontmatterCompletely(m[1]);
    const body = m[2] ?? "";
    return { frontmatter, body };
  }

  /**
   * Serialize a task's frontmatter + body to the on-disk `.md` format.
   *
   * gap-task-write-accepts-a-title-that-breaks-its-own-frontmatter: the WRITE
   * side is responsible for serialization correctness — never the content
   * author. The entire frontmatter object (title and every other string
   * scalar: status, parent, ...) is routed through the YAML library's own
   * `YAML.stringify`, which quotes/escapes any value that would otherwise be
   * misparsed — a space+`#` starts a comment (title truncates), `: ` starts a
   * nested mapping (parse throws), and values that would coerce to a number /
   * boolean / null are quoted to stay strings. We deliberately do NOT hand-roll
   * quoting rules: a hand-written rule table is exactly the class of defect
   * that produced the 2026-08-03 board outage (a title written unquoted
   * truncated at the first ` #`, the file stopped parsing, and the board 500'd
   * hours later at render time).
   *
   * Byte-compat is preserved where safe: a string value that needs NO quoting
   * is emitted exactly as before (`title: plain title` stays plain); the
   * serializer only adds quotes/escapes when the value would otherwise be
   * unsafe. `validateWrittenYaml` below is the belt-and-suspenders backstop:
   * after every write it re-parses the file and fails closed (rollback) on any
   * string scalar that does not round-trip byte-identically.
   */
  function serialize(frontmatter, body) {
    const fm = YAML.stringify(frontmatter).trimEnd();
    return `---\n${fm}\n---\n${body}`;
  }

  // gap-task-list-route-is-linear-in-task-count: mtime-keyed parse cache.
  // The task-list route calls get() once per task on EVERY request — on the
  // host measured 2026-08-03, 619 task files cost ~640ms of readFileSync +
  // YAML.parse (YAML.parse dominates: ~650ms of ~730ms in isolation; pure
  // readFileSync of all 5.7MB is only ~85ms). Caching the parsed
  // frontmatter/body keyed by (mtimeMs, size) turns repeated requests into
  // O(stats) — a few ms — instead of O(read+parse). The live-read contract
  // in CLAUDE.md is preserved because every get() re-stats the file and
  // re-reads/re-parses the moment mtime OR size changes: a NEW task file is
  // not in the cache at all, and an EDITED task's mtime/size differs from the
  // cached key → cache miss → fresh read. The cache is deliberately NEVER
  // warmed in the background (the task forbids background preheating — that
  // would turn "what's on the board right now" into a new question), and it
  // is unbounded (a per-process cache of small frontmatter strings is a few
  // hundred KB at this store's scale; G5 — no eviction machinery until the
  // store actually needs it).
  const parsedCache = new Map<string, { mtimeMs: number; size: number; frontmatter: Record<string, unknown>; body: string }>();

  // gap-native-store-title-roundtrip-nondeterministic-failures: drop the
  // parse cache for `id` after ANY in-process write to that task's file.
  //
  // The cache key is (mtimeMs, size) — a heuristic, not a content identity.
  // It does NOT change when a task file is rewritten with the SAME byte size
  // within the same mtime resolution (e.g. `title: aaa` → `title: bbb`: same
  // frontmatter length, writes a millisecond apart → identical key). Without
  // this invalidation, a get() after such a write would hit the stale entry
  // and return the PREVIOUS title's parse — a read-after-write staleness that
  // surfaced non-deterministically in store.test.mjs AC4's charset derivation
  // (which round-trips ~135 candidate titles through the same id `RT` in a
  // tight loop; the colliding key served a random earlier candidate).
  //
  // Every file write in this module MUST invalidate the ids it touched so the
  // next get() re-reads fresh. The cache remains a win for the common
  // unchanged-file case (repeated get() on an unmodified task still hits); it
  // only becomes correct-by-construction for the read-after-write case.
  //
  // gap-task-store-parse-cost-0-8s-compounds-suite-slowdown: invalidate the
  // persistent layer too (below), so a write is never served from a previous
  // process's parse of the same file.
  function invalidateCache(id: string): void {
    parsedCache.delete(id);
    persistentCache.delete(id);
    persistentCacheDirty = true;
  }

  // Persistent parse cache (gap-task-store-parse-cost-0-8s-compounds-suite-slowdown,
  // AC1/AC2/AC3). The in-process parsedCache above is per-process: a fresh CLI
  // invocation is a fresh Node process, so `task list` paid the FULL cold
  // read+YAML-parse of the store on every call (~686ms for 1110 files, measured
  // 2026-08-13). This persistent layer makes the parse result SURVIVE across
  // processes: a small JSON file next to the store holds each task's
  // YAML-parsed frontmatter keyed by (mtimeMs, size), so a later process
  // validates every file with a cheap statSync (~10ms for the whole store) and
  // only readFileSync+YAML.parses the files that actually changed.
  //
  // WHAT IS CACHED: frontmatter ONLY, never the body. The profile that chose
  // this mechanism: of the ~686ms cold store.list() for 1110 files, YAML.parse
  // is ~395ms (the dominant cost) and readFileSync is ~142ms. `task list` must
  // return the body anyway, so bodies are re-read from disk (fresh, never
  // stale); the cache eliminates the YAML.parse. A full frontmatter+body cache
  // was measured and REJECTED: a 10.9MB JSON cache took ~200ms to load — SLOWER
  // than reading the 1110 raw files (~140ms) — so caching bodies is
  // net-negative at this store's scale.
  //
  // CORRECTNESS (AC2/AC3): the (mtimeMs, size) key is the same heuristic the
  // in-process cache already uses — an added file is absent from the cache, an
  // edited file's mtime/size differs → cache miss → fresh parse, and a deleted
  // file fails statSync → never served. A corrupt/missing cache file degrades
  // to a cold parse (ensurePersistentCacheLoaded catches everything; the cache
  // is an optimization, never a correctness input). The pathological
  // same-size-same-mtime rewrite is the SAME accepted heuristic limitation the
  // in-process cache already documents.
  const PERSISTENT_CACHE_VERSION = 1;
  const PERSISTENT_CACHE_FILENAME = ".quay-parse-cache.json";
  const persistentCachePath = path.join(tasksDir, PERSISTENT_CACHE_FILENAME);
  const persistentCache = new Map<string, { mtimeMs: number; size: number; frontmatter: Record<string, unknown> }>();
  let persistentCacheLoaded = false;
  let persistentCacheDirty = false;

  /** Read the on-disk cache into `persistentCache` (merge: an entry already
   *  present — e.g. added by this process's own write() cold parse — keeps the
   *  fresh in-memory value; a stale disk entry is harmless because the walk
   *  re-parses on any (mtimeMs, size) mismatch). Lazy: only the batch surfaces
   *  (list / listWithMalformed) call this, so a standalone `task get <id>` never
   *  pays the load (the task's own note: "task get 0.18s 是定向读取不付税"). */
  function ensurePersistentCacheLoaded(): void {
    if (persistentCacheLoaded) return;
    persistentCacheLoaded = true;
    let raw: string;
    try {
      raw = fs.readFileSync(persistentCachePath, "utf8");
    } catch {
      return; // absent or unreadable → start empty; the next dirty flush rebuilds it
    }
    let data: { version?: number; entries?: Record<string, unknown> };
    try {
      data = JSON.parse(raw) as { version?: number; entries?: Record<string, unknown> };
    } catch {
      return; // corrupt cache → rebuild on the next flush
    }
    if (data.version !== PERSISTENT_CACHE_VERSION || typeof data.entries !== "object" || data.entries === null) {
      return;
    }
    for (const [id, entry] of Object.entries(data.entries)) {
      const e = entry as { mtimeMs?: unknown; size?: unknown; frontmatter?: unknown };
      if (
        e && typeof e.mtimeMs === "number" && typeof e.size === "number" &&
        typeof e.frontmatter === "object" && e.frontmatter !== null
      ) {
        persistentCache.set(id, { mtimeMs: e.mtimeMs, size: e.size, frontmatter: e.frontmatter as Record<string, unknown> });
      }
    }
  }

  /** Write the in-memory persistent cache to disk IF the batch operation dirtied
   *  it. No-op when clean; silent no-op on write failure (the cache is an
   *  optimization — a read-only store / disk-full / permission error must never
   *  break `task list`). Atomic (tmp + rename): a crash leaves either the old or
   *  the new file, never a torn one. */
  function flushPersistentCache(): void {
    if (!persistentCacheDirty) return;
    persistentCacheDirty = false;
    try {
      // Prune entries whose task file no longer exists so the cache does not grow
      // unbounded as the store's backlog shrinks.
      const liveIds = new Set(listIds());
      for (const id of [...persistentCache.keys()]) {
        if (!liveIds.has(id)) persistentCache.delete(id);
      }
      const payload = JSON.stringify({ version: PERSISTENT_CACHE_VERSION, entries: Object.fromEntries(persistentCache) });
      const tmpPath = `${persistentCachePath}.tmp`;
      fs.writeFileSync(tmpPath, payload, "utf8");
      fs.renameSync(tmpPath, persistentCachePath);
    } catch {
      // swallow — cache is an optimization, never a correctness input
    }
  }

  /** AC2 guard: the persistent cache JSON-round-trips the frontmatter, so a
   *  frontmatter carrying a type JSON cannot faithfully encode (Date, Map, Set,
   *  function, ...) must NOT be persisted — serving a silently-mangled reload
   *  (Date → ISO string, Map → {}) would violate "data consistent with a direct
   *  parse". Such entries are simply never cached persistently (the in-process
   *  parsedCache still holds the exact parse). The real store's frontmatter is
   *  all JSON-safe (scanned 2026-08-13, 1110/1110), so this is a defensive net,
   *  not the hot path. */
  function isJsonSafe(v: unknown): boolean {
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return true;
    if (Array.isArray(v)) return v.every(isJsonSafe);
    if (v instanceof Date || v instanceof Map || v instanceof Set) return false;
    if (typeof v === "object") return Object.values(v as Record<string, unknown>).every(isJsonSafe);
    return false; // undefined, function, symbol, bigint
  }

  // QX-018 (experiment 4, iteration 4): get() now includes updatedAt (file mtime
  // in ms) to close UQ-015 (task_get MCP response missing updatedAt field) and
  // enable the detail-page "last updated" display. The stat() call is cheap
  // (one fs.statSync on the already-located file) and consistent with list()'s
  // own mtime inclusion. Gate checks, childrenStatus, and other internal callers
  // already ignore unknown fields so no behavioral regression results.
  /** @returns the task view-model, or null if not found */
  function get(id: string): (Task & { updatedAt?: number }) | null {
    const taskFile = path.join(tasksDir, `${id}.md`);
    // fs.statSync(taskFile) has no options, so it returns fs.Stats (numbers), not BigIntStats.
    // `ReturnType<typeof fs.statSync>` resolves to the bigint overload's union (number|bigint
    // fields), which breaks the parsedCache/toViewModel number types (ts-typecheck-gate M63 red).
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(taskFile);
    } catch {
      // stat failed (file absent or a transient race) — fall through; readRaw
      // below re-asserts absence and returns the same null contract.
    }
    const cached = stat ? parsedCache.get(id) : undefined;
    if (cached && cached.mtimeMs === stat!.mtimeMs && cached.size === stat!.size) {
      // Cache hit: rebuild the view-model from the cached parse (no
      // readFileSync, no YAML.parse). Clone the mutable array fields so a
      // caller mutating the returned task can never poison the shared cache.
      return toViewModel({
        ...cached.frontmatter,
        labels: (cached.frontmatter.labels as string[] | undefined)?.slice() ?? [],
        children: (cached.frontmatter.children as string[] | undefined)?.slice() ?? [],
      }, cached.body, stat!.mtimeMs, id);
    }
    // Persistent-cache hit: the YAML parse survived a previous process. Confirm
    // the file's frontmatter block is still intact, then serve the cached
    // frontmatter with a freshly-read body (bodies are never cached, so they
    // cannot go stale). Falls through to the cold parse when the block is gone
    // (a file corrupted in place must fail loudly, exactly like the cold path).
    const pCached = stat ? persistentCache.get(id) : undefined;
    if (pCached && pCached.mtimeMs === stat!.mtimeMs && pCached.size === stat!.size) {
      // Direct readFileSync (no existsSync — get() already stat'd this file):
      // the whole body read is the one cost a persistent hit cannot avoid.
      let pRaw: string | null = null;
      try {
        pRaw = fs.readFileSync(taskFile, "utf8");
      } catch {
        // file vanished between stat and read → fall through; the cold readRaw
        // below re-asserts absence and returns the same null contract.
      }
      if (pRaw !== null) {
        const pm = FRONTMATTER_RE.exec(pRaw);
        if (pm) {
          const pBody = pm[2] ?? "";
          const pFrontmatter = pCached.frontmatter;
          parsedCache.set(id, { mtimeMs: stat!.mtimeMs, size: stat!.size, frontmatter: pFrontmatter, body: pBody });
          return toViewModel({
            ...pFrontmatter,
            labels: (pFrontmatter.labels as string[] | undefined)?.slice() ?? [],
            children: (pFrontmatter.children as string[] | undefined)?.slice() ?? [],
          }, pBody, stat!.mtimeMs, id);
        }
      }
    }
    const raw = readRaw(id);
    if (raw === null) return null;
    const { frontmatter, body } = parse(raw);
    if (stat) {
      parsedCache.set(id, { mtimeMs: stat.mtimeMs, size: stat.size, frontmatter, body });
      // AC2: only persist frontmatter that survives a JSON round-trip byte-for-
      // byte; a non-JSON-safe frontmatter stays in-process-only (still exact).
      if (isJsonSafe(frontmatter)) {
        persistentCache.set(id, { mtimeMs: stat.mtimeMs, size: stat.size, frontmatter });
        persistentCacheDirty = true;
      }
    }
    return toViewModel(frontmatter, body, stat ? stat.mtimeMs : undefined, id);
  }

  function toViewModel(
    frontmatter: Record<string, unknown>,
    body: string,
    updatedAt?: number,
    fallbackId?: string,
  ): Task & { updatedAt?: number } {
    const children = (frontmatter.children as string[] | undefined) ?? [];
    // gap-serve-task-list-dies-on-one-malformed-task: a task file whose
    // frontmatter lacks `id:` must NOT surface as `id: undefined` — the
    // filename IS the storage key (listIds() derives it from `<id>.md`), so it
    // is the natural fallback. The fallback keeps the view-model internally
    // consistent (CLI/Web UI never see `id: undefined`), and the `malformed`
    // marker preserves the diagnosis — fallback is NOT a fix. Previously a
    // missing `id:` silently produced `id: undefined`, which crashed the web
    // task list at serve-handlers.ts:607 (`t.id.indexOf("-")`) and took down
    // 100% of the UI for 0.5% malformed data.
    const rawId = frontmatter.id as string | undefined;
    const idMissing = typeof rawId !== "string" || rawId.length === 0;
    const resolvedId = idMissing
      ? (typeof fallbackId === "string" ? fallbackId : "")
      : rawId;
    const existingExtra = (frontmatter.extra as Record<string, unknown> | undefined) ?? {};
    const extra: Record<string, unknown> = { ...existingExtra };
    if (idMissing) {
      const existing = Array.isArray(existingExtra.malformed) ? (existingExtra.malformed as string[]) : [];
      extra.malformed = [...new Set([...existing, "missing-id"])];
    }
    // gap-abi-status-lifecycle-vocab-scattered-no-named-type: the disk-read status
    // boundary. A status frontmatter value outside the five-word lifecycle vocab is
    // REJECTED (fail-closed — hard rule 3b: an unreadable value must not look valid):
    // it is coerced to the canonical `todo` and flagged `invalid-status` in
    // `extra.malformed`, so a stray `status: reddy` can never silently surface as a
    // legal-looking `Task.status` string downstream.
    const rawStatus = frontmatter.status;
    const status: TaskStatus | null = isTaskStatus(rawStatus) ? rawStatus : null;
    if (status === null && rawStatus !== undefined) {
      const existing = Array.isArray(existingExtra.malformed) ? (existingExtra.malformed as string[]) : [];
      extra.malformed = [...new Set([...existing, "invalid-status"])];
    }
    const vm: Task & { updatedAt?: number } = {
      id: resolvedId,
      title: frontmatter.title as string,
      status: status ?? TASK_STATUS.TODO,
      labels: (frontmatter.labels as string[] | undefined) ?? [],
      parent: (frontmatter.parent as string | null | undefined) ?? null,
      children,
      // role is derived, never stored (design §2): children non-empty => compound
      role: (children.length > 0 ? "compound" : "primitive") as Task['role'],
      extra,
      body,
      // gap-webui-goal-task-rollup-via-shared-summary-cache: surface the top-level goal_ac
      // (task→AC linkage, G7) in the view-model so read surfaces can consume the structured
      // relationship. null = unset (缺值 = 未查, distinguishable from a concrete AC id), never a
      // fabricated value. Previously goal_ac was WRITE-only: task_write accepted it, task_list
      // silently dropped it — the relationship was recorded but no read surface could see it.
      goal_ac: typeof frontmatter.goal_ac === "string" ? frontmatter.goal_ac : null,
    };
    // QX-008 (experiment 4, iteration 2): include updatedAt (file mtime as ms
    // since epoch) when the caller provides it. Callers that don't need mtime
    // (e.g. childrenStatus's recursive get() calls) omit it; the list() path
    // always supplies it. Including as ms-since-epoch (number) for easy
    // numeric comparison in sort paths (CLI and Web UI).
    if (updatedAt !== undefined) vm.updatedAt = updatedAt;
    return vm;
  }

  /**
   * QN-012: given a task view-model, resolve the live status of each of its
   * declared `children` ids. A child id that does not resolve to an existing
   * task file reports status `"missing"` — a distinct, real failure mode,
   * never silently treated as `"done"`.
   *
   * QN-016 (iteration 7): made recursive. Iteration 6's independent audit
   * found the original version only read `child.status` directly — one
   * level deep — so a `done` child whose own grandchild had reverted would
   * still be reported `"done"`. Now: a child that is itself compound (has
   * its own children) is only reported `"done"` if its stored status is
   * `"done"` AND its own (recursively derived) children are all `"done"`.
   * If the child's stored status says `"done"` but its subtree is not
   * actually fully done, it is reported as the distinct status
   * `"stale-done"` — nameable and distinguishable from an honestly
   * incomplete child (`"todo"`/`"ready"`) or a dangling reference
   * (`"missing"`), matching this file's existing convention of naming
   * failure modes explicitly rather than collapsing them.
   *
   * Cycle-safety: `visited` tracks ids seen earlier in the *current* walk
   * (this call plus its own ancestors' calls, threaded through the
   * recursion). A child id that reappears within its own ancestry is
   * reported `"missing"` for the purposes of this check — a cyclic
   * parent/children graph is a data-integrity bug this gate must not crash
   * or hang on, not a case worth full cycle-detection tooling for (G5).
   */
  function childrenStatus(t, visited = new Set()) {
    if (visited.has(t.id)) {
      // Should not normally be reached (callers guard before recursing),
      // but kept as a defensive no-op-safe fallback.
      return [];
    }
    const nextVisited = new Set(visited);
    nextVisited.add(t.id);
    return (t.children || []).map((childId) => {
      if (nextVisited.has(childId)) {
        return { id: childId, status: "missing" };
      }
      const child = get(childId);
      if (!child) return { id: childId, status: "missing" };
      if (child.role === "compound") {
        const grandkids = childrenStatus(child, nextVisited);
        const subtreeOk = grandkids.every((g) => g.status === TASK_STATUS.DONE);
        const status = child.status === TASK_STATUS.DONE && !subtreeOk ? "stale-done" : child.status;
        return { id: childId, status, childrenStatus: grandkids };
      }
      return { id: childId, status: child.status };
    });
  }

  // gap-one-unparseable-task-takes-down-the-whole-board: the per-task walk
  // shared by list() and listWithMalformed(). One file whose frontmatter fails
  // to parse must poison exactly its own entry, never the whole store —
  // `onError(id, err)` is invoked for that one file so the caller decides how
  // to surface it (list() re-throws — the historical all-or-nothing behavior
  // is a CLEAR error, safe degradation per DIR-001; listWithMalformed()
  // collects it into a machine-readable failure list).
  function walkTasks(
    filter: { status?: string; label?: string; search?: string },
    onError: (id: string, err: unknown) => void,
  ): (Task & { updatedAt?: number })[] {
    const tasks: (Task & { updatedAt?: number })[] = [];
    // gap-serve-search-timeout-all-body-fetch: precompute the lowercased search
    // needle once per walk (not once per task). The search matches title + body
    // (with heading lines stripped), case-insensitively — the same predicate the
    // web UI's client-side filter used, moved server-side so the MCP round-trip
    // carries only the matches instead of every task's body.
    const sq = filter.search ? filter.search.toLowerCase() : null;
    for (const id of listIds()) {
      let t: (Task & { updatedAt?: number }) | null;
      try {
        t = get(id);
      } catch (err) {
        onError(id, err);
        continue;
      }
      if (t === null) continue;
      if (filter.status && t.status !== filter.status) continue;
      if (filter.label && !(t.labels || []).includes(filter.label)) continue;
      if (sq && !((t.title + " " + stripHeadingsForSearch(t.body)).toLowerCase().includes(sq))) continue;
      tasks.push(t);
    }
    return tasks;
  }

  function list(filter: { status?: string; label?: string } = {}): (Task & { updatedAt?: number })[] {
    // QX-008 (experiment 4, iteration 2): include updatedAt (file mtime in ms)
    // on each task in list results. This lets CLI (--sort updated) and Web UI
    // (?sort=updated) sort by recency without needing a separate fs.stat call
    // at the Core layer. The mtime is read here, once per task, as part of the
    // existing listIds() → get() walk.
    // QX-025 (experiment 4, iteration 6): remove redundant statSync. get() already
    // calls statSync internally (QX-018) and sets updatedAt on the returned
    // view-model. The prior additional statSync block here was a redundant second
    // stat on the same file — removed. Closes UQ-023 (minor: redundant statSync
    // in list() noted by G3 audit, iteration 4).
    //
    // NOTE (gap-one-unparseable-task-takes-down-the-whole-board): list()
    // deliberately KEEPS throwing on a parse failure (onError re-throws). It
    // is the provider's task_list ABI surface — via listWithMalformed() — that
    // becomes tolerant; the CLI's plain `task list` keeps the loud, clear
    // error (DIR-001 safe degradation) rather than silently dropping a file.
    //
    // gap-task-store-parse-cost-0-8s-compounds-suite-slowdown: prime the
    // persistent parse cache before the walk and flush any newly-parsed entries
    // after it, so a fresh-process list only re-parses files that changed.
    ensurePersistentCacheLoaded();
    const tasks = walkTasks(filter, (_id, err) => { throw err; });
    flushPersistentCache();
    return tasks;
  }

  /**
   * gap-one-unparseable-task-takes-down-the-whole-board: the tolerant list.
   * One task file whose frontmatter fails to parse must NOT take down the
   * whole store — it poisons exactly its own row. Returns the parseable tasks
   * PLUS a machine-readable failure list ({ file, error }, where `error` is
   * the YAML parser's own raw message) so callers — the provider's task_list
   * MCP tool, and through it the web board — can surface the bad file visibly
   * instead of 500ing the entire board. `isError` is NOT involved: this is
   * partial success, not a call-level failure.
   */
  function listWithMalformed(
    filter: { status?: string; label?: string; search?: string } = {},
  ): { tasks: (Task & { updatedAt?: number })[]; malformed: Array<{ file: string; error: string }> } {
    const malformed: Array<{ file: string; error: string }> = [];
    ensurePersistentCacheLoaded();
    const tasks = walkTasks(filter, (id, err) => {
      malformed.push({ file: `${id}.md`, error: (err as Error).message });
    });
    flushPersistentCache();
    return { tasks, malformed };
  }

  /**
   * M35: given a task id, scan every OTHER task file for ones that
   * currently list `id` in their own `children` array -- the reverse
   * index store.js does not otherwise maintain (mirrors github-client.js's
   * `writeRelations()`, which re-derives its own `buildParentIndex()` from
   * a full issue fetch rather than keeping a standing index). A full
   * directory scan is O(n) in task count; acceptable at this store's scale
   * (explicitly out of scope to add a persistent reverse-index/cache --
   * charter M35-native-relation-sync). Returns ids only (not full
   * view-models) since callers just need the id set for locking/mutation.
   */
  function findCurrentParents(id) {
    const parents = [];
    for (const otherId of listIds()) {
      if (otherId === id) continue;
      const raw = readRaw(otherId);
      if (raw === null) continue;
      const { frontmatter } = parse(raw);
      if (Array.isArray(frontmatter.children) && frontmatter.children.includes(id)) {
        parents.push(otherId);
      }
    }
    return parents;
  }

  /**
   * Remove `childId` from `parentId`'s `children` array on disk, if present.
   * Caller must already hold `parentId`'s lock.
   */
  function removeChildRef(parentId, childId) {
    const raw = readRaw(parentId);
    if (raw === null) return; // parent file vanished concurrently -- nothing to clean up
    const { frontmatter, body } = parse(raw);
    const current = Array.isArray(frontmatter.children) ? frontmatter.children : [];
    if (!current.includes(childId)) return; // already absent (e.g. another writer beat us to it)
    const updated = { ...frontmatter, children: current.filter((c) => c !== childId) };
    fs.writeFileSync(filePathFor(parentId), serialize(updated, body), "utf8");
    invalidateCache(parentId);
  }

  /**
   * Add `childId` to `parentId`'s `children` array on disk, if not already
   * present. Caller must already hold `parentId`'s lock.
   */
  function addChildRef(parentId, childId) {
    const raw = readRaw(parentId);
    if (raw === null) return; // new parent id does not resolve to a real task -- nothing to add to
    const { frontmatter, body } = parse(raw);
    const current = Array.isArray(frontmatter.children) ? frontmatter.children : [];
    if (current.includes(childId)) return; // already present
    const updated = { ...frontmatter, children: [...current, childId] };
    fs.writeFileSync(filePathFor(parentId), serialize(updated, body), "utf8");
    invalidateCache(parentId);
  }

  // ── COMMIT-AFTER-WRITE (gap-abi-missing-commit-delete-dependson-primitives) ──────────────────────
  // task_write / task_delete write to disk; every consumer of task state on the dispatch/lifecycle
  // spine (ready-pool-check / slot-refill / worker-driver / Web UI) reads `git show develop:tasks/
  // <id>.md`, never disk. A disk-only write is therefore dispatch-invisible until something ELSE
  // commits and (when the write happened in a task worktree) ff-merges it into develop — the disk
  // value silently loses to the git-ref value, indistinguishable from "the edit never happened"
  // (CLAUDE.md 硬规则 3b/4b). This block adds a scoped, branch-aware commit primitive to the write
  // path: commit `tasks/<id>.md` ALONE (pathspec, never `-A`), and — when on the main checkout (a
  // branch that is NOT develop and NOT a `task/<id>` worktree branch) — ff-push to develop so the
  // write becomes dispatch-visible. Inside a task worktree the commit lands on the worktree's own
  // branch and develop is left untouched (fan-in ff-merge remains the only path into develop, AC2).

  /** The git root containing `tasksDir`, or null when not inside a git work tree (unit-test temp
   *  dirs / repo-less roots — the commit is then a no-op, never a throw). Memoized: `tasksDir` does
   *  not move for the store's lifetime, so a temp-dir store pays exactly ONE failed `rev-parse`. */
  let _gitRoot: string | null | undefined;
  function resolveGitRoot(): string | null {
    if (_gitRoot !== undefined) return _gitRoot;
    try {
      const out = execFileSync("git", ["-C", tasksDir, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      _gitRoot = out.trim() || null;
    } catch {
      _gitRoot = null;
    }
    return _gitRoot;
  }

  /** Current branch name of the git root, or null (detached HEAD / not in git). */
  function currentBranch(root: string): string | null {
    try {
      const out = execFileSync("git", ["-C", root, "branch", "--show-current"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  /** Whether `rel` exists in HEAD (the git blob `HEAD:<rel>`). False when the file was never
   *  committed — the "nothing to stage" guard for deleting an untracked file. */
  function inHead(root: string, rel: string): boolean {
    try {
      execFileSync("git", ["-C", root, "cat-file", "-e", `HEAD:${rel}`], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  /** ff-push `branch` to develop (fast-forward only, `git push . <branch>:develop`). Non-ff / git
   *  error ⇒ false. The semantic-sync fallback for a forked main checkout is NOT this store's job —
   *  the driver's standing `propagateDocBranchToDevelop` owns that case. */
  function ffPushToDevelop(root: string, branch: string): boolean {
    try {
      execFileSync("git", ["-C", root, "push", ".", `${branch}:develop`], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  // ── gap-store-commit-propagation-field-aware (SPEC-store-commit-unification §5) ────────────────
  // Field-level propagation judgment: a write's strategy is decided by WHO reads the changed field,
  // not WHO wrote it. Three field classes are read ONLY by the task's own fan-in (ac-precheck /
  // flip AC gate / Evidence rendering) and may therefore stay on the task's branch until fan-in:
  //   · AC/DoD checkbox toggles (`- [ ]` ↔ `- [x]`)
  //   · `## Evidence` section content (append/edit — incl. suffixed variants `## Evidence（…）`)
  //   · the task's own goal association (`goal_ac` top-level, `extra.goal` nested)
  // A write whose change set is ONLY these is "self-only": even on a non-`task/*` branch it must
  // NOT ff to develop (the task's own fan-in carries it to develop with the worktree branch).
  // Anything else — new-task creation, status/lifecycle flips, title/labels/parent/children, any
  // non-goal `extra` key, any body edit outside Evidence/checkbox markers — is "must-propagate"
  // and keeps the current behavior (宁可多推、不可少推: a mixed write is never misread as pure-AC).

  /** Order-insensitive deep equality — used only to compare two frontmatter objects field-by-field
   *  with the self-only goal fields masked out. */
  function deepEqualSelfOnly(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((v, i) => deepEqualSelfOnly(v, b[i]));
    }
    if (typeof a === "object" && typeof b === "object") {
      const ak = Object.keys(a as Record<string, unknown>);
      const bk = Object.keys(b as Record<string, unknown>);
      if (ak.length !== bk.length) return false;
      const bs = new Set(bk);
      if (!ak.every((k) => bs.has(k))) return false;
      return ak.every((k) => deepEqualSelfOnly((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    }
    return false;
  }

  /** Strip the self-only frontmatter fields (`goal_ac`, `extra.goal`) so any OTHER frontmatter
   *  change surfaces as a difference. */
  function stripSelfOnlyFrontmatter(fm: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fm)) {
      if (k === "goal_ac") continue;
      if (k === "extra") {
        const e = v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
        delete e.goal;
        out[k] = e;
        continue;
      }
      out[k] = v;
    }
    return out;
  }

  /** Normalize the body's self-only changes: (a) AC/DoD checkbox markers → canonical `[·]` so a
   *  `- [ ]`↔`- [x]` toggle is invisible; (b) the ENTIRE `## Evidence` section (heading + content,
   *  incl. suffixed variants) is stripped, so appending/editing/removing evidence — read only by
   *  the task's own fan-in — is invisible too. */
  function maskSelfOnlyBody(body: string): string {
    let out = body.replace(/^([ \t]*[-*][ \t]+)\[[ xX~]\]([ \t]+)/gm, "$1[·]$2");
    for (;;) {
      const m = /^##[ \t]+Evidence\b.*$/m.exec(out);
      if (!m) break;
      const headingStart = m.index;
      const contentStart = m.index + m[0].length;
      const rest = out.slice(contentStart);
      const next = /^##[ \t]/m.exec(rest);
      const contentEnd = contentStart + (next ? next.index : rest.length);
      out = out.slice(0, headingStart) + out.slice(contentEnd);
    }
    // Strip a trailing Evidence section leaves its leading blank-line separator as trailing
    // whitespace (before ends at the previous section, after ends with the separator). Trailing
    // whitespace is not a field — trim it so an Evidence-only append compares equal (end-of-file
    // whitespace is not read by any consumer).
    return out.trimEnd();
  }

  /** Field-level change classification: "self-only" iff the ONLY differences between the before
   *  and after (frontmatter + body) are the three self-only field classes above. */
  function classifyTaskWriteChange(
    beforeFrontmatter: Record<string, unknown>,
    beforeBody: string,
    afterFrontmatter: Record<string, unknown>,
    afterBody: string,
  ): "self-only" | "must-propagate" {
    if (!deepEqualSelfOnly(stripSelfOnlyFrontmatter(beforeFrontmatter), stripSelfOnlyFrontmatter(afterFrontmatter))) {
      return "must-propagate";
    }
    if (maskSelfOnlyBody(beforeBody) !== maskSelfOnlyBody(afterBody)) return "must-propagate";
    return "self-only";
  }

  /** GOAL-011 AC-220（gap-store-commit-propagation-log，退出条件①②的直接生产证据）：把
   *  `commitTaskWrite` 每一次「committed:true」的传播决定追加写入
   *  `<root>/.quay/store-commit-propagation.jsonl`（gitignored 运行时日志，worker-outcome.jsonl
   *  同族）——这是该函数自己的决定，不是从 ff-red 率反推的间接信号（硬规则「推论三」：measure the
   *  actual production carrier, not a downstream noisy symptom）。⛔ 日志写入失败不得影响真实的
   *  commit/propagate 结果（best-effort、try/catch 吞掉）——观测不得阻塞主执行
   *  （observation-must-not-block-main-execution，人 2026-08-30 裁定）。 */
  function logPropagationOutcome(root: string, rec: {
    id: string;
    verb: "task_write" | "task_delete";
    changeKind: "self-only" | "must-propagate";
    branchClass: "develop" | "task-branch" | "other";
    propagated: boolean;
  }): void {
    try {
      const file = path.join(root, ".quay", "store-commit-propagation.jsonl");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n", "utf8");
    } catch {
      // best-effort telemetry — never let a log-write failure affect the real commit outcome.
    }
  }

  /** Commit `tasks/<id>.md` (branch-aware) after a successful write/delete, delegating the git
   *  add/commit to the shared primitive `commitStoreWrite` (SPEC-store-commit-unification §3) and
   *  keeping only this store's own branch-aware ff-to-develop propagation. Returns
   *  `{ committed, propagated, status }` — honest, distinguishable outcomes, never "silent success"
   *  (硬规则 3b):
   *    status "committed"  — the change is on the current branch's git history (propagated reports
   *                          whether it also reached develop).
   *    status "not-in-git" — the store's tasksDir is not inside a git work tree (unit-test temp
   *                          dirs): a deliberate no-op, NOT a failure.
   *    status "nothing"    — nothing to stage/commit (deleting a never-committed untracked file, or
   *                          a byte-identical write the primitive restored to HEAD).
   *    status "failed"     — the git add/commit itself errored: a REAL failure (the disk change is
   *                          not on any branch's history).
   *  Callers log only `failed` — the other non-committed states are expected and must not be
   *  mistaken for a broken commit. */
  function commitTaskWrite(id: string, verb: "task_write" | "task_delete", changeKind: "self-only" | "must-propagate" = "must-propagate"): { committed: boolean; propagated: boolean; status: "committed" | "not-in-git" | "nothing" | "failed" } {
    const root = resolveGitRoot();
    if (root === null) return { committed: false, propagated: false, status: "not-in-git" };
    const rel = path.join("tasks", `${id}.md`);
    // "nothing" guard BEFORE delegating: deleting a never-committed untracked file has no index
    // entry to stage — a DISTINGUISHABLE no-op, never conflated with "failed" (硬规则 3b). The
    // primitive's four states have no "nothing" (SPEC §3), so this edge stays here.
    if (!fs.existsSync(path.join(root, rel)) && !inHead(root, rel)) {
      return { committed: false, propagated: false, status: "nothing" };
    }
    const res = commitStoreWrite({
      relPath: rel,
      kind: "tasks",
      id,
      action: verb,
      root,
      propagate: "none", // branch-aware ff below; the primitive's "develop" is too coarse for task/ branches
    });
    if (res.outcome === "not-in-git") return { committed: false, propagated: false, status: "not-in-git" };
    if (res.outcome === "unchanged") return { committed: false, propagated: false, status: "nothing" };
    if (res.outcome === "failed") return { committed: false, propagated: false, status: "failed" };
    const branch = currentBranch(root);
    if (branch === null || branch === "develop") {
      // detached HEAD, or already on develop — nothing further to propagate.
      const propagated = branch === "develop";
      logPropagationOutcome(root, { id, verb, changeKind, branchClass: "develop", propagated });
      return { committed: true, propagated, status: "committed" };
    }
    if (branch.startsWith("task/")) {
      // Task worktree: commit to the worktree's own branch only; fan-in ff-merge is the sole path
      // into develop (AC2 negative control).
      logPropagationOutcome(root, { id, verb, changeKind, branchClass: "task-branch", propagated: false });
      return { committed: true, propagated: false, status: "committed" };
    }
    if (verb === "task_write" && changeKind === "self-only") {
      // Self-only write (AC ticks / Evidence / goal association) on a non-task/* branch: do NOT ff
      // to develop — the task's own fan-in carries it to develop with the worktree branch
      // (gap-store-commit-propagation-field-aware, SPEC §5).
      logPropagationOutcome(root, { id, verb, changeKind, branchClass: "other", propagated: false });
      return { committed: true, propagated: false, status: "committed" };
    }
    const propagated = ffPushToDevelop(root, branch);
    logPropagationOutcome(root, { id, verb, changeKind, branchClass: "other", propagated });
    return { committed: true, propagated, status: "committed" };
  }

  /**
   * Raw file write — used by both `task create` (internal convenience,
   * not part of the ABI surface table but needed to seed tasks) and `edit`.
   *
   * M35: writing `parent` is now bidirectional, matching the github
   * provider's `writeRelations()` contract (github-client.js ~L771-830):
   * it removes `id` from every OTHER task's `children` array that
   * currently lists it (reassignment or unset), and adds `id` to the new
   * parent's `children` array (if not already present). `children` and
   * `parent` fields, when both supplied in one call, are applied
   * independently in the same order github uses (children first, then
   * parent) -- there is no interaction between them (this task's own
   * `children` lives in its own file; its `parent` link's mirror lives in
   * some OTHER task's file).
   *
   * Lock-order / deadlock strategy: a parent-field write touches multiple
   * files (child + old parent(s) + new parent), unlike every other field
   * write() handles (single-file). To avoid a lock-order deadlock between
   * two concurrent multi-file writers, the full set of ids this call needs
   * is determined FIRST (via an unlocked `findCurrentParents()` pre-scan --
   * see below for why an unlocked scan is safe here), then ALL locks for
   * that set are acquired together via `withLocks()`, which sorts ids into
   * one fixed global order before acquiring any of them (see withLocks()'s
   * own comment). This guarantees two concurrent writers touching an
   * overlapping id set always acquire their shared locks in the same
   * relative order, so neither can be stuck holding lock A while waiting on
   * lock B that the other holds while waiting on A.
   *
   * The pre-scan itself is unlocked (a plain read, not inside any lock) and
   * so is inherently racy against a concurrent parent-write finishing
   * between the scan and the lock acquisition -- but this is safe, not just
   * tolerated: the CHILD's own lock is always in the acquired set (it is
   * `id` itself), so once all locks are held, the parent-removal step
   * below re-reads each candidate parent's file fresh (not the pre-scan's
   * stale snapshot) and only removes `id` if it is still actually present
   * (`removeChildRef` no-ops if absent) -- so a parent added or removed by
   * a racing writer between the scan and the lock acquisition is simply
   * re-validated, never blindly trusted. The only residual gap: a NEW
   * concurrent parent relationship created *after* this call's lock set is
   * fixed, naming an id outside that set, cannot be seen by this call --
   * but that writer will itself acquire this child's lock (since it too
   * must lock the child to write it) and will run either fully before or
   * fully after this call, never interleaved, so no corruption results,
   * only ordinary last-writer-wins sequencing (identical to every other
   * field this store already handles).
   */
  function write(id: string, { title, status, labels, parent, children, extra, body, depends_on, goal_ac, expectedStatus }: { title?: string; status?: string; labels?: string[]; parent?: string | null; children?: string[]; extra?: Record<string, unknown>; body?: string; depends_on?: string[]; goal_ac?: string; expectedStatus?: string }, opts?: { commit?: boolean }): (Task & { updatedAt?: number }) | null {
    // COMMIT-AFTER-WRITE (gap-abi-missing-commit-delete-dependson-primitives): commit-by-default,
    // opt-out per call via `{ commit: false }` (multi-file batch editors commit once at the end).
    const commit = opts?.commit !== false;
    if (status && !VALID_STATUSES.includes(status)) {
      throw new Error(
        `invalid status "${status}" — must be one of ${VALID_STATUSES.join(", ")}`
      );
    }

    const parentWriteRequested = parent !== undefined;
    // Unlocked pre-scan (see write()'s own doc comment above for why this
    // is safe): determine which ids we need to lock BEFORE acquiring any
    // lock, so withLocks() can sort the complete set into one fixed order.
    const oldParentIds = parentWriteRequested ? findCurrentParents(id) : [];
    const lockIds = [id, ...oldParentIds];
    if (parentWriteRequested && parent) lockIds.push(parent);

    // QN-006: read-modify-write is lock-protected so CLI and MCP writers
    // (the same store.js core, design §6) never interleave on the same file.
    // gap-store-commit-propagation-field-aware: default "must-propagate" so a NEW file (no before
    // state) and any error path keep the current ff-to-develop behavior — the field-level judgment
    // can only downgrade a write to "self-only", never the other way.
    let writeChangeKind: "self-only" | "must-propagate" = "must-propagate";
    const result = withLocks(lockIds, () => {
      const existingRaw = readRaw(id);
      let frontmatter: Record<string, unknown> = { id, title, status, labels: labels ?? [], parent: parent ?? null, children: children ?? [] };
      let existingBody = "";
      let beforeFrontmatter: Record<string, unknown> | null = null;
      if (existingRaw !== null) {
        const parsed = parse(existingRaw);
        beforeFrontmatter = parsed.frontmatter;
        frontmatter = { ...parsed.frontmatter };
        existingBody = parsed.body;
        // QN-015: the CAS check MUST happen here, inside the same lock
        // acquisition already used for the read-modify-write below — checking
        // status before acquiring the lock (or in a separate call) would
        // reopen exactly the TOCTOU race this option exists to close.
        if (expectedStatus !== undefined && frontmatter.status !== expectedStatus) {
          throw new ConflictError(id, expectedStatus, frontmatter.status as string | null);
        }
        if (title !== undefined) frontmatter.title = title;
        if (status !== undefined) frontmatter.status = status;
        if (labels !== undefined) frontmatter.labels = labels;
        // M35: children applied before parent, mirroring github's
        // writeRelations() ordering (the two fields don't interact, but
        // matching the reference order keeps behavior predictable across
        // providers if a future caller ever supplies both at once).
        if (children !== undefined) frontmatter.children = children;
        if (parent !== undefined) frontmatter.parent = parent;
        if (extra !== undefined) frontmatter.extra = extra;
        if (depends_on !== undefined) frontmatter.depends_on = depends_on;
        if (goal_ac !== undefined) frontmatter.goal_ac = goal_ac;
      } else {
        // No existing file: there is no "current status" to compare against,
        // so any expectedStatus is by definition a mismatch (there is
        // nothing to CAS against) — fail closed, not open.
        if (expectedStatus !== undefined) {
          throw new ConflictError(id, expectedStatus, null);
        }
        frontmatter.extra = extra ?? {};
        if (depends_on !== undefined) frontmatter.depends_on = depends_on;
        if (goal_ac !== undefined) frontmatter.goal_ac = goal_ac;
        // DIR-047 (ADR-004 single-source): apply the configured creation
        // default when creating a NEW task with no explicit status.
        // storeDefaultStatus is the per-provider default_task_status from
        // .quay/config.yml (already validated), falling back to "todo" when
        // absent — preserving byte-for-byte backward compatibility.
        if (frontmatter.status === undefined) {
          frontmatter.status = storeDefaultStatus;
        }
      }
      const finalBody = body !== undefined ? body : existingBody;
      const raw = serialize(frontmatter, finalBody);
      // Field-level propagation judgment (SPEC §5) — classify BEFORE the file write so the caller's
      // change set (not a re-read of the just-written file) decides whether to ff to develop.
      if (beforeFrontmatter !== null) {
        writeChangeKind = classifyTaskWriteChange(beforeFrontmatter, existingBody, frontmatter, finalBody);
      }
      const taskFilePath = filePathFor(id);
      // M89 (exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH): post-write YAML
      // validation — write, then immediately re-parse the frontmatter.
      // On validation failure: restore the prior content (or remove the file if
      // it was newly created) so the store is never left in a corrupted state
      // that would crash task_list for all other tasks.
      fs.writeFileSync(taskFilePath, raw, "utf8");
      // Read-after-write correctness: the file just changed; the (mtimeMs, size)
      // cache key may be UNCHANGED (same-size rewrite in the same mtime tick),
      // so drop any cached parse for this id BEFORE the trailing get() below.
      invalidateCache(id);
      try {
        validateWrittenYaml(taskFilePath, id, frontmatter);
      } catch (validationErr) {
        // Rollback: restore prior content if it existed, or remove the new file.
        if (existingRaw !== null) {
          fs.writeFileSync(taskFilePath, existingRaw, "utf8");
        } else {
          try { fs.rmSync(taskFilePath, { force: true }); } catch { /* ignore */ }
        }
        throw validationErr;
      }

      // M35: bidirectional relation sync -- only runs when `parent` was
      // actually part of this write() call (parentWriteRequested), never
      // as a side effect of some unrelated field write. All ids below are
      // already covered by the `lockIds` set acquired above.
      if (parentWriteRequested) {
        for (const oldParentId of oldParentIds) {
          if (parent && oldParentId === parent) continue; // already correctly parented there
          removeChildRef(oldParentId, id);
        }
        if (parent) {
          addChildRef(parent, id);
        }
      }

      return get(id);
    });
    // Commit AFTER the lock is released (a git commit is not a file-lock concern; holding the
    // advisory lock across a git subprocess would serialize writers for no data-integrity gain).
    if (commit && result !== null) {
      const c = commitTaskWrite(id, "task_write", writeChangeKind);
      if (c.status === "failed") {
        // The disk write succeeded but the git commit (the dispatch-visibility half) genuinely
        // FAILED — never throw (the caller's write IS on disk), but surface on stderr so the failure
        // is observable, not silent (硬规则 3b). "not-in-git" (temp dirs) and "nothing" are expected
        // no-ops and deliberately do NOT log.
        console.error(
          `quay-native store: task_write "${id}" wrote to disk but the commit FAILED (committed=${c.committed}, propagated=${c.propagated})`
        );
      }
    }
    return result;
  }

  /**
   * task_delete (gap-abi-missing-commit-delete-dependson-primitives): remove a task file (unlink) +
   * the same branch-aware commit as write. Fail-closed on a missing id (a delete that removes nothing
   * must NOT read as success — 硬规则 3b, no silent no-op). Drops the task's parse-cache entry (its
   * advisory lock is released by withLock). Returns `{ id, ok, reason, committed, propagated }` —
   * `ok:false` with `reason:"missing"` is the not-found contract the MCP handler maps to isError.
   */
  function deleteTask(id: string, opts?: { commit?: boolean }): { id: string; ok: boolean; reason: string; committed: boolean; propagated: boolean } {
    const commit = opts?.commit !== false;
    const taskFilePath = filePathFor(id);
    if (!fs.existsSync(taskFilePath)) {
      return { id, ok: false, reason: "missing", committed: false, propagated: false };
    }
    return withLock(id, () => {
      // Re-check under the lock (the file may have vanished between the existsSync above and here).
      if (!fs.existsSync(taskFilePath)) {
        return { id, ok: false, reason: "missing", committed: false, propagated: false };
      }
      fs.rmSync(taskFilePath, { force: true });
      invalidateCache(id);
      let committed = false;
      let propagated = false;
      if (commit) {
        const c = commitTaskWrite(id, "task_delete");
        committed = c.committed;
        propagated = c.propagated;
        if (c.status === "failed") {
          // The file removal succeeded but the deletion commit genuinely FAILED — surface on stderr
          // (observable, not silent; 硬规则 3b). "not-in-git" / "nothing" are expected no-ops.
          console.error(
            `quay-native store: task_delete "${id}" removed the file but the deletion commit FAILED (committed=${c.committed}, propagated=${c.propagated})`
          );
        }
      }
      return { id, ok: true, reason: "deleted", committed, propagated };
    });
  }

  function appendNote(id: string, note: string): (Task & { updatedAt?: number }) | null {
    // appendNote's own read-modify-write goes through write()'s lock too,
    // but the read of current body must ALSO be inside the lock to avoid a
    // lost-update race between the read here and write()'s internal read.
    //
    // QN-015 scope note (deliberate, stated, not silently dropped): unlike
    // write(), appendNote() does NOT support expectedStatus / CAS. Its own
    // use case (appending a timestamped note to the body) does not naturally
    // have an "expected prior status" precondition the way a status-changing
    // write() does — a note is usually appendable regardless of the task's
    // current lifecycle stage. Extending the CAS guarantee here was evaluated
    // and explicitly deferred (G5): the TOCTOU race this task closes is
    // specifically the read-decide-write status-transition race (design §3
    // gate-check pattern), which appendNote() does not participate in.
    return withLock(id, () => {
      const raw = readRaw(id);
      if (raw === null) throw new Error(`no such task: ${id}`);
      const { frontmatter, body } = parse(raw);
      const stamp = new Date().toISOString();
      const newBody = `${body.trimEnd()}\n\n---\n_${stamp}_: ${note}\n`;
      const updated = { ...frontmatter };
      const finalRaw = serialize(updated, newBody);
      const noteFilePath = filePathFor(id);
      fs.writeFileSync(noteFilePath, finalRaw, "utf8");
      // Read-after-write correctness (same class as write()): drop any cached
      // parse for this id before the trailing get() re-reads it fresh.
      invalidateCache(id);
      // M89: post-write YAML validation (same discipline as write() above).
      try {
        validateWrittenYaml(noteFilePath, id, updated);
      } catch (validationErr) {
        // Rollback: restore prior content (appendNote() always modifies an
        // existing file — existingRaw is never null here).
        fs.writeFileSync(noteFilePath, raw, "utf8");
        throw validationErr;
      }
      return get(id);
    });
  }

  /**
   * The four mandatory artifacts (design §2, §3): Proposal, Plan, AC, DoD.
   * QN-005 (iteration 2): presence-based-only was too thin (a heading
   * followed by one word passed). Now requires each section's heading to
   * exist AND its content (up to the next `##` heading) to exceed
   * MIN_SECTION_CHARS non-whitespace characters — catches the
   * heading-with-no-real-content failure mode without attempting semantic
   * quality scoring (out of scope for a mechanical gate; that is what
   * independent review/audit is for, per design §3/G3).
   *
   * QN-030 (iteration 20): the same boundary applies to `check()`'s AC
   * checkbox counting below — presence/checked-state is verified, never
   * claim truth. This was asserted in prose for 9+ iterations before being
   * demonstrated live in test/gate-gameability.test.mjs (a checked-but-
   * false AC claim passes both the author->ready and execute->done gates).
   * This is expected, structural, and permanent — see that test file's own
   * header before treating a future change here as a "fix" for it.
   */
  const MIN_SECTION_CHARS = 40;

  /**
   * Presence of the registered gate artifacts for a given shape, per
   * SHAPE_REGISTRY. `shape` is the detected shape (see detectShape); the
   * sections each shape requires come from the registry, so the aliases each
   * project actually uses (quay: `## Contract` for Plan; meta-cc: `## Finding`
   * for Proposal) are honored WITHOUT loosening any shape's own contract. An
   * unknown shape yields all-false (the check() caller fails it closed).
   *
   * The artifact map is built from THE SHAPE'S OWN registered sections only —
   * dispatch is not a waiver (each shape has a complete contract on its own
   * dimension). The `finding` shape deliberately has no `plan` section
   * (ADR-001: a Finding task has no `## Plan`), so `plan` is ABSENT from its
   * map rather than present-and-false. The plan shape still carries a real
   * `plan` artifact, so a Plan-shape task missing `## Plan` stays red.
   */
  function artifactSections(body, shape = detectShape(body)) {
    const spec = SHAPE_REGISTRY[shape];
    if (!spec) {
      return { proposal: false, plan: false, ac: false, dod: false };
    }
    const has = (headings) => {
      for (const h of headings) {
        // Whole-line exact presence check (same CJK-safe, `\b`-free semantics
        // as sectionAfterHeading): `\b` is a no-op between two non-word chars,
        // so `## 人的裁定` (last char 定 is CJK, next char is the newline)
        // never matched the old `^##\s+人的裁定\b` — the registered alias was
        // dead code and the proposal artifact read false for a present section.
        if (!new RegExp(`^##\\s+${escapeRegExp(h)}\\s*$`, "im").test(body)) continue;
        const content = sectionAfterHeading(body, [h]);
        const nonWhitespaceLen = content.replace(/\s/g, "").length;
        if (nonWhitespaceLen >= MIN_SECTION_CHARS) return true;
      }
      return false;
    };
    const artifacts = {};
    for (const [artifact, headings] of Object.entries(spec.sections)) {
      artifacts[artifact] = has(headings);
    }
    return artifacts;
  }

  /**
   * `task check <id>` — asserts the author->ready and execute->done gates
   * (design §3). Returns a structured result; does not mutate status itself
   * (mutation is a separate `edit --status` call by the Skill/human).
   */
  function check(id: string): Record<string, unknown> {
    const t = get(id);
    if (!t) return { id, ok: false, reason: "not found" };

    // gap-abi-status-lifecycle-vocab-scattered-no-named-type: the disk-read
    // boundary coerces an out-of-vocab on-disk status to `todo` and flags it
    // `invalid-status` in extra.malformed (fail-closed at the parse boundary).
    // The gate must NOT treat that coerced `todo` as a genuine todo — otherwise
    // a stray `status: reddy` would pass author->ready. Recover the original
    // value for an actionable reason and fail closed with gate:"unknown" (the
    // pre-coercion contract that task-check/gate-correctness tests pin).
    const malformed = Array.isArray(t.extra?.malformed) ? (t.extra.malformed as string[]) : [];
    if (malformed.includes("invalid-status")) {
      const raw = readRaw(id);
      const rawStatus = raw !== null ? (parse(raw).frontmatter.status as string | undefined) : undefined;
      return { id, gate: "unknown", ok: false, reason: `unrecognized status ${rawStatus}` };
    }

    if (t.status === TASK_STATUS.TODO) {
      const gate = "author->ready";
      // Shape dispatch (ADR-001 re-landed; gap-the-dod-gate-encodes-a-retired-
      // task-shape): the required sections depend on the task's registered
      // shape. Contract (quay fast mode, `## Contract` for Plan) and finding
      // (meta-cc DIR, `## Finding` for Proposal) each have their own COMPLETE
      // contract — dispatch is not a waiver.
      const shape = detectShape(t.body);
      const artifacts = artifactSections(t.body, shape);
      const allArtifactsPresent = Object.values(artifacts).every(Boolean);

      // AC5 (fail-closed): an unknown shape must never fall into a lenient
      // branch — otherwise "pick a template" becomes a new way to bypass the
      // gate. Every registered shape has a complete contract; a body that
      // matches none is refused.
      if (shape === "unknown") {
        return {
          id,
          gate,
          ok: false,
          shape,
          artifacts,
          reason:
            "unrecognized task shape (no ## Contract / ## Finding / ## Plan section) — unknown shapes fail closed; register the shape before it can pass",
        };
      }

      // Contract shape (AC4): the `## Contract` section must carry ALL six
      // keys (measure/band/invariant/invoke/control/resume) — stricter than a
      // prose Plan section, never looser. Failure names the missing key(s).
      const contractKeys =
        shape === "contract" ? contractKeysPresent(t.body) : undefined;
      if (shape === "contract" && allArtifactsPresent && contractKeys) {
        const missing = SHAPE_REGISTRY.contract.planKeys.filter(
          (k) => !contractKeys[k]
        );
        if (missing.length > 0) {
          return {
            id,
            gate,
            ok: false,
            shape,
            artifacts,
            contractKeys,
            reason: `## Contract section missing required key(s): ${missing.join(", ")}`,
          };
        }
      }

      // QN-005 phase 2: AC must be machine-checkable — require at least one
      // checkbox line in the AC section, even if all four headings +
      // minimum content are present. Distinct, specific failure reason so
      // the gate stays actionable (matches the existing missing-artifact
      // pattern).
      //
      // gap-both-gates-read-one-signal-so-done-costs-nothing (AC2, ADR-001
      // restored): CHECKED-STATE is deliberately NOT required here. ADR-001's
      // original design says checked-state belongs to `ready->done`, not
      // `todo->ready`: for a not-yet-started task the AC describes "what the
      // work must satisfy", which by definition cannot be checked yet.
      // Requiring all boxes checked at author->ready made `ready` mean
      // "already done" and — worse — made execute->done vacuous (both gates
      // read the same evidence, so passing the first auto-satisfied the
      // second; `done` cost nothing). The two gates now read DIFFERENT
      // evidence: author->ready reads the plan + AC presence/shape (>=1
      // checkbox); execute->done reads the DoD checked-state (plus AC
      // checked-state as the AC5 backstop). This REVERSES QN-019
      // (iteration 8) — see test/gate-checked-state.test.mjs, which was
      // updated to the new semantics.
      const acSection = sectionAfterHeading(t.body, ["AC", "Acceptance Criteria"]);
      const acCheckboxes = acSection.match(/- \[[ xX]\]/g) || [];
      const acChecked = acSection.match(/- \[[xX]\]/g) || [];
      const acHasCheckbox = acCheckboxes.length > 0;
      if (allArtifactsPresent && !acHasCheckbox) {
        return {
          id,
          gate,
          ok: false,
          shape,
          artifacts,
          ...(contractKeys ? { contractKeys } : {}),
          reason: "AC section has no checkboxes",
        };
      }
      const contractKeysOk =
        !contractKeys || Object.values(contractKeys).every(Boolean);
      const ok = allArtifactsPresent && acHasCheckbox && contractKeysOk;
      return {
        id,
        gate,
        ok,
        shape,
        artifacts,
        acTotal: acCheckboxes.length,
        acChecked: acChecked.length,
        ...(contractKeys ? { contractKeys } : {}),
        reason: ok
          ? "all required artifacts present; eligible to move to ready"
          : "missing artifacts: " +
            Object.entries(artifacts)
              .filter(([, v]) => !v)
              .map(([k]) => k)
              .join(", "),
      };
    }
    if (t.status === TASK_STATUS.READY) {
      // execute->done gate (gap-both-gates-read-one-signal-so-done-costs-
      // nothing, AC7b): reads the DoD CHECKED-STATE as the completion
      // evidence. The two gates now read DIFFERENT evidence — author->ready
      // reads the plan + AC presence/shape (checked-state NOT required), and
      // execute->done reads the DoD checkboxes. Previously BOTH gates read
      // the AC checkboxes, so any task legally reaching `ready` (AC all
      // checked) auto-satisfied execute->done and `done` cost nothing.
      //
      // AC checked-state is STILL required here (AC5 backstop: "ready too
      // strict" must not be traded for "done too loose"). So execute->done =
      // AC all checked AND DoD all checked AND (compound) all children done.
      //
      // A DoD section with NO machine-checkable checkboxes is treated as
      // satisfied (vacuously true): the gate is a syntax counter, not a
      // semantic verifier (QN-030 permanent boundary, AC8) — it cannot
      // evaluate prose-only completion claims, so it does not block on them.
      // A DoD WITH checkboxes requires every box checked.
      const acSection = sectionAfterHeading(t.body, ["AC", "Acceptance Criteria"]);
      const acCheckboxes = acSection.match(/- \[[ xX]\]/g) || [];
      const acChecked = acSection.match(/- \[[xX]\]/g) || [];
      const acOk = acCheckboxes.length > 0 && acChecked.length === acCheckboxes.length;

      const dodSection = sectionAfterHeading(t.body, ["DoD", "Definition of Done"]);
      const dodCheckboxes = dodSection.match(/- \[[ xX]\]/g) || [];
      const dodChecked = dodSection.match(/- \[[xX]\]/g) || [];
      const dodOk =
        dodCheckboxes.length === 0 || dodChecked.length === dodCheckboxes.length;

      // QN-012: for a compound (epic) task, the execute->done gate must ALSO
      // require every child to already be `done` — a compound task's own
      // AC/DoD checkboxes do not mechanically encode "and all children
      // finished," so without this, a checkbox-complete epic could flip to
      // `done` while a child was still `todo`/`ready`. Primitive tasks
      // (children.length === 0) are unaffected: childrenStatus is `[]` and
      // `.every(...)` over an empty array is vacuously true.
      const kids = childrenStatus(t);
      const childrenOk = kids.every((c) => c.status === TASK_STATUS.DONE);
      const ok = acOk && dodOk && childrenOk;
      const badChildren = kids.filter((c) => c.status !== TASK_STATUS.DONE);
      let reason;
      if (!acOk) {
        reason = `${acChecked.length}/${acCheckboxes.length} AC checkboxes checked`;
      } else if (!dodOk) {
        reason = `${dodChecked.length}/${dodCheckboxes.length} DoD checkboxes checked`;
      } else if (!childrenOk) {
        reason =
          "AC and DoD checkboxes complete, but not all children are done: " +
          badChildren.map((c) => `${c.id} (${c.status})`).join(", ");
      } else {
        reason = "all AC and DoD checkboxes checked; eligible to move to done";
      }
      const result: Record<string, unknown> = {
        id,
        gate: "execute->done",
        ok,
        acTotal: acCheckboxes.length,
        acChecked: acChecked.length,
        dodTotal: dodCheckboxes.length,
        dodChecked: dodChecked.length,
        reason,
      };
      if (t.role === "compound") result.childrenStatus = kids;
      return result;
    }
    if (t.status === TASK_STATUS.DONE) {
      // QN-012: a `done` compound (epic) task's gate check must actually
      // re-verify that its children are still `done`, rather than
      // unconditionally rubber-stamping `ok: true` — closing the gap named
      // in iteration 5's independent audit (Claim 5): a `done` epic whose
      // child was later reverted would previously still report
      // `ok: true, reason: "terminal"` with zero cross-check. Primitive
      // tasks (children.length === 0) are unaffected: childrenStatus is `[]`
      // and `.every(...)` over an empty array is vacuously true, so this
      // branch degrades to the original unconditional behavior for leaves.
      const kids = childrenStatus(t);
      const childrenOk = kids.every((c) => c.status === TASK_STATUS.DONE);
      if (t.role === "compound" && !childrenOk) {
        const badChildren = kids.filter((c) => c.status !== TASK_STATUS.DONE);
        return {
          id,
          gate: "none",
          ok: false,
          reason:
            "compound task marked done, but not all children are done: " +
            badChildren.map((c) => `${c.id} (${c.status})`).join(", "),
          childrenStatus: kids,
        };
      }
      const result: Record<string, unknown> = { id, gate: "none", ok: true, reason: "terminal" };
      if (t.role === "compound") result.childrenStatus = kids;
      return result;
    }
    if (t.status === TASK_STATUS.NEEDS_HUMAN) {
      return { id, gate: "none", ok: false, reason: "soft stop; human action required" };
    }
    return { id, gate: "unknown", ok: false, reason: `unrecognized status ${t.status}` };
  }

  return {
    list,
    listWithMalformed,
    get,
    write,
    delete: deleteTask,
    appendNote,
    check,
    artifactSections,
    childrenStatus,
    detectShape,
    contractKeysPresent,
  };
}
