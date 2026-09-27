// @test-group product
// plugin/test/tmp-workspace-writable-root.test.mjs
//
// gap-ac233-criterion-not-hermetic-host-quota-false-red — the direct unit test for the tmp-root
// SELECTION in plugin/test/helpers/tmp-workspace.mjs.
//
// Why this file exists at all: the helper is shared by hundreds of test files, and its whole point
// is that the tmp root is *chosen by a real write probe* rather than read from `os.tmpdir()`. A
// criterion that only ever runs on a host with a healthy quota can never exercise the interesting
// arm (preferred root unwritable), so the selection is pinned here with EXPLICIT candidate lists —
// no real quota exhaustion, no chmod of a shared directory, no dependence on how this host is
// mounted right now.
//
// Three arms, and each is the negative of the other two:
//   (1) preferred root unwritable ⇒ the next writable candidate is used (the fallback EXISTS);
//   (2) every candidate unwritable ⇒ a TmpRootUnavailableError, NOT an ordinary assertion failure;
//   (3) the exit contract that error is turned into is 2, and a control run that fails an ordinary
//       assertion exits 1 — measured, so "distinguishable" is a reading rather than a claim
//       (硬规则 4 推论四: a story that explains a phenomenon is not a tested conclusion).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  makeTmpDir,
  resolveTmpRoot,
  writableTmpRoot,
  TmpRootUnavailableError,
  TMP_ROOT_UNAVAILABLE,
  TMP_ROOT_UNAVAILABLE_EXIT,
} from "./helpers/tmp-workspace.mjs";

/** A path guaranteed NOT to exist: a child of a real dir, never created. mkdtemp under a
 * non-existent parent is ENOENT — deterministic for both root and non-root users, unlike a
 * mode-0o500 directory (which a root user can write to anyway). */
function absentRoot() {
  return path.join(makeTmpDir("quay-writable-root-absent-"), "never-created");
}

test("preferred root unwritable ⇒ falls back to the next writable candidate", () => {
  const good = makeTmpDir("quay-writable-root-good-");
  const absent = absentRoot();

  // The absent root is FIRST in the list — if the probe were skipped (or a stat() were mistaken for
  // a write probe) this would return `absent` and the read would be a false green.
  assert.equal(resolveTmpRoot([absent, good]), good, "must skip the unwritable candidate");
  assert.ok(fs.existsSync(good), "the chosen root must be a real directory");
});

test("read-only existing root is skipped too (not just absent ones)", (t) => {
  // A directory that EXISTS but cannot be written is the shape the host actually presents when the
  // /data user quota is exhausted. Skipped for root users, who bypass the mode bits.
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("running as root: mode bits do not restrict writes");
    return;
  }
  const good = makeTmpDir("quay-writable-root-good2-");
  const ro = makeTmpDir("quay-writable-root-ro-");
  fs.chmodSync(ro, 0o500);
  try {
    assert.equal(resolveTmpRoot([ro, good]), good, "a read-only candidate must not be selected");
  } finally {
    fs.chmodSync(ro, 0o700); // let the helper's file-level after() remove it
  }
});

test("every candidate unwritable ⇒ a TYPED failure that is not an assertion error", () => {
  const a = absentRoot();
  const b = absentRoot();
  let raised = null;
  try {
    resolveTmpRoot([a, b]);
  } catch (err) {
    raised = err;
  }
  assert.ok(raised, "resolveTmpRoot must not return a root when none is writable");
  assert.ok(
    raised instanceof TmpRootUnavailableError,
    `expected TmpRootUnavailableError, got ${raised && raised.name}`
  );
  // "无法评估" must have its own name in the output vocabulary (硬规则 3b) — and it must be
  // enumerable: the failure names every candidate it probed, not just "it failed".
  assert.equal(raised.code, TMP_ROOT_UNAVAILABLE);
  assert.deepEqual(raised.candidates, [a, b]);
});

test("the cannot-evaluate exit code is 2 — and an ordinary failure is 1 (measured control)", () => {
  const helperUrl = new URL("./helpers/tmp-workspace.mjs", import.meta.url).href;

  // Arm 1: the helper's own cannot-evaluate exit.
  const cannotEvaluate = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { tmpRootUnavailableExit } from ${JSON.stringify(helperUrl)};\n` +
        `tmpRootUnavailableExit({ candidates: ["/nonexistent-quota-probe-a", "/nonexistent-quota-probe-b"] });`,
    ],
    { encoding: "utf8" }
  );
  // Arm 2 (the control, without which "2 is distinguishable" is a story, not a reading): an
  // ordinary failed assertion exits 1.
  const assertionFailure = spawnSync(process.execPath, ["-e", "throw new Error('boom')"], {
    encoding: "utf8",
  });

  assert.equal(assertionFailure.status, 1, "control: an ordinary failure exits 1");
  assert.equal(cannotEvaluate.status, TMP_ROOT_UNAVAILABLE_EXIT, "cannot-evaluate exits 2");
  assert.notEqual(
    cannotEvaluate.status,
    assertionFailure.status,
    "cannot-evaluate must NOT share its exit code with a failed assertion"
  );
  assert.match(cannotEvaluate.stderr, new RegExp(TMP_ROOT_UNAVAILABLE));
});

test("the default resolution (no explicit candidates) yields a real writable root", () => {
  const root = writableTmpRoot();
  assert.ok(fs.existsSync(root), `resolved root must exist: ${root}`);
  // Probed the same way the helper probes: a real mkdtemp + write, cleaned up immediately.
  const probe = makeTmpDir("quay-writable-root-probe-");
  assert.ok(probe.startsWith(root), `${probe} must live under the resolved root ${root}`);
});
