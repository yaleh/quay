// @test-group product
// gap-provider-client-list-masks-call-failure-as-empty — AC1..AC6.
//
// provider-client.ts's adrList/goalList/metaList used to do `if (r.isError)
// return []`, collapsing a GENUINE provider call failure into "there are no
// records" — the exact 硬规则 3b shape (a judge's "could not read the input"
// answer was byte-identical to its "clean, empty" answer). taskList was already
// fixed to THROW (gap-one-unparseable-task-takes-down-the-whole-board AC5);
// this task applies the SAME ruling to the three siblings. The three states,
// and what each MUST yield:
//
//   failure     — the provider's tool answered with isError   ⇒ throw, never []
//   empty       — the tool answered with zero records         ⇒ []
//   unsupported — the provider does not do this kind          ⇒ []
//
// These tests use REAL providers (the native provider and the github provider)
// — no fixture/injection seam stands in for the call — so the readings are of
// the actual fan-out behaviour (DoD1). The failure leg is produced by removing
// a carrier directory out from under the ALREADY-CONNECTED native provider,
// which makes that kind's store `readdirSync` throw (the stores deliberately do
// NOT catch ENOENT — see adr-store.ts / goal-store.ts / meta-store.ts), which
// the provider surfaces as isError:true.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { connectProvider } from "../src/provider-client.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native");
const githubBin = path.join(__dirname, "..", "..", "quay-github", "bin", "quay-github.ts");
const githubProviderDir = path.join(__dirname, "..", "..", "quay-github");
const SRC_DIR = path.join(__dirname, "..", "src");

// Every mkdtemp fixture is removed once at the end of the file (the carrier-array
// + after() pattern) — a mkdtemp without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function mkCarriers(tag) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `pc-${tag}-tasks-`));
  const adrDir = fs.mkdtempSync(path.join(os.tmpdir(), `pc-${tag}-adr-`));
  const goalDir = fs.mkdtempSync(path.join(os.tmpdir(), `pc-${tag}-goals-`));
  const metaDir = fs.mkdtempSync(path.join(os.tmpdir(), `pc-${tag}-meta-`));
  _tmpDirs.push(tasksDir, adrDir, goalDir, metaDir);
  return { tasksDir, adrDir, goalDir, metaDir };
}

async function connectNative({ tasksDir, adrDir, goalDir, metaDir }) {
  return connectProvider({
    command: "node",
    args: [nativeBin, "mcp"],
    cwd: nativeProviderDir,
    env: {
      QUAY_NATIVE_TASKS_DIR: tasksDir,
      QUAY_NATIVE_ADR_DIR: adrDir,
      QUAY_NATIVE_GOAL_DIR: goalDir,
      QUAY_NATIVE_META_DIR: metaDir,
    },
  });
}

async function connectGithub() {
  return connectProvider({
    command: "node",
    args: [githubBin, "mcp"],
    cwd: githubProviderDir,
    env: { QUAY_GITHUB_REPO: "yaleh/quay" },
  });
}

/** One reading of a list call: "resolved:<json>" or "rejected:<message>". Two
 *  outcomes are distinguishable by program iff their strings differ (AC2). */
async function outcome(fn) {
  try {
    return `resolved:${JSON.stringify(await fn())}`;
  } catch (err) {
    return `rejected:${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── AC1/AC2/AC3: empty vs failure, both directions, on the REAL native provider ─

test("AC2/AC3① — a healthy provider with zero records resolves [] for adr/goal/meta (the 'empty' state)", async () => {
  const c = mkCarriers("empty");
  const client = await connectNative(c);
  try {
    assert.deepEqual(await client.adrList(), [], "adrList: empty store → []");
    assert.deepEqual(await client.goalList(), [], "goalList: empty store → []");
    assert.deepEqual(await client.metaList(), [], "metaList: empty store → []");
  } finally {
    await client.close();
  }
});

test("AC1/AC3①/DoD1 — a genuine provider call failure makes adr/goal/meta REJECT, never a silent []", async () => {
  const c = mkCarriers("fail");
  const client = await connectNative(c);
  try {
    // Precondition: the SAME three calls resolve [] while the provider is healthy.
    assert.deepEqual(await client.adrList(), []);
    assert.deepEqual(await client.goalList(), []);
    assert.deepEqual(await client.metaList(), []);

    // Remove each carrier dir out from under the running provider → that kind's
    // store readdirSync throws ENOENT → provider isError:true → the list verb
    // must reject (this is the behaviour the old `return []` masked).
    fs.rmSync(c.adrDir, { recursive: true, force: true });
    await assert.rejects(() => client.adrList(), /ENOENT/, "adrList must throw on a genuine call failure");

    // The other two are untouched — proves the rejection is the failed carrier's,
    // not a client-wide breakage (a proper negative control).
    assert.deepEqual(await client.goalList(), [], "goalList is unaffected by the adr carrier failing");
    assert.deepEqual(await client.metaList(), [], "metaList is unaffected by the adr carrier failing");

    fs.rmSync(c.goalDir, { recursive: true, force: true });
    await assert.rejects(() => client.goalList(), /ENOENT/, "goalList must throw on a genuine call failure");

    fs.rmSync(c.metaDir, { recursive: true, force: true });
    await assert.rejects(() => client.metaList(), /ENOENT/, "metaList must throw on a genuine call failure");
  } finally {
    await client.close();
  }
});

test("AC2/AC3/DoD1 — 'failure' and 'zero records' are programmatically distinguishable (one reading, both arms)", async () => {
  const c = mkCarriers("distinct");
  const client = await connectNative(c);
  try {
    const emptyAdr = await outcome(() => client.adrList());
    fs.rmSync(c.adrDir, { recursive: true, force: true });
    const failedAdr = await outcome(() => client.adrList());

    assert.equal(emptyAdr, "resolved:[]", "zero records reads as a resolved []");
    assert.match(failedAdr, /^rejected:/, "a call failure reads as a rejection");
    assert.notEqual(emptyAdr, failedAdr, "the two states MUST NOT be the same value (硬规则 3b)");
    assert.ok(!failedAdr.endsWith("[]"), "a failure must never read as []");
  } finally {
    await client.close();
  }
});

// ── AC6/DoD3: unsupported ≠ failure — the REAL github provider ─────────────────

test("AC6/DoD3 — github's unsupported kinds resolve [] (NOT a failure), while a failing provider rejects", async () => {
  const gh = await connectGithub();
  try {
    // github declares ADRs/goals unsupported. adr_list/goal_list are registered
    // stubs returning a clean NON-error empty; meta_list is not registered at
    // all (the SDK's `Tool meta_list not found` isError is classified as
    // unsupported, not failure). All three must resolve [], never throw.
    const adr = await outcome(() => gh.adrList());
    const goal = await outcome(() => gh.goalList());
    const meta = await outcome(() => gh.metaList());
    assert.equal(adr, "resolved:[]", "github adrList (unsupported) → []");
    assert.equal(goal, "resolved:[]", "github goalList (unsupported) → []");
    assert.equal(meta, "resolved:[]", "github metaList (no such tool) → [] — unsupported, not failure");

    // The SAME three modes against a genuinely-failing provider reject (test
    // above) — so "unsupported" and "failure" are distinguishable by value:
    // here every kind resolves []; there every kind rejects.
  } finally {
    await gh.close();
  }
});

// ── AC4/DoD2: the old silent-[] shape is gone and the four kinds share one ruling ─

test("AC4/DoD2 — no `if (r.isError) return []` remains in packages/quay/src; adr/goal/meta route through the shared unwrap", () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".ts")) {
        if (/isError\)\s*return\s*\[\]/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(SRC_DIR, p));
      }
    }
  };
  walk(SRC_DIR);
  // The task was filed with a measured count of 3 (adrList/goalList/metaList);
  // after the fix the shape must be gone entirely.
  assert.deepEqual(hits, [], `the old silent-[] shape is gone (found in: ${hits.join(", ") || "none"})`);

  const pc = fs.readFileSync(path.join(SRC_DIR, "provider-client.ts"), "utf8");
  assert.match(pc, /function unwrapKindList</, "provider-client.ts carries the shared unwrap");
  assert.match(pc, /unwrapKindList<AdrRecord>\(r, "adr_list"/, "adrList uses the shared unwrap");
  assert.match(pc, /unwrapKindList<GoalRecord>\(r, "goal_list"/, "goalList uses the shared unwrap");
  assert.match(pc, /unwrapKindList<MetaRecord>\(r, "meta_list"/, "metaList uses the shared unwrap");
  // taskList is unchanged (AC "不做"): it still throws directly on isError.
  assert.match(pc, /task_list failed/, "taskList keeps its own throw-on-isError");
});
