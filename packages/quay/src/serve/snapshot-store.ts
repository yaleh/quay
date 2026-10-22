// snapshot-store.ts — the ONE owner of the mutable state that used to sit at module level in
// serve-dashboard.ts and serve-board.ts (gap-dashboard-snapshot-store-encapsulate-state).
//
// WHY THIS MODULE EXISTS. Both render modules kept their state the same way: a scatter of
// module-level `const x = new Map()` caches, two module-level `let` step hooks, and five + two
// free `clearXxx()` / `setXxxStepHook()` functions that reached into them from outside. Nothing
// tied a cache's TTL to its invalidation, nothing tied a rebuild's in-flight marker to its
// `.delete()`, and the only way to reset the whole cluster was to call N functions in the right
// order. That is the shape the user's 2026-10-22 ruling names: 「真正的封装 = 把散落的属性（状态）
// + 方法（行为）收进类，让它们有一致的生命周期」.
//
// The precedent is `plugin/scripts/worker-pool.ts`'s `class WorkerPool` (retry/backoff state as
// `#retryState` / `#backoffState`). This is the same move for the dashboard/board state cluster:
// nine maps + two hooks become private fields of ONE class, and the lifecycle (TTL read-through,
// rebuild de-duplication, follow-up coalescing, clear) becomes that class's methods.
//
// DESIGN NOTES
//   · The class is generic over the snapshot VALUE type (`S`), because the dashboard and the board
//     snapshot different things. Each module holds its OWN instance — they never share a map, so
//     one page's `clear()` cannot blank the other's cards.
//   · The instances are explicit module singletons (`dashboardSnapshotStore` /
//     `boardSnapshotStore`, exported from their own modules). Tests that need isolation construct
//     their own instance — injection is by constructor/parameter, never by re-binding a `let`.
//   · This module deliberately has NO runtime imports: its only imports are `import type`, so it
//     cannot participate in a value-level import cycle with the two render modules that consume it.
//     (`import-graph-check.ts` ratchets type-level cycles too, so the direction stays one-way:
//     serve-dashboard.ts / serve-board.ts → snapshot-store.ts.)

import type { LiveResult, SystemResult, ManagerResult } from "../observation.ts";

/** A frontmatter-only task summary (the `includeBody:false` shape `readTaskSummary` returns). The
 *  `goal_ac` field (task→AC linkage, G7) joined the shape via gap-webui-goal-task-rollup-via-shared-
 *  summary-cache so the /goal rollup can consume the structured relationship WITHOUT a second read
 *  — it rides the SAME cached array the dashboard taskCard already uses.
 *
 *  Defined HERE (not in serve-dashboard.ts) because the task-summary TTL cache below is this
 *  module's own field: the cached value's shape belongs with the cache. serve-dashboard.ts
 *  re-exports it so every existing importer keeps resolving it unchanged. */
export interface TaskSummary {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  labels?: unknown;
  updatedAt?: unknown;
  goal_ac?: unknown;
}

/** What to do when a rebuild is requested while one is already in flight for the same root.
 *
 *  - `skip`  — the PERIODIC TICK's policy: return the incumbent and start nothing. A slow store must
 *              not queue up work that all lands at once.
 *  - `after` — an explicit `rebuildNow()` caller's policy: such a caller made its change BEFORE the
 *              call, while the incumbent build issued its provider round-trips before that — so the
 *              incumbent is structurally incapable of reflecting the change
 *              (gap-dashboard-snapshot-rebuild-returns-inflight-cold-build). Every such caller is
 *              COALESCED onto ONE follow-up build started when the incumbent settles. */
export type RebuildPolicy = "skip" | "after";

/** A per-root TTL cache entry. `at` is the wall-clock instant the value was stored. */
interface TtlEntry<T> {
  at: number;
  value: T;
}

/** The dashboard/board state cluster: four TTL caches, one snapshot map, one in-flight-rebuild map,
 *  one follow-up map, and one test step hook — each a private field, each with its own lifecycle
 *  method. One instance per page module (see the design notes above). */
export class DashboardSnapshotStore<S> {
  #taskSummaryCache = new Map<string, TtlEntry<TaskSummary[]>>();
  #liveCache = new Map<string, TtlEntry<LiveResult>>();
  #sysCache = new Map<string, TtlEntry<SystemResult>>();
  #mgrLightCache = new Map<string, TtlEntry<ManagerResult>>();
  // ── snapshot lifecycle ──
  #snapshots = new Map<string, S>();
  #rebuilds = new Map<string, Promise<void>>();
  /** Per root, the ONE follow-up rebuild coalescing every `rebuild(…, "after")` caller that
   *  arrived while a build was already in flight. Distinct from `#rebuilds`, which tracks the build
   *  that is actually running. */
  #followUps = new Map<string, Promise<void>>();
  #stepHook: (() => Promise<void>) | null = null;

  // ── TTL caches ────────────────────────────────────────────────────────────────────────────────
  // Read → null on a miss or an expired entry (never a throw, never a fabricated empty value: the
  // CALLER decides what a miss means, and a load failure is not cached — the next call retries).

  /** Cached task-summary reading for `root`, or null when absent/expired. */
  taskSummary(root: string, ttlMs: number): TaskSummary[] | null {
    return this.#read(this.#taskSummaryCache, root, ttlMs);
  }
  /** Store a task-summary reading for `root`. */
  cacheTaskSummary(root: string, tasks: TaskSummary[]): void {
    this.#taskSummaryCache.set(root, { at: Date.now(), value: tasks });
  }

  /** Cached live reading for `root`, or null when absent/expired. */
  live(root: string, ttlMs: number): LiveResult | null {
    return this.#read(this.#liveCache, root, ttlMs);
  }
  /** Store a live reading for `root`. */
  cacheLive(root: string, live: LiveResult): void {
    this.#liveCache.set(root, { at: Date.now(), value: live });
  }

  /** Cached system-resource reading for `root`, or null when absent/expired. */
  system(root: string, ttlMs: number): SystemResult | null {
    return this.#read(this.#sysCache, root, ttlMs);
  }
  /** Store a system-resource reading for `root`. */
  cacheSystem(root: string, value: SystemResult): void {
    this.#sysCache.set(root, { at: Date.now(), value });
  }

  /** Cached manager-light reading for `root`, or null when absent/expired. */
  managerLight(root: string, ttlMs: number): ManagerResult | null {
    return this.#read(this.#mgrLightCache, root, ttlMs);
  }
  /** Store a manager-light reading for `root`. */
  cacheManagerLight(root: string, value: ManagerResult): void {
    this.#mgrLightCache.set(root, { at: Date.now(), value });
  }

  /** Drop ONLY the cached task-summary readings. */
  clearTaskSummary(): void {
    this.#taskSummaryCache.clear();
  }

  /** Drop ONLY the cached live readings. */
  clearLive(): void {
    this.#liveCache.clear();
  }

  /** Drop ONLY the cached system + manager-light probe readings (the two shell-out probes). */
  clearProbes(): void {
    this.#sysCache.clear();
    this.#mgrLightCache.clear();
  }

  // ── snapshot lifecycle ───────────────────────────────────────────────────────────────────────

  /** The snapshot for `root`, or null when none has been built yet. **Sync and non-building** —
   *  the request path's whole lookup, so a request can never be made to wait for a rebuild. */
  snapshot(root: string): S | null {
    return this.#snapshots.get(root) ?? null;
  }

  /** Install a COMPLETE snapshot for `root`. */
  publish(root: string, snap: S): void {
    this.#snapshots.set(root, snap);
  }

  /** Install a complete-ENOUGH (interim) snapshot for `root` — but only when nothing is being
   *  served yet. On a refresh the incumbent snapshot is strictly better (it already carries the
   *  shell-out cards), so an interim could only ever downgrade it. */
  publishInterim(root: string, snap: S): void {
    if (!this.#snapshots.has(root)) this.#snapshots.set(root, snap);
  }

  /** Test seam: an optional hook awaited BETWEEN a build's cooperative steps. Production never sets
   *  it. It lets a test hold a build open and observe what concurrent requests see WHILE it runs. */
  setStepHook(hook: (() => Promise<void>) | null): void {
    this.#stepHook = hook;
  }

  /** Await the step hook, if one is set (a no-op in production). */
  async step(): Promise<void> {
    if (this.#stepHook) await this.#stepHook();
  }

  /** True while a rebuild for `root` is in flight — a direct reading of the mechanism's own state,
   *  not an inference from a timestamp. */
  isRebuilding(root: string): boolean {
    return this.#rebuilds.has(root);
  }

  /** Await the rebuild for `root`, if any (test seam — the request path never does this).
   *
   *  When a follow-up is queued it is preferred over the running build: the follow-up resolves
   *  strictly after the incumbent (it is chained onto it), so awaiting it is the reading that means
   *  "the store is reflected now" rather than "that older build finished". */
  awaitRebuild(root: string): Promise<void> {
    return this.#followUps.get(root) ?? this.#rebuilds.get(root) ?? Promise.resolve();
  }

  /** True when a follow-up rebuild is queued for `root` (an explicit `rebuild(…, "after")` arrived
   *  while a build was in flight). Distinct from `isRebuilding` — together they are the honest
   *  reading of the two waits this mechanism can be in. */
  isFollowUpQueued(root: string): boolean {
    return this.#followUps.has(root);
  }

  /** Start ONE build for `root`, register it as the in-flight rebuild, install its result, and
   *  retire its own marker when it settles. A failed build keeps the previous snapshot (a stale
   *  page is honest; a blanked one would be a fabricated absence) — the caller's `build` is
   *  expected to resolve the degraded shape rather than reject, but a rejection is still swallowed
   *  here for the same reason.
   *
   *  Only ever called when nothing is in flight for `root`; the `#rebuilds.get(root) === p` test in
   *  the `finally` keeps a stale build from deleting a NEWER build's marker. */
  rebuild(root: string, build: () => Promise<S>): Promise<void> {
    const p: Promise<void> = build()
      .then((snap) => {
        this.#snapshots.set(root, snap);
      })
      .catch(() => {
        /* keep the previous snapshot — see the contract above */
      })
      .finally(() => {
        if (this.#rebuilds.get(root) === p) this.#rebuilds.delete(root);
      });
    this.#rebuilds.set(root, p);
    return p;
  }

  /** The "a rebuild was requested for `root`" entry point, applying `policy` when one is already in
   *  flight. With nothing in flight this simply starts a build. */
  followUp(root: string, policy: RebuildPolicy, build: () => Promise<S>): Promise<void> {
    const inFlight = this.#rebuilds.get(root);
    if (!inFlight) return this.rebuild(root, build);
    if (policy === "skip") return inFlight; // the tick: never stack rebuilds on one root
    // `after`: this caller's change predates the incumbent's provider round-trips, so the incumbent
    // can never show it. Coalesce onto the ONE queued follow-up (a second `after` caller arriving
    // during the same wait must join it, not add a second build).
    const queued = this.#followUps.get(root);
    if (queued) return queued;
    let followUp: Promise<void>;
    const beginFollowUp = (): Promise<void> => {
      // Retire the queue entry as the follow-up STARTS, not as it settles. Otherwise an `after`
      // caller arriving while the follow-up build itself runs would be handed this same,
      // already-started promise — which began before its call and so cannot reflect its change.
      if (this.#followUps.get(root) === followUp) this.#followUps.delete(root);
      return this.followUp(root, "skip", build);
    };
    followUp = inFlight.then(beginFollowUp, beginFollowUp);
    this.#followUps.set(root, followUp);
    return followUp;
  }

  // ── the two reset scopes ─────────────────────────────────────────────────────────────────────

  /** Drop the snapshot lifecycle ONLY: every snapshot, in-flight rebuild marker, queued follow-up
   *  and the step hook. The TTL caches survive — this is the per-test hygiene handle, not a reset
   *  of the readers. */
  clearSnapshot(): void {
    this.#snapshots.clear();
    this.#rebuilds.clear();
    this.#followUps.clear();
    this.#stepHook = null;
  }

  /** Drop EVERYTHING this store owns: the four TTL caches plus the whole snapshot lifecycle.
   *  This is the one call a fresh-start / full-isolation test wants. */
  clear(): void {
    this.#taskSummaryCache.clear();
    this.#liveCache.clear();
    this.#sysCache.clear();
    this.#mgrLightCache.clear();
    this.clearSnapshot();
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  /** Read-through a per-root TTL cache: the stored value on a fresh hit, null on a miss or an
   *  expired entry. */
  #read<T>(cache: Map<string, TtlEntry<T>>, root: string, ttlMs: number): T | null {
    const hit = cache.get(root);
    if (hit == null || Date.now() - hit.at >= ttlMs) return null;
    return hit.value;
  }
}
