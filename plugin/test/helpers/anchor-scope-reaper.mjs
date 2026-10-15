// anchor-scope-reaper.mjs — reclaim, BY UNIT NAME, the systemd scopes a test FILE started, and
// assert that none is left behind.
//
// Shared by `plugin/test/driver-cli.test.mjs` and `plugin/test/driver-restart-busy-e2e.test.mjs`:
// both had the same obligation and the same defect, so the mechanism lives here once (a per-file
// copy is the drift this repo pins out — 硬规则 5b).
//
// ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────────────────────────
// (task gap-test-spawned-anchor-scopes-outlive-suite-again-ac1-stop-and-restart-ac5)
//
// `quay driver start` spawns the detached anchor through
// `systemd-run --user --scope --collect --unit=quay-anchor-<root base>-<ts>.scope`
// (`plugin/scripts/driver-runtime.ts` spawnAnchor → `packages/quay/src/systemd-scope.ts`), so a
// TEST that starts a driver starts a real transient scope on the user manager. The fixture
// teardowns stop the anchor — and stopping the anchor is NOT the same thing as emptying the scope:
//
//   ① THE SCOPE'S MEMBERS ARE NOT ONLY THE ANCHOR. The anchor hosts every kind's loop INSIDE its
//      own process, and those loops `spawn` children (a worker loop's dispatched worker, and every
//      fixture that models one). A child INHERITS THE SCOPE'S CGROUP. Killing the anchor by pid
//      leaves the children inside the scope; `--collect` collects an EMPTY scope, so the unit
//      outlives the suite by exactly as long as its longest-lived child.
//      MEASURED 2026-10-15 (this host): a CLEAN `node --test plugin/test/driver-restart-busy-e2e.test.mjs`
//      (7/7 pass, exit 0) left `quay-anchor-e2e-restart-ac2a-FkROLL-1792048717728.scope` alive with
//      exactly one member — the AC2a fixture's own in-flight child
//      (`node -e setTimeout(()=>{},120000)`, ppid reparented to systemd --user) — after `cleanup()`
//      had SIGKILLed the anchor. Reproduced on two consecutive full-file runs.
//   ② THE ANCHOR ITSELF CAN SURVIVE. `quay driver stop` does not always reach it, and a teardown
//      the outer limit interrupts runs no JS at all. The tell for the interrupted case is on disk:
//      the fixture ROOT survives (the last `fs.rmSync` never ran) next to a live `quay-anchor-*`
//      scope. Measured residue of both shapes is on this host since 2026-10-14
//      (`quay-anchor-driver-cli-ac1-stop-eEx6Ag-…`, `quay-anchor-e2e-restart-ac5-…`).
//
// A leaked scope is not cosmetic: `listSharedHostScopes()` counts every live `quay-anchor-*` /
// `quay-serve-*` scope into the shared-host memory guardrail, so each residue silently re-tightens
// EVERY other project's anchor ceiling — and it holds real processes while doing so.
//
// ── WHY BY UNIT NAME, AND ONLY FOR THE CALLER'S OWN ROOTS ───────────────────────────────────────
// A scope's unit name is `<prefix><basename(root)>-<ts>.scope` and the root is that test's own
// `mkdtemp` path ⇒ the pair (prefix, basename(root)) names EXACTLY the scopes that test started.
// ⛔ Never by pid (the leaking child is not the pid the fixture recorded), ⛔ never by a bare
// prefix (that reaches another file's — or another project's — scope). `systemctl --user stop`
// terminates EVERY process in the cgroup, which is precisely the half a pid-based kill cannot do.
//
// ⛔ WHAT THIS DOES NOT COVER, stated so it is not read as covered: if the test process is
// SIGKILLed (suite abort / watchdog / OOM) no JS teardown runs at all. This bounds the leak to
// that case; it does not close it.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// THE single source of "which unit prefixes count as quay's own scopes" — the very list the
// shared-host guardrail counts (`[ANCHOR_UNIT_PREFIX, SERVE_UNIT_PREFIX]`), ⛔ not a third copy of it.
import { SHARED_HOST_SCOPE_PREFIXES } from "../../scripts/driver-runtime.ts";
// The naming + availability primitives come from the LEAF that owns them (`systemd-scope.ts` is
// node-builtins-only by its own "LEAF DISCIPLINE" header), so this helper needs no kernel closure
// for them; `driver-runtime.ts` merely binds the anchor prefix to the same functions.
import { scopeUnitName, systemdScopeAvailable } from "../../../packages/quay/src/systemd-scope.ts";

export { SHARED_HOST_SCOPE_PREFIXES };

const LIST_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 20_000;

/** The unit-name stem that identifies the scopes a given root started.
 *
 *  Derived by running the ANCHOR'S OWN naming function with an injected timestamp and dropping the
 *  timestamp — so the sanitization is `scopeUnitName()`'s, ⛔ not a second copy of it here (硬规则 5b:
 *  a re-implemented sanitizer is exactly the kind of copy that drifts the day systemd's rules move). */
function unitStemFor(prefix, root) {
  const suffix = "-0.scope";
  const name = scopeUnitName(prefix, root, 0);
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/** How many processes the kernel says are in a unit's cgroup.
 *
 *  ⛔ WHY THIS IS THE JUDGED QUANTITY AND THE UNIT LISTING IS NOT (measured 2026-10-15, this host):
 *  `systemctl list-units --all` keeps listing a scope for a while AFTER it stopped — such a unit
 *  reads `dead`, its cgroup directory is gone, and it holds nothing. Measured: three combined
 *  `node --test <both files>` runs flagged 0 / 2 / 2 "new" units at +15s and **every one of them was
 *  `dead` with no cgroup directory** — i.e. the listing alone reports a leak that is not one, and a
 *  gate built on it is a flake generator in both directions. What this task is about is a scope that
 *  still holds processes (that is what `listSharedHostScopes()` counts and what "活过套件" means).
 *  ⇒ `liveUnits` (cgroup.procs non-empty) is the judged quantity; `units` is reported alongside so
 *  the lagging records stay visible (硬规则 3b: 记在表上但已回收 ≠ 还在跑).
 *
 *  Returns `null` for 「读不成」 (⛔ never folded into `false` = 「没有成员」). */
function unitMemberCount(unit) {
  const show = spawnSync("systemctl", ["--user", "show", "-p", "ControlGroup", "--value", unit], {
    encoding: "utf8",
    timeout: LIST_TIMEOUT_MS,
  });
  if (show.error || show.status !== 0) return null;
  const rel = String(show.stdout || "").trim();
  if (!rel) return null; // 没有 ControlGroup 读数 ≠ 没有成员
  try {
    return fs.readFileSync(path.join("/sys/fs/cgroup", rel, "cgroup.procs"), "utf8").trim().split("\n").filter(Boolean).length;
  } catch (e) {
    // ENOENT: the cgroup directory is gone ⇒ the unit was collected and provably holds nothing.
    // 其它 errno（权限/IO）⇒ 读不成，⛔ 不与「零成员」同形。
    return e && e.code === "ENOENT" ? 0 : null;
  }
}

/**
 * The scopes THIS file started, read off the user manager.
 *
 * `units` = every matching unit the manager still lists (may include already-collected records);
 * `liveUnits` = the subset whose cgroup still holds ≥1 process — **the judged quantity** (see
 * `unitMemberCount`).
 *
 * Three-valued (硬规则 3b): `evaluated: false` + a NAMED `reason` is its own answer — 「没查成」 must
 * not share an output with 「查过，就是没有」.
 */
export function readOwnScopes(roots, prefixes = SHARED_HOST_SCOPE_PREFIXES) {
  const wanted = new Set();
  for (const prefix of prefixes) for (const root of roots) wanted.add(`${unitStemFor(prefix, root)}-`);

  const units = new Set();
  const unreadable = [];
  for (const prefix of prefixes) {
    const r = spawnSync("systemctl", ["--user", "list-units", `${prefix}*`, "--all", "--no-legend", "--plain"], {
      encoding: "utf8",
      timeout: LIST_TIMEOUT_MS,
    });
    if (r.error || r.status !== 0) {
      unreadable.push(`${prefix}* → ${r.error ? r.error.message : `exit ${r.status}: ${String(r.stderr || "").trim()}`}`);
      continue;
    }
    for (const line of String(r.stdout || "").split("\n")) {
      const unit = line.trim().split(/\s+/)[0];
      if (!unit || !unit.endsWith(".scope")) continue;
      for (const stem of wanted) if (unit.startsWith(stem)) units.add(unit);
    }
  }

  const listed = [...units].sort();
  const liveUnits = [];
  for (const unit of listed) {
    const members = unitMemberCount(unit);
    if (members === null) unreadable.push(`${unit} → member count not evaluated`);
    else if (members > 0) liveUnits.push(unit);
  }

  return {
    evaluated: unreadable.length === 0,
    units: listed,
    liveUnits,
    reason: unreadable.length === 0 ? null : `scope reading not evaluated: ${unreadable.join("; ")}`,
  };
}

/** Kill every member of a unit through the kernel's own primitive.
 *
 *  The fallback for a `systemctl --user stop` that did not take. `cgroup.kill` is a DIRECT quantity
 *  (the kernel kills the whole cgroup, whatever pids it holds) whereas `show`/write can each fail
 *  in ways that must not read as 「杀过了」 ⇒ a NAMED outcome, ⛔ never a bare boolean (硬规则 3b). */
function killScopeCgroup(unit) {
  const show = spawnSync("systemctl", ["--user", "show", "-p", "ControlGroup", "--value", unit], {
    encoding: "utf8",
    timeout: LIST_TIMEOUT_MS,
  });
  if (show.error || show.status !== 0) {
    return `not-evaluated: cannot resolve the unit's cgroup (${show.error ? show.error.message : `exit ${show.status}`})`;
  }
  const rel = String(show.stdout || "").trim();
  if (!rel) return "not-evaluated: the unit reports no ControlGroup (already collected?)";
  try {
    fs.writeFileSync(path.join("/sys/fs/cgroup", rel, "cgroup.kill"), "1");
    return "killed";
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** 回收的重试预算。为什么不是「停一次就够」：`systemctl stop` 返回 0 表示**作业已受理**，而单元从
 *  `active` 到真正没有成员之间有一段窗口 —— 夹具若在这段窗口里还有成员落地（anchor 正在死的同一
 *  瞬间 fork 出来的子进程，或仍在收尾的 kind 循环），单次「读-停-读」就会读到「已空」而单元随后
 *  又带着那个成员回来。⛔ 判据是**成员数**（`liveUnits`）而不是「单元还在不在表上」：后者会把系统
 *  的收集延迟读成泄漏（实测见 `unitMemberCount`）。有界重试，⛔ 不是无界。 */
const RECLAIM_ATTEMPTS = 10;
const RECLAIM_SETTLE_MS = 300;

/**
 * Stop every scope this file started under the given roots, and keep at it until **none of them holds
 * a process** (bounded). Returns the raw readings so a caller, or a human reading a failure, sees WHAT
 * happened rather than a boolean. Idempotent and cheap when there is nothing to reclaim.
 */
export async function reclaimOwnScopes(roots, prefixes = SHARED_HOST_SCOPE_PREFIXES) {
  const before = readOwnScopes(roots, prefixes);
  const attempts = [];
  let after = before;
  let round = 0;

  while (round < RECLAIM_ATTEMPTS && after.liveUnits.length > 0) {
    round += 1;
    // 停**所有**列出中的单元（含已无成员的：对系统是一次幂等 no-op，却能让滞后的单元记录尽快消失）。
    for (const unit of after.units) {
      const r = spawnSync("systemctl", ["--user", "stop", unit], { encoding: "utf8", timeout: STOP_TIMEOUT_MS });
      const failed = Boolean(r.error) || r.status !== 0;
      attempts.push({
        round,
        unit,
        rc: r.status,
        error: failed ? (r.error ? r.error.message : String(r.stderr || "").trim()) : null,
        // 停不掉才写 cgroup.kill（内核自己的「杀光整个 cgroup」原语，能碰到不是主进程的那些成员）。
        cgroupKill: failed ? killScopeCgroup(unit) : null,
      });
    }
    await new Promise((r) => setTimeout(r, RECLAIM_SETTLE_MS));
    after = readOwnScopes(roots, prefixes);
  }

  return {
    before: before.units,
    attempts,
    /** 仍在表上的单元（可能只是收集延迟 —— 判据不取它，但⛔不隐藏它）。 */
    remaining: after.units,
    /** **仍在跑**的单元：判据取它。 */
    remainingLive: after.liveUnits,
    evaluated: before.evaluated && after.evaluated,
    reason: after.reason ?? before.reason,
    rounds: round,
  };
}

/**
 * The end-of-file gate: assert this file's own scopes are all gone.
 *
 * FAILS on a leak AND on an unreadable instrument — with one exception that is not a loophole but
 * the honest reading: on a host with no `systemd-run --user --scope` the driver was never wrapped in
 * an envelope at all, so no scope could have been created, and 「没有 scope 机制」 is reported as
 * `not-applicable` rather than silently passing as 「零泄漏」. The two are told apart by the kernel's
 * OWN availability probe (the same memoized probe the spawn path consults), ⛔ not by guessing from
 * the failure text.
 */
export function assertNoOwnScopes(roots, label, prefixes = SHARED_HOST_SCOPE_PREFIXES) {
  const r = readOwnScopes(roots, prefixes);
  if (!r.evaluated) {
    assert.equal(
      systemdScopeAvailable(),
      false,
      `${label}: scope 读数【未评估】而本机 systemd-run --user --scope 可用 ⇒ 仪器故障 —「查不成」不得与「零泄漏」同形（硬规则 3b）: ${r.reason}`,
    );
    return { ...r, reading: "not-applicable: this host has no systemd --user scope envelope, so no scope could have been created" };
  }
  assert.deepEqual(
    r.liveUnits,
    [],
    `${label}: 本文件起的 scope 仍有 ${r.liveUnits.length} 个**在跑**（scope 的成员不只是 anchor——kind 循环 spawn 的子进程同样住在里面）: ` +
      `${r.liveUnits.join(", ")}${r.units.length > r.liveUnits.length ? `（另有已无成员、仅系统单元记录滞后的: ${r.units.filter((u) => !r.liveUnits.includes(u)).join(", ")}）` : ""}`,
  );
  return r;
}

/** Per-FILE registry of the roots its fixtures created — the input to that file's end-of-file gate.
 *  Registration happens in the fixture factories, so a new test case cannot forget it. */
export function createScopeRootRegistry() {
  const roots = [];
  return {
    /** Register a fixture root and hand it straight back (usable inline: `register(makeRoot(…))`). */
    register(root) {
      if (root && !roots.includes(root)) roots.push(root);
      return root;
    },
    list() {
      return [...roots];
    },
  };
}

/** Poll until `predicate()` is true or the budget runs out; returns whether it became true.
 *  Bounded on purpose — an unbounded poll would hang the suite instead of failing it. */
export async function waitUntil(predicate, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}
