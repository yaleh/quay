// @test-group engine
// driver-anchor-start-lock.test.mjs — the ATOMIC half of the "one anchor per root" invariant
// (tasks/gap-anchor-polling-git-fork-storm AC4).
//
// THE DEFECT THIS PINS: the pre-existing double-dispatch guard reads `.quay/anchor.pid` and then
// writes it. That is a read-then-write window, so two anchors launched at the same instant both see
// "no incumbent" and BOTH START — the finding measured two anchors on one root on the live host, and
// nothing in any reading said so (硬规则 3b: 静默共存 is the forbidden shape).
// `plugin/test/driver-anchor-stop.test.mjs` already covers the SEQUENTIAL case (the second anchor
// starts after the first has published `anchor.pid` and refuses, naming the incumbent). This file
// covers the case that guard structurally cannot: BOTH claim at the same time.
//
// Run: scripts/test.sh plugin/test/driver-anchor-start-lock.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { claimAnchorStartLock, releaseAnchorStartLock, anchorStartLockFile } from "../scripts/driver-anchor.ts";

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `anchor-lock-${tag}-`));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

const alive = () => true;
const dead = () => false;

test("AC4 — two anchors racing for the SAME root: exactly one wins, the other is REFUSED BY NAME", (t) => {
  const root = makeRoot("dup");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = claimAnchorStartLock(root, 11111, alive);
  assert.equal(first.ok, true, "the first claim wins");

  // The second starter is a DIFFERENT live process pointing at the same root.
  const second = claimAnchorStartLock(root, 22222, alive);
  assert.equal(second.ok, false, "the second anchor must NOT be allowed to start (⛔ 静默共存)");
  assert.equal(second.reason, "held");
  assert.equal(second.holder, 11111, "the refusal NAMES the incumbent pid — a named conflict, not a boolean");
  console.log(`  AC4: first claim ok, second refused with holder=pid ${second.holder} (${second.reason})`);
});

test("AC4 — a STALE lock (dead holder) is stolen, so a crashed starter can never wedge a restart", (t) => {
  const root = makeRoot("stale");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(claimAnchorStartLock(root, 33333, alive).ok, true, "an anchor claims the root");
  // Its holder dies without releasing (crash / SIGKILL).
  const next = claimAnchorStartLock(root, 44444, dead);
  assert.equal(next.ok, true, "the dead holder's lock is stolen — a crash must not wedge every later start");
  assert.equal(fs.readFileSync(anchorStartLockFile(root), "utf8").trim(), "44444", "the new holder is recorded");
});

test("AC4 — release only by the holder (a stolen-by-someone-else claim must not be undone)", (t) => {
  const root = makeRoot("release");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(claimAnchorStartLock(root, 55555, alive).ok, true);
  releaseAnchorStartLock(root, 66666); // NOT the holder
  assert.equal(fs.existsSync(anchorStartLockFile(root)), true, "a non-holder's release is a no-op");
  releaseAnchorStartLock(root, 55555); // the holder
  assert.equal(fs.existsSync(anchorStartLockFile(root)), false, "the holder's release frees the root");
  assert.equal(claimAnchorStartLock(root, 77777, alive).ok, true, "the freed root is claimable again");
});
