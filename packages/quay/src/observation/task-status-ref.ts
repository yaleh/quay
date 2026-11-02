// observation/task-status-ref.ts — the GIT-REF TASK-STATE seam (split out of observation.ts, task
// gap-routine-architecture-analysis-fan-hub-quay-src).
//
// Responsibility: read a task's status / title / last-commit-time AT A GIT REF (the develop-first
// canonical store), short-TTL cached, so the board / task-detail pages never re-run `git show`
// per task. Includes the `git cat-file --batch` + `git ls-tree` batched readers, the incremental
// commit-time diff, the background refresh tick, and `readTaskStatusForLive` (the develop-first
// status read used by readLive's ghost-drop). The FALLBACK on-disk read (`readTaskStatusOnDisk`)
// also lives here.
//
// ⛔ It only READS (never writes) and never touches fan-in: `git show` / `cat-file` / `ls-tree`
// read the object store only. Every git failure degrades to empty/null — never a fabricated
// positive (硬规则 3b: an unavailable source must not look like a read-and-OK). This is the ONLY
// serve-path module allowed to know git refs.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseFrontmatter } from "../core/frontmatter-store-base.ts";
import { isTaskStatus, type TaskStatus } from "../core/types.ts";
import { ancestry } from "../core/ancestry.ts";

/** Read a single task's status frontmatter from the on-disk store. Missing/unreadable ⇒ null (never
 *  throws). This is the FALLBACK read: tasks/gap-web-task-status-reads-stale-main-checkout makes the
 *  canonical store the develop git ref (the manager working branch's disk is a STALE agent-proxy,
 *  硬规则 4b); `readTaskStatusForLive` reads develop first and falls back here when the ref/path is
 *  unavailable (not a git repo, no develop ref, a fresh task not yet committed to develop). */
function readTaskStatusOnDisk(root: string, taskId: string): TaskStatus | null {
  try {
    const raw = fs.readFileSync(path.join(root, "tasks", `${taskId}.md`), "utf8");
    const parsed = parseFrontmatter(raw);
    const fm = parsed.frontmatter as Record<string, unknown>;
    return isTaskStatus(fm.status) ? fm.status : null;
  } catch {
    return null;
  }
}

/** Read `<ref>:tasks/<taskId>.md` frontmatter `status:` + `title:`. Cache-first (AC3): when the batch
 *  readers (list page / background refresh) already hold this task's status AND title, return them from
 *  cache with ZERO git subprocesses; otherwise fall back to ONE `git show` (the single-task develop-ref
 *  read — object store only, never checks out `ref`, never touches fan-in). null when the ref/path is
 *  unavailable or the frontmatter is unreadable — callers fall back to the on-disk read. The /task
 *  detail page reads BOTH halves from this one call (status + title develop-first, so list and detail
 *  agree), and `readTaskStatusAtRef` is its status-only projection. */
export function readTaskAtRefMeta(root: string, ref: string, taskId: string): { status: TaskStatus | null; title: string | null } | null {
  const key = `${root}\n${ref}`;
  const statusEntry = taskStatusRefCache.get(key);
  const titleEntry = taskTitleRefCache.get(key);
  if (statusEntry != null && titleEntry != null && statusEntry.map.has(taskId) && titleEntry.map.has(taskId)) {
    return {
      status: statusEntry.map.get(taskId) ?? null,
      title: titleEntry.map.get(taskId) ?? null,
    };
  }
  singleTaskGitSpawnCount++;
  let out: string;
  try {
    out = execFileSync("git", ["-C", root, "show", `${ref}:tasks/${taskId}.md`], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
  try {
    const parsed = parseFrontmatter(out);
    const fm = parsed.frontmatter as Record<string, unknown>;
    return {
      status: isTaskStatus(fm.status) ? fm.status : null,
      title: typeof fm.title === "string" ? fm.title : null,
    };
  } catch {
    return null;
  }
}

/** Read `<ref>:tasks/<taskId>.md` status frontmatter (the single-task half of the develop-ref read;
 *  `git show` reads the object store only — never checks out `ref`, never touches fan-in). null when
 *  the ref/path is unavailable or the frontmatter is unreadable — callers fall back to the on-disk
 *  read. Mirrors plugin/scripts/worker-driver.ts's `readTaskStatusAtRef` (the same `git show
 *  develop:tasks/<id>.md` judgment, re-implemented here because observation.ts is the ONLY serve-path
 *  module allowed to know git). */
export function readTaskStatusAtRef(root: string, ref: string, taskId: string): TaskStatus | null {
  return readTaskAtRefMeta(root, ref, taskId)?.status ?? null;
}

/** Read the raw contents of a set of task files at a git ref in ONE `git cat-file --batch` process,
 *  fed the blob SHAs from `listTaskFilesAtRef` — a direct object read, ~6× faster than re-resolving a
 *  `ref:path` refspec per file (硬规则 4b: the refspec form walks the tree once per file). Returns
 *  Map<taskId, rawContent> for the files PRESENT at the ref. Empty map on any git failure (never a
 *  positive from an unavailable source). Mirrors plugin/scripts/ready-pool-check.ts's dispatch-read batch. */
function readTaskFilesAtRefBatch(root: string, ref: string, files: Array<{ id: string; sha: string }>): Map<string, string> {
  if (files.length === 0) return new Map();
  const input = files.map((f) => f.sha).join("\n") + "\n";
  let buf: Buffer;
  try {
    buf = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
      input,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30_000,
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return new Map();
  }
  const map = new Map<string, string>();
  let off = 0;
  for (const f of files) {
    const nl = buf.indexOf(0x0a, off);
    if (nl === -1) break;
    const header = buf.slice(off, nl).toString("utf8");
    off = nl + 1;
    const m = / blob (\d+)$/.exec(header);
    if (!m) continue; // `<sha> missing` (or unparseable) — no content line; off is already past the header
    const size = Number(m[1]);
    map.set(f.id, buf.slice(off, off + size).toString("utf8"));
    off += size + 1; // skip content + the trailing newline after it
  }
  return map;
}

/** TTL for the batched develop-status cache — a rendered /tasks list need not re-run `git cat-file`
 *  over the whole tree on every refresh within the same render burst (AC4: 1500+ tasks). */
export const TASK_STATUS_REF_CACHE_TTL_MS = 2000;

const taskStatusRefCache = new Map<string, { at: number; map: Map<string, TaskStatus> }>();
const taskTitleRefCache = new Map<string, { at: number; map: Map<string, string> }>();
// The commit-time cache carries the ref's HEAD sha at build time so a later refresh can diff
// `oldHead..newHead` incrementally instead of re-walking the whole `tasks/` history (gap-tasks-page-
// develop-ref-full-history-git-log-cost AC2).
const taskCommitTimesRefCache = new Map<string, { at: number; head: string | null; map: Map<string, number> }>();

/** Test seam (AC3): the number of single-task git subprocesses (`git show` / `git log -1`) spawned by
 *  the detail-page read face (`readTaskAtRefMeta` / `readTaskCommitTimeAtRef`). A cache hit must spawn
 *  ZERO — the counter lets the test assert that instead of a timing proxy. */
let singleTaskGitSpawnCount = 0;
export function resetSingleTaskGitSpawnCount(): void { singleTaskGitSpawnCount = 0; }
export function getSingleTaskGitSpawnCount(): number { return singleTaskGitSpawnCount; }

/** Test seam (AC1/AC4 of gap-suite-wallclock-budgets-literals-depend-on-host-capacity): how many
 *  `git log` walks the commit-time reader spawned, split by COST CLASS —
 *  `full` = the unbounded `git log <ref> -- tasks/` walk over the ref's whole history;
 *  `bounded` = the incremental `oldHead..newHead` diff (O(new commits)).
 *  A COUNT, not a wall-clock proxy: the /tasks request path reads CACHE-ONLY (`serve-task.ts`
 *  `readTaskCommitTimesAtRef(..., {cacheOnly:true})`) so a request must spawn ZERO full walks no
 *  matter how slow the host is; the full walk belongs to the background refresh, off the request
 *  path. A loaded host makes a walk SLOWER, not more frequent — which is exactly why the property
 *  has to be measured as a count (硬规则 4b: 优先观测直接量，不要用代理量). */
let developRefFullWalkCount = 0;
let developRefBoundedWalkCount = 0;
export function resetDevelopRefWalkCounts(): void {
  developRefFullWalkCount = 0;
  developRefBoundedWalkCount = 0;
}
export function getDevelopRefFullWalkCount(): number { return developRefFullWalkCount; }
export function getDevelopRefBoundedWalkCount(): number { return developRefBoundedWalkCount; }

/** Clear the batched develop-ref caches (test seam — a fixture that rewrites the develop ref
 *  mid-test must not read a cached prior read). Clears status + title + commit-time together: the
 *  three develop-ref read faces share one source of truth and one TTL clock. */
/** Test seam (gap-ac292 AC3): how many times the develop-ref status-map read actually BUILT — i.e.
 *  a cache miss that goes on to `git ls-tree` + `cat-file --batch` over EVERY task file at the ref.
 *  A COUNT, not a wall-clock proxy: `/board`'s request path reads the snapshot, so a request must
 *  trigger ZERO builds no matter how large the store is; the build belongs to the background tick.
 *  (硬规则 4b: a loaded host makes the scan SLOWER, not more frequent — so frequency is the only
 *  reading that isolates the property under test.) */
let taskStatusRefBuildCount = 0;
export function getTaskStatusRefBuildCount(): number { return taskStatusRefBuildCount; }
export function resetTaskStatusRefBuildCount(): void { taskStatusRefBuildCount = 0; }

export function clearTaskStatusRefCache(): void {
  taskStatusRefCache.clear();
  taskTitleRefCache.clear();
  taskCommitTimesRefCache.clear();
}

/** List the task files (`.md` under `tasks/`) at a git ref in ONE `git ls-tree -r` pass, carrying each
 *  file's blob SHA (NOT `--name-only`): the batched content read feeds `cat-file --batch` the blob SHA
 *  — a direct object read, ~6× faster than re-resolving a `ref:path` refspec per file (硬规则 4b: the
 *  refspec form walks the tree once per file). Returns [{ id, sha }]. Empty array on any git failure. */
function listTaskFilesAtRef(root: string, ref: string): Array<{ id: string; sha: string }> {
  try {
    const out = execFileSync("git", ["-C", root, "ls-tree", "-r", ref, "--", "tasks/"], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    });
    const files: Array<{ id: string; sha: string }> = [];
    for (const line of out.split(/\r?\n/)) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue; // no path column (malformed line)
      const meta = line.slice(0, tab).split(/\s+/); // `<mode> <type> <sha>`
      const rel = line.slice(tab + 1);
      if (meta.length < 3 || meta[1] !== "blob" || !rel.endsWith(".md")) continue;
      const base = rel.split("/").pop() ?? "";
      const id = base.slice(0, -3);
      if (id.length > 0) files.push({ id, sha: meta[2] });
    }
    return files;
  } catch {
    return [];
  }
}

/** Read every task's `status:` frontmatter at a git ref in ONE `git ls-tree` + ONE `git cat-file
 *  --batch` pair (two subprocesses total for a ~1500-task tree), short-TTL cached. Returns a
 *  Map<taskId, TaskStatus> of the ids PRESENT at the ref; absent ids are missing (callers fall back
 *  to the working-tree read). Empty map on any git failure — never a positive from an unavailable
 *  source (硬规则 ③b). */
export function readTaskStatusMapAtRef(
  root: string,
  ref: string,
  { nowMs = Date.now(), ttlMs = TASK_STATUS_REF_CACHE_TTL_MS, force = false } = {},
): Map<string, TaskStatus> {
  const key = `${root}\n${ref}`;
  const hit = taskStatusRefCache.get(key);
  if (!force && hit != null && nowMs - hit.at < ttlMs) return hit.map;
  taskStatusRefBuildCount++;
  const map = new Map<string, TaskStatus>();
  try {
    const rawMap = readTaskFilesAtRefBatch(root, ref, listTaskFilesAtRef(root, ref));
    for (const [id, raw] of rawMap) {
      try {
        const parsed = parseFrontmatter(raw);
        const fm = parsed.frontmatter as Record<string, unknown>;
        if (isTaskStatus(fm.status)) map.set(id, fm.status);
      } catch {
        // unparseable frontmatter at the ref — leave absent (caller falls back to disk), never fabricate
      }
    }
  } catch {
    // git unavailable / not a repo / no such ref — empty map, callers fall back to the disk read
  }
  taskStatusRefCache.set(key, { at: nowMs, map });
  return map;
}

/** Read every task's `title:` frontmatter at a git ref in ONE `git ls-tree` + ONE `git cat-file
 *  --batch` pair, short-TTL cached. The title half of the develop-ref read — the /tasks divergence
 *  marker compares the disk title against the develop title, so the list needs BOTH maps without a
 *  per-task `git show`. Absent ids are missing (callers fall back to the disk title). Empty map on
 *  any git failure — never a positive from an unavailable source (硬规则 ③b). */
export function readTaskTitleMapAtRef(
  root: string,
  ref: string,
  { nowMs = Date.now(), ttlMs = TASK_STATUS_REF_CACHE_TTL_MS, force = false } = {},
): Map<string, string> {
  const key = `${root}\n${ref}`;
  const hit = taskTitleRefCache.get(key);
  if (!force && hit != null && nowMs - hit.at < ttlMs) return hit.map;
  const map = new Map<string, string>();
  try {
    const rawMap = readTaskFilesAtRefBatch(root, ref, listTaskFilesAtRef(root, ref));
    for (const [id, raw] of rawMap) {
      try {
        const parsed = parseFrontmatter(raw);
        const fm = parsed.frontmatter as Record<string, unknown>;
        if (typeof fm.title === "string") map.set(id, fm.title);
      } catch {
        // unparseable frontmatter at the ref — leave absent (caller falls back to disk)
      }
    }
  } catch {
    // git unavailable / not a repo / no such ref — empty map, callers fall back to the disk read
  }
  taskTitleRefCache.set(key, { at: nowMs, map });
  return map;
}

/** Resolve `<ref>^{commit}` to the commit sha (the ref's current HEAD). null when the ref/object is
 *  unavailable (git down, not a repo, no such ref). */
function resolveRefHead(root: string, ref: string): string | null {
  try {
    const out = execFileSync("git", ["-C", root, "rev-parse", `${ref}^{commit}`], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** This module's liveness budget for the ancestry probe — it runs on the /live read path, where a
 *  hung git must not hang the page. */
const ANCESTRY_PROBE_TIMEOUT_MS = 10_000;

/** Whether `ancestor` is a commit-graph ancestor of `descendant`. The PREDICATE is `./core/ancestry.ts`
 *  (semantic-dedup-scan finding `is-ancestor-three-semantics`); this wrapper is only the timeout
 *  policy. The incremental commit-time diff is valid only when the prior head is an ancestor of the
 *  current head (the normal fast-forward fan-in shape); a non-ff rewrite falls back to a full rebuild
 *  instead of silently returning a partial map.
 *
 *  Fold: `null` ("git could not be asked" — timeout, not a repo, unknown object) ⇒ `false`, i.e.
 *  "assume not an ancestor". The conservative direction HERE is the FULL REBUILD: a false negative
 *  costs one extra history walk, while a false positive would serve a partial map forever. */
function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  return ancestry(root, ancestor, descendant, { timeoutMs: ANCESTRY_PROBE_TIMEOUT_MS }) === true;
}

/** Parse `git log --format=%cI --name-only` output (newest-first) into Map<taskId, epochMs> — the
 *  FIRST occurrence of a file is its last commit. Pure; never throws. */
function parseCommitTimesLog(out: string): Map<string, number> {
  const map = new Map<string, number>();
  let cur: number | null = null;
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t)) {
      cur = Date.parse(t);
    } else if (cur != null && t.startsWith("tasks/") && t.endsWith(".md")) {
      const id = t.slice("tasks/".length, -3);
      if (!map.has(id)) map.set(id, cur); // first occurrence = last commit (log is newest-first)
    }
  }
  return map;
}

/** Read every task's last-commit time at a git ref, incrementally maintained (AC2): the FIRST build
 *  walks the whole `tasks/` history in ONE `git log --format=%cI --name-only` pass (single subprocess);
 *  a later refresh diffs only `oldHead..newHead` and merges the new commits onto the prior map — never
 *  re-walking the full history. The updated-at source: a develop-derived status ⇒ updated = that file's
 *  last commit time on develop, so a disk mtime bump after a develop flip no longer moves the display.
 *  Returns Map<taskId, epochMs>; absent ids are missing (callers fall back to disk mtime). Empty map on
 *  any git failure. */
export function readTaskCommitTimesAtRef(
  root: string,
  ref: string,
  { nowMs = Date.now(), ttlMs = TASK_STATUS_REF_CACHE_TTL_MS, force = false, cacheOnly = false } = {},
): Map<string, number> {
  const key = `${root}\n${ref}`;
  const hit = taskCommitTimesRefCache.get(key);
  if (cacheOnly) {
    // Request-path read: the cache only, never spawn git — the background refresh owns the build (the
    // full history walk lives at startup, off the request path). Empty when cold: the caller falls back
    // to the disk mtime (fail-open). A present-but-TTL-expired map is still returned — the background
    // refresh, not a request, is what keeps it fresh.
    return hit != null ? hit.map : new Map();
  }
  if (!force && hit != null && nowMs - hit.at < ttlMs) return hit.map;

  const head = resolveRefHead(root, ref);
  const fullBuild = (): Map<string, number> => {
    developRefFullWalkCount++;
    try {
      const out = execFileSync("git", ["-C", root, "log", "--format=%cI", "--name-only", ref, "--", "tasks/"], {
        encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
      });
      return parseCommitTimesLog(out);
    } catch {
      return new Map(); // git unavailable / not a repo / no such ref
    }
  };

  let map: Map<string, number>;
  if (head == null) {
    map = new Map(); // git unavailable / no such ref — fail-open empty (callers fall back to disk mtime)
  } else if (hit != null && hit.head === head) {
    map = hit.map; // head unchanged since the last build — the map is still current; refresh the TTL clock only
  } else if (hit != null && hit.head != null && isAncestor(root, hit.head, head)) {
    // Incremental: merge the commits in (oldHead, head] onto the prior map. A task touched in the
    // range gets its newer time; one untouched keeps its prior time. The `isAncestor` guard keeps a
    // non-fast-forward rewrite from producing a silently-wrong partial map.
    map = new Map(hit.map);
    developRefBoundedWalkCount++;
    try {
      const out = execFileSync("git", ["-C", root, "log", "--format=%cI", "--name-only", `${hit.head}..${head}`, "--", "tasks/"], {
        encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
      });
      for (const [id, t] of parseCommitTimesLog(out)) map.set(id, t);
    } catch {
      map = fullBuild(); // incremental failed (e.g. non-ff rewrite) — never return a partial map
    }
  } else {
    map = fullBuild(); // cold (no prior head) or non-ff — full rebuild
  }
  taskCommitTimesRefCache.set(key, { at: nowMs, head, map });
  return map;
}

/** Read a single task's last-commit time at a ref. Cache-first (AC3): when the batch commit-time
 *  reader already holds this task, return it from cache with ZERO git subprocesses; otherwise fall back
 *  to `git log -1 --format=%cI ref -- tasks/<id>.md`. The /task detail page's `last updated` source —
 *  the same develop-derived time as the list's updated column (list and detail must agree, not
 *  list=done/detail=ready). null when the file has no commit at the ref (caller falls back to disk
 *  mtime). */
export function readTaskCommitTimeAtRef(root: string, ref: string, taskId: string): number | null {
  const entry = taskCommitTimesRefCache.get(`${root}\n${ref}`);
  if (entry != null && entry.map.has(taskId)) {
    return entry.map.get(taskId) ?? null;
  }
  singleTaskGitSpawnCount++;
  try {
    const out = execFileSync("git", ["-C", root, "log", "-1", "--format=%cI", ref, "--", `tasks/${taskId}.md`], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!out) return null;
    const ms = Date.parse(out);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Force-refresh the three develop-ref read caches for one (root, ref) — status + title + commit-time
 *  together (one ls-tree / one cat-file / one incremental-or-full git log). The three caches share one
 *  TTL clock and one truth; refreshing them together keeps the detail-page cache-first reads
 *  (readTaskAtRefMeta / readTaskCommitTimeAtRef) coherent with the list-page reads. Never throws (AC4):
 *  a git failure is caught inside each reader and again here — the prior cache is kept, the next
 *  refresh re-fills it. */
export function refreshDevelopRefCaches(root: string, ref: string): void {
  try {
    // Build the slowest face FIRST (the commit-time history walk), so the fast status/title caches end
    // up freshest when this returns. Each reader stamps its own `Date.now()` at build time (not a shared
    // clock) — a request right after the refresh hits status/title within their TTL.
    readTaskCommitTimesAtRef(root, ref, { force: true });
    readTaskTitleMapAtRef(root, ref, { force: true });
    readTaskStatusMapAtRef(root, ref, { force: true });
  } catch {
    // never throw out of the refresh tick — each reader already degrades; this is belt-and-suspenders
  }
}

/** Start the background refresh tick that keeps the develop-ref read caches warm OFF the request path
 *  (plan §2). Runs one full build immediately (the cold full-history walk lives here, at startup, not in
 *  a request), then re-refreshes every `intervalMs`. Returns a stop() function; the interval is unref'd
 *  so it never keeps the process alive. */
export function startDevelopRefBackgroundRefresh(
  root: string,
  ref: string,
  { intervalMs = 15_000 } = {},
): { stop: () => void } {
  const run = (): void => refreshDevelopRefCaches(root, ref);
  run(); // the cold full build (status + title + commit-time) — at startup, off the request path
  const handle = setInterval(run, intervalMs);
  (handle as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(handle) };
}

/** readLive's task-status read: the canonical develop ref first, the on-disk store as fallback. A
 *  task landed on develop (status done) but not yet synced to the manager working branch's disk still
 *  reads as done here — the landed task leaves the in-flight view immediately (AC1). A fresh task that
 *  exists only on disk (not yet committed to develop) falls back to the disk read (AC2). */
export function readTaskStatusForLive(root: string, taskId: string): TaskStatus | null {
  const atRef = readTaskStatusAtRef(root, "develop", taskId);
  return atRef ?? readTaskStatusOnDisk(root, taskId);
}
