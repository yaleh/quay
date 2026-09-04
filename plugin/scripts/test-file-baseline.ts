// test-file-baseline.ts — relative-baseline criterion for global test-set counts.
//
// gap-global-count-assertions-fragile-relative-baseline: B3-2 went red on fan-in because a
// hardcoded `EXPECTED_ENGINE = 58` global-count assertion went stale when B3-1 merged a new
// engine test 13 min after B3-2's worktree snapshot. The real defect is the assertion SHAPE:
// a SNAPSHOT (`== 58`) is fragile against ANY concurrent change to the global set, while a
// RELATIONSHIP computed at runtime against a fork-baseline snapshot is not.
//
// The durable rule (fast-mode tick doc, 2026-08-02): global quantities (file count, test count,
// group-member count) must be COMPUTED AT RUNTIME, never hardcoded as constants. Assertions may
// be RELATIONS (e.g. "product + engine == deduplicated realpath total"), not
// SNAPSHOTS. This module is the mechanical core for the baseline-snapshot form of that rule:
//
//   AC2  — record the test-file set snapshot at fork (worktree-creation) time.
//   AC1  — assert the RELATION `current ⊇ baseline ∪ declaredAdditions` and
//          `|current| >= |baseline| + |additions|`, never `|current| == <constant>`.
//
// B3-2 semantics: a concurrent merge that ADDS an unrelated test file is LEGITIMATE — it raises
// the global total but never invalidates the task's own relative baseline. `relativeBaselineViolations`
// therefore checks the ⊇ direction (nothing the task depends on disappeared) and a count LOWER
// bound, NOT an exact equality. An exact `== baseline_count` is exactly the fragile snapshot shape
// this task removes.

/** A fork-baseline snapshot of a test-file set (recorded at worktree-creation time). */
export interface TestFileSnapshot {
  /** sorted, deduplicated realpaths recorded at snapshot time */
  files: string[];
}

/** Record a fork-baseline snapshot of a test-file set. Pure: sorts + dedupes. */
export function snapshotTestFiles(files: Iterable<string>): TestFileSnapshot {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of files) {
    const f = String(raw).trim();
    if (f.length > 0 && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return { files: out.sort() };
}

/** The task's OWN relative-baseline set = fork-baseline ∪ declared touch additions (sorted, deduped). */
export function expectedTestFiles(snapshot: TestFileSnapshot, additions: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...snapshot.files, ...[...additions].map((a) => String(a).trim()).filter(Boolean)]) {
    if (f.length > 0 && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out.sort();
}

/**
 * Assert the relative-baseline relation for a global test-set count. Returns a list of violations
 * (empty array == green). The criterion is COMPUTED AT RUNTIME — never an absolute count constant.
 *
 * Checks:
 *   (1) every fork-baseline file and every declared touch addition is still present in `current`
 *       (the ⊇ direction — the task's dependencies must not disappear), and
 *   (2) `|current| >= |expected|` where expected = baseline ∪ additions (the count LOWER bound).
 *
 * It deliberately does NOT check `current ⊆ baseline ∪ additions`: a concurrent merge that adds an
 * unrelated test file (B3-1's merged engine test) is legitimate and must not invalidate the
 * assertion. That is exactly the B3-2 failure class this criterion exists to make green.
 *
 * @param current  the test-file set as observed NOW (e.g. `scripts/test.sh --list-files` output)
 * @param snapshot the fork-baseline snapshot recorded at worktree creation (AC2)
 * @param additions this task's declared touch-additions to the test-file set (usually [] for a
 *                  task that adds no test files)
 */
export function relativeBaselineViolations(
  current: Iterable<string>,
  snapshot: TestFileSnapshot,
  additions: Iterable<string> = [],
): string[] {
  const currentSet = new Set([...current].map((f) => String(f).trim()).filter(Boolean));
  const expected = expectedTestFiles(snapshot, additions);
  const violations: string[] = [];

  for (const f of expected) {
    if (!currentSet.has(f)) {
      violations.push(
        `relative-baseline test file "${f}" (fork-baseline ∪ declared additions) is missing from the current tree`,
      );
    }
  }
  if (currentSet.size < expected.length) {
    violations.push(
      `current test-file count ${currentSet.size} is below the relative-baseline expected count ${expected.length} (baseline ${snapshot.files.length} + additions ${expected.length - snapshot.files.length})`,
    );
  }
  return violations;
}

/** Count relation form: expected global count = baseline count + declared additions (runtime-computed). */
export function expectedCount(snapshot: TestFileSnapshot, additions: Iterable<string>): number {
  return expectedTestFiles(snapshot, additions).length;
}
