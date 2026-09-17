// @test-group serial
// @load-sensitive nested-spawn
// @load-sensitive-entry 2026-08-08 A-class nested full-suite spawn (shells out to real scripts/test.sh --list-files/--list-groups)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this file shells
// out to the REAL scripts/test.sh metadata modes (--list-files/--list-groups,
// >830s isolated historically) — inherently heavy + fragile under full-suite concurrency (nested
// node --test spawns; the outer reruns this family isolated per the 判绿 rules).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (A-class nested full-suite spawn) so it runs in the concurrency-1 serial phase,
// never competing with the concurrency-8 main body's worker pool. Its D-class AC7 fixture is kept
// in the shared plugin/test dir (that is what makes the undeclared→engine assertion meaningful);
// the collision with test-file-snapshot is fixed on the SNAPSHOT side (test-file-snapshot.sh
// excludes transient zz-* runtime fixtures).
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of the files split from the
// original runner-grouping.test.mjs (204s serial floor) by test concern — this file holds the
// --list-groups/--list-files RELATIONSHIP tests (the deduped partition invariants). The nested
// `@load-sensitive nested-spawn` annotation is preserved so the family membership + serial routing
// stay byte-identical.
// gap-test-suite-has-no-layer-grouping — tests for the layer-grouping mechanics in
// scripts/test.sh: extended glob (AC2), realpath dedup (AC3), default groups product,engine
// (AC4/AC6), and --list-groups (AC10). These shell out to the REAL
// scripts/test.sh (the single source of truth), not a copy of its logic.
// SPLIT from runner-grouping-list-groups.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/3 (1 test). Shared fixtures: ./helpers/runner-grouping-list-groups-harness.mjs (single source).

import { test } from "node:test";
import { assert, parseGroups, runTestShCached } from "./helpers/runner-grouping-list-groups-harness.mjs";

test("AC10/AC2/AC3: --list-groups reports per-group counts of the deduped glob", () => {
  const out = runTestShCached("--list-groups");
  const g = parseGroups(out);
  // Relationship, not snapshot: the FOUR groups partition the deduped realpath total (serial is
  // the load-sensitive family's group — gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests;
  // lowconc is the hermetic-but-load-sensitive concurrency-3 phase —
  // gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive).
  assert.equal(g.product + g.engine + g.serial + g.lowconc, g.total);
  // Structural sanity independent of absolute counts.
  assert.ok(g.product > 0 && g.engine > 0 && g.serial > 0 && g.lowconc > 0);
});
