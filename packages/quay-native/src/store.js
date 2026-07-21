// @ts-nocheck — TS gradual-adoption ramp list (ADR-012): tsc --noEmit real-checked this file and found pre-existing untyped-JS structural diagnostics; fixing them means real JSDoc typing / a product-code touch, out of the tooling-only phase that introduced this gate. Remove this line once this file is migrated/annotated.
// quay-native core: task store logic (raw file ops).
// One core implementation, consumed identically by the CLI (bin/quay-native.js)
// and the MCP server (src/mcp-server.js) — design §6 CLI/MCP symmetry.
//
// Canonical task view-model (quay-native-design.md §2, quay-proposal.md §7.1):
//   id, title, status, labels, parent, children  (+ body markdown)
// status ∈ {todo, ready, done, needs-human}      (design §3)

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const VALID_STATUSES = ["todo", "ready", "done", "needs-human"];

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
export function resolveDefaultStatus(value) {
  if (!VALID_STATUSES.includes(value)) {
    throw new Error(
      `invalid default_task_status "${value}" — must be one of ${VALID_STATUSES.join(", ")}`
    );
  }
  return value;
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
  constructor(id, expectedStatus, actualStatus) {
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
 * @param {string} tasksDir absolute path to the tasks directory
 * @param {{ defaultStatus?: string }} [opts] optional configuration
 *   opts.defaultStatus — the per-provider `default_task_status` from
 *   .quay/config.yml; applied when creating a NEW task with no explicit status.
 *   Must be a validated value (call resolveDefaultStatus() before passing here).
 *   Omit or pass undefined to preserve the original "todo" fallback (ADR-004:
 *   single-source — this is the ONE place the creation default is resolved).
 */
export function createStore(tasksDir, opts) {
  const storeDefaultStatus = opts?.defaultStatus ?? "todo";
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
    const frontmatter = YAML.parse(m[1]) ?? {};
    const body = m[2] ?? "";
    return { frontmatter, body };
  }

  function serialize(frontmatter, body) {
    const fm = YAML.stringify(frontmatter).trimEnd();
    return `---\n${fm}\n---\n${body}`;
  }

  // QX-018 (experiment 4, iteration 4): get() now includes updatedAt (file mtime
  // in ms) to close UQ-015 (task_get MCP response missing updatedAt field) and
  // enable the detail-page "last updated" display. The stat() call is cheap
  // (one fs.statSync on the already-located file) and consistent with list()'s
  // own mtime inclusion. Gate checks, childrenStatus, and other internal callers
  // already ignore unknown fields so no behavioral regression results.
  /** @returns {object|null} the task view-model, or null if not found */
  function get(id) {
    const raw = readRaw(id);
    if (raw === null) return null;
    const { frontmatter, body } = parse(raw);
    let updatedAt;
    try {
      const taskFile = path.join(tasksDir, `${id}.md`);
      const stat = fs.statSync(taskFile);
      updatedAt = stat.mtimeMs;
    } catch {
      // stat failed (race or missing file) — omit updatedAt
    }
    return toViewModel(frontmatter, body, updatedAt);
  }

  function toViewModel(frontmatter, body, updatedAt) {
    const children = frontmatter.children ?? [];
    const vm = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      labels: frontmatter.labels ?? [],
      parent: frontmatter.parent ?? null,
      children,
      // role is derived, never stored (design §2): children non-empty => compound
      role: children.length > 0 ? "compound" : "primitive",
      extra: frontmatter.extra ?? {},
      body,
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
        const subtreeOk = grandkids.every((g) => g.status === "done");
        const status = child.status === "done" && !subtreeOk ? "stale-done" : child.status;
        return { id: childId, status, childrenStatus: grandkids };
      }
      return { id: childId, status: child.status };
    });
  }

  function list(filter = {}) {
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
    return listIds()
      .map((id) => {
        const t = get(id);
        if (t === null) return null;
        return t;
      })
      .filter((t) => t !== null)
      .filter((t) => (filter.status ? t.status === filter.status : true))
      .filter((t) =>
        filter.label ? (t.labels || []).includes(filter.label) : true
      );
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
  function write(id, { title, status, labels, parent, children, extra, body, expectedStatus }) {
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
    return withLocks(lockIds, () => {
      const existingRaw = readRaw(id);
      let frontmatter = { id, title, status, labels: labels ?? [], parent: parent ?? null, children: children ?? [] };
      let existingBody = "";
      if (existingRaw !== null) {
        const parsed = parse(existingRaw);
        frontmatter = { ...parsed.frontmatter };
        existingBody = parsed.body;
        // QN-015: the CAS check MUST happen here, inside the same lock
        // acquisition already used for the read-modify-write below — checking
        // status before acquiring the lock (or in a separate call) would
        // reopen exactly the TOCTOU race this option exists to close.
        if (expectedStatus !== undefined && frontmatter.status !== expectedStatus) {
          throw new ConflictError(id, expectedStatus, frontmatter.status);
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
      } else {
        // No existing file: there is no "current status" to compare against,
        // so any expectedStatus is by definition a mismatch (there is
        // nothing to CAS against) — fail closed, not open.
        if (expectedStatus !== undefined) {
          throw new ConflictError(id, expectedStatus, null);
        }
        frontmatter.extra = extra ?? {};
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
      fs.writeFileSync(filePathFor(id), raw, "utf8");

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
  }

  function appendNote(id, note) {
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
      fs.writeFileSync(filePathFor(id), finalRaw, "utf8");
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

  function artifactSections(body) {
    const has = (heading) => {
      if (!new RegExp(`^##\\s+${heading}\\b`, "im").test(body)) return false;
      const content = extractSection(body, [heading]);
      const nonWhitespaceLen = content.replace(/\s/g, "").length;
      return nonWhitespaceLen >= MIN_SECTION_CHARS;
    };
    return {
      proposal: has("Proposal"),
      plan: has("Plan"),
      ac: has("AC") || has("Acceptance Criteria"),
      dod: has("DoD") || has("Definition of Done"),
    };
  }

  /**
   * `task check <id>` — asserts the author->ready and execute->done gates
   * (design §3). Returns a structured result; does not mutate status itself
   * (mutation is a separate `edit --status` call by the Skill/human).
   */
  function check(id) {
    const t = get(id);
    if (!t) return { id, ok: false, reason: "not found" };
    const artifacts = artifactSections(t.body);
    const allArtifactsPresent = Object.values(artifacts).every(Boolean);

    if (t.status === "todo") {
      const gate = "author->ready";
      // QN-005 phase 2: AC must be machine-checkable — require at least one
      // checkbox line in the AC section, even if all four headings +
      // minimum content are present. Distinct, specific failure reason so
      // the gate stays actionable (matches the existing missing-artifact
      // pattern).
      //
      // QN-019 (iteration 8): tightened from presence-only to checked-state,
      // matching the execute->done gate's own semantics below. Iteration
      // 7's QN-017 found live that a task could reach `ready` with AC
      // checkboxes present but zero of them checked — an asymmetry with
      // execute->done, which already required full-checked state. This
      // reuses the same checkboxes/checked regex-count logic, applied one
      // gate earlier.
      const acSection = extractSection(t.body, ["AC", "Acceptance Criteria"]);
      const acCheckboxes = acSection.match(/- \[[ xX]\]/g) || [];
      const acChecked = acSection.match(/- \[[xX]\]/g) || [];
      const acHasCheckbox = acCheckboxes.length > 0;
      if (allArtifactsPresent && !acHasCheckbox) {
        return {
          id,
          gate,
          ok: false,
          artifacts,
          reason: "AC section has no checkboxes",
        };
      }
      const acAllChecked =
        acHasCheckbox && acChecked.length === acCheckboxes.length;
      if (allArtifactsPresent && acHasCheckbox && !acAllChecked) {
        return {
          id,
          gate,
          ok: false,
          artifacts,
          acTotal: acCheckboxes.length,
          acChecked: acChecked.length,
          reason: `${acChecked.length}/${acCheckboxes.length} AC checkboxes checked`,
        };
      }
      const ok = allArtifactsPresent && acAllChecked;
      return {
        id,
        gate,
        ok,
        artifacts,
        reason: ok
          ? "all four artifacts present; eligible to move to ready"
          : "missing artifacts: " +
            Object.entries(artifacts)
              .filter(([, v]) => !v)
              .map(([k]) => k)
              .join(", "),
      };
    }
    if (t.status === "ready") {
      // execute->done gate: v0 checks AC checkboxes are all ticked, as a thin
      // machine-checkable proxy for "AC satisfied" (design §3). This is a
      // deliberately thin v0 gate — see iteration-0 gap analysis.
      const acSection = extractSection(t.body, ["AC", "Acceptance Criteria"]);
      const checkboxes = acSection.match(/- \[[ xX]\]/g) || [];
      const checked = acSection.match(/- \[[xX]\]/g) || [];
      const acOk = checkboxes.length > 0 && checked.length === checkboxes.length;

      // QN-012: for a compound (epic) task, the execute->done gate must ALSO
      // require every child to already be `done` — a compound task's own
      // AC/DoD checkboxes do not mechanically encode "and all children
      // finished," so without this, a checkbox-complete epic could flip to
      // `done` while a child was still `todo`/`ready`. Primitive tasks
      // (children.length === 0) are unaffected: childrenStatus is `[]` and
      // `.every(...)` over an empty array is vacuously true.
      const kids = childrenStatus(t);
      const childrenOk = kids.every((c) => c.status === "done");
      const ok = acOk && childrenOk;
      const badChildren = kids.filter((c) => c.status !== "done");
      let reason;
      if (!acOk) {
        reason = `${checked.length}/${checkboxes.length} AC checkboxes checked`;
      } else if (!childrenOk) {
        reason =
          "AC checkboxes complete, but not all children are done: " +
          badChildren.map((c) => `${c.id} (${c.status})`).join(", ");
      } else {
        reason = "all AC checkboxes checked; eligible to move to done";
      }
      const result = {
        id,
        gate: "execute->done",
        ok,
        acTotal: checkboxes.length,
        acChecked: checked.length,
        reason,
      };
      if (t.role === "compound") result.childrenStatus = kids;
      return result;
    }
    if (t.status === "done") {
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
      const childrenOk = kids.every((c) => c.status === "done");
      if (t.role === "compound" && !childrenOk) {
        const badChildren = kids.filter((c) => c.status !== "done");
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
      const result = { id, gate: "none", ok: true, reason: "terminal" };
      if (t.role === "compound") result.childrenStatus = kids;
      return result;
    }
    if (t.status === "needs-human") {
      return { id, gate: "none", ok: false, reason: "soft stop; human action required" };
    }
    return { id, gate: "unknown", ok: false, reason: `unrecognized status ${t.status}` };
  }

  function extractSection(body, headings) {
    for (const h of headings) {
      // QN-005 fix (iteration 2): `\Z` is NOT a valid JavaScript regex
      // end-of-string anchor (JS has no \Z metacharacter) — the engine took
      // it as a literal capital "Z", and with the `i` (case-insensitive)
      // flag this also matched a bare lowercase "z" anywhere in the
      // section's prose, truncating capture early (found and root-caused
      // by the iteration-1 G3 audit against QN-005's own AC text, which
      // contains the word "zero"). Correct JS end-of-string lookahead is
      // `(?![\s\S])` (no characters remain).
      const re = new RegExp(`^##\\s+${h}\\b([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im");
      const m = re.exec(body);
      if (m) return m[1];
    }
    return "";
  }

  return { list, get, write, appendNote, check, artifactSections, childrenStatus };
}
