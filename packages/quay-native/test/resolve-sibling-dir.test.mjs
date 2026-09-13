// @test-group product
// carrier-dir resolution — packages/quay-native/src/carrier-dirs.ts
//
// gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.
//
// THE DEFECT (measured 2026-09-13 in a real third-party project, /home/yale/work/quay-fleet):
// `quay goal list` returned QUAY'S OWN goals (AC-143…AC-157) and `adr list` quay's ADR-001…ADR-011,
// while `task list` was correctly isolated. Cause: the sibling carriers (adr/goals/meta/docs-managed)
// were resolved by re-walking the cwd for the first `.quay/config.yml` upward, and quay-init's
// upgrade channel binds `provider.path` to the PLUGIN's vendored runtime — which lives INSIDE the
// quay repo. So the marker found upward belonged to quay, not to the target project. The fix derives
// each carrier from the ALREADY-RESOLVED tasks dir (the invariant Core's own src/mcp-server.ts
// defaults already state: `<parent-of-tasksDir>/<kind>`).
//
// WHAT MAKES THESE TESTS ABLE TO FAIL (hard rule 4 — a quantity that cannot be false is not a
// measurement): every isolation test below puts the process cwd inside a DIFFERENT, real workspace
// that HAS a `.quay/config.yml`, so the pre-fix resolution has a definite wrong answer to return.
// Test 1 asserts the right dirs AND asserts they are not that workspace's dirs; test 5 puts a
// sentinel goal in the other workspace and asserts the MCP server cannot see it — pre-fix it would.
//
// Run: node --test packages/quay-native/test/resolve-sibling-dir.test.mjs
//      scripts/test.sh packages/quay-native/test/resolve-sibling-dir.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  findRepoRoot,
  isWorkspaceRoot,
  resolveAdrDir,
  resolveDocsDir,
  resolveGoalDir,
  resolveMetaDir,
  resolveSiblingDir,
  resolveTasksDir,
  resolveWorkspaceBaseDir,
} from "../src/carrier-dirs.ts";
import { QUAY_NATIVE_CLI } from "../../quay/test/helpers/cli-entry.mjs";

const binPath = QUAY_NATIVE_CLI;
const tmpRoots = [];
const CARRIERS = [
  ["adr", resolveAdrDir],
  ["goals", resolveGoalDir],
  ["meta", resolveMetaDir],
  ["docs-managed", resolveDocsDir],
];

function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(d);
  return d;
}

/** A directory that IS a quay workspace (carries the marker `findRepoRoot` walks for). */
function makeWorkspace(prefix) {
  const ws = mkTmp(prefix);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), "providers: {}\n", "utf8");
  return ws;
}

/** Run `fn` with cwd and the five carrier env vars set as given; always restores both. */
function withCwdAndEnv(cwd, env, fn) {
  const KEYS = [
    "QUAY_NATIVE_TASKS_DIR",
    "QUAY_NATIVE_ADR_DIR",
    "QUAY_NATIVE_GOAL_DIR",
    "QUAY_NATIVE_META_DIR",
    "QUAY_NATIVE_DOCS_DIR",
  ];
  const savedCwd = process.cwd();
  const savedEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    process.chdir(cwd);
    for (const k of KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    return fn();
  } finally {
    process.chdir(savedCwd);
    for (const k of KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }
}

after(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

// ── 1. AC2 — the carriers follow the RESOLVED tasks dir, not the cwd's workspace ───────────────

describe("carriers derive from the resolved tasks dir, not from a cwd workspace marker", () => {
  it("returns <tasksParent>/{adr,goals,meta,docs-managed} while cwd sits in ANOTHER workspace", () => {
    const project = mkTmp("carrier-project-");      // the project we belong to (tasks dir only)
    const projectTasks = path.join(project, "tasks");
    fs.mkdirSync(projectTasks, { recursive: true });
    const other = makeWorkspace("carrier-other-");  // a DIFFERENT workspace — what pre-fix code returned
    const otherSub = path.join(other, "nested", "deeper");
    fs.mkdirSync(otherSub, { recursive: true });

    const resolved = withCwdAndEnv(otherSub, { QUAY_NATIVE_TASKS_DIR: projectTasks }, () => {
      assert.equal(
        resolveTasksDir(),
        projectTasks,
        "precondition: the tasks dir comes from the env pin",
      );
      assert.equal(
        findRepoRoot(process.cwd()),
        other,
        "precondition (RED CONTROL): an upward walk from the cwd DOES find the other workspace, so a"
          + " cwd-based resolution has a definite wrong answer available to return",
      );
      return Object.fromEntries(CARRIERS.map(([kind, fn]) => [kind, fn()]));
    });

    // ENUMERATED, not boolean (hard rule 3): assert every carrier, and report the whole set.
    const expected = Object.fromEntries(CARRIERS.map(([kind]) => [kind, path.join(project, kind)]));
    assert.deepEqual(
      resolved,
      expected,
      `all four carriers must be siblings of the resolved tasks dir; got ${JSON.stringify(resolved)}`,
    );
    for (const [kind] of CARRIERS) {
      assert.notEqual(
        resolved[kind],
        path.join(other, kind),
        `${kind} must NOT be the other workspace's dir — that is the pre-fix leak`,
      );
    }
    assert.equal(Object.keys(resolved).length, 4, "all four carriers were resolved (no silent skip)");
  });

  it("resolveWorkspaceBaseDir is the tasks dir's parent", () => {
    const project = mkTmp("carrier-base-");
    const projectTasks = path.join(project, "tasks");
    fs.mkdirSync(projectTasks, { recursive: true });
    const otherSub = path.join(makeWorkspace("carrier-base-other-"), "sub");
    fs.mkdirSync(otherSub, { recursive: true });

    const base = withCwdAndEnv(otherSub, { QUAY_NATIVE_TASKS_DIR: projectTasks }, () =>
      resolveWorkspaceBaseDir(),
    );
    assert.equal(base, project);
  });

  it("keeps the two-isolated-workspaces property when the tasks dir is a nested subdir", () => {
    // A tasks dir that is NOT directly under the workspace root: the carriers stay its siblings,
    // which is the documented invariant (`<parent-of-tasksDir>/<kind>`) — not the workspace root's.
    const project = mkTmp("carrier-nested-");
    const deepTasks = path.join(project, "var", "store", "tasks");
    fs.mkdirSync(deepTasks, { recursive: true });
    const other = makeWorkspace("carrier-nested-other-");

    const resolved = withCwdAndEnv(other, { QUAY_NATIVE_TASKS_DIR: deepTasks }, () => ({
      adr: resolveAdrDir(),
      goals: resolveGoalDir(),
      meta: resolveMetaDir(),
    }));
    assert.deepEqual(resolved, {
      adr: path.join(project, "var", "store", "adr"),
      goals: path.join(project, "var", "store", "goals"),
      meta: path.join(project, "var", "store", "meta"),
    });
  });
});

// ── 2. explicit env override still wins (unchanged contract) ───────────────────────────────────

describe("explicit carrier env pins win over derivation", () => {
  it("returns each pinned dir verbatim", () => {
    const project = mkTmp("carrier-pin-");
    fs.mkdirSync(path.join(project, "tasks"), { recursive: true });
    const pinned = {
      QUAY_NATIVE_ADR_DIR: path.join(project, "custom-adr"),
      QUAY_NATIVE_GOAL_DIR: path.join(project, "custom-goals"),
      QUAY_NATIVE_META_DIR: path.join(project, "custom-meta"),
      QUAY_NATIVE_DOCS_DIR: path.join(project, "custom-docs"),
    };
    const resolved = withCwdAndEnv(
      project,
      { QUAY_NATIVE_TASKS_DIR: path.join(project, "tasks"), ...pinned },
      () => Object.fromEntries(CARRIERS.map(([kind, fn]) => [kind, fn()])),
    );
    assert.deepEqual(resolved, {
      adr: pinned.QUAY_NATIVE_ADR_DIR,
      goals: pinned.QUAY_NATIVE_GOAL_DIR,
      meta: pinned.QUAY_NATIVE_META_DIR,
      "docs-managed": pinned.QUAY_NATIVE_DOCS_DIR,
    });
  });

  it("resolveSiblingDir resolves a RELATIVE pin against the cwd (unchanged contract)", () => {
    const project = mkTmp("carrier-relpin-");
    const resolved = withCwdAndEnv(
      project,
      { QUAY_NATIVE_GOAL_DIR: "./some/goals" },
      () => resolveSiblingDir("QUAY_NATIVE_GOAL_DIR", "goals"),
    );
    assert.equal(resolved, path.join(project, "some", "goals"));
  });
});

// ── 3. the cwd-relative FALLBACK is preserved and stays announced ──────────────────────────────

describe("no env + no workspace marker upward (preserved fail-open fallback)", () => {
  it("lands cwd-relative and says so on stderr (hard rule 3b: not indistinguishable from success)", () => {
    // A tmp dir with NO `.quay/config.yml` on any ancestor. (os.tmpdir() is not inside the repo.)
    const bare = mkTmp("carrier-bare-");
    assert.equal(
      findRepoRoot(bare),
      null,
      "precondition: no workspace marker upward from the bare dir (else this test measures nothing)",
    );

    const stderr = [];
    const original = console.error;
    console.error = (...args) => stderr.push(args.join(" "));
    let resolved;
    try {
      resolved = withCwdAndEnv(bare, {}, () => resolveGoalDir());
    } finally {
      console.error = original;
    }

    assert.equal(resolved, path.join(bare, "goals"), "fallback is cwd-relative, as before");
    const announcement = stderr.join("\n");
    assert.match(
      announcement,
      /QUAY_NATIVE_GOAL_DIR not set and no \.quay\/config\.yml found upward/,
      `the fallback must announce itself; stderr was: ${JSON.stringify(stderr)}`,
    );
    assert.match(announcement, new RegExp(bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("does NOT announce the fallback when the tasks dir came from the env pin", () => {
    const project = mkTmp("carrier-quiet-");
    const projectTasks = path.join(project, "tasks");
    fs.mkdirSync(projectTasks, { recursive: true });

    const stderr = [];
    const original = console.error;
    console.error = (...args) => stderr.push(args.join(" "));
    try {
      withCwdAndEnv(project, { QUAY_NATIVE_TASKS_DIR: projectTasks }, () => resolveGoalDir());
    } finally {
      console.error = original;
    }
    assert.deepEqual(stderr, [], "a correctly-pinned resolution must be silent");
  });
});

// ── 4. isWorkspaceRoot / findRepoRoot keep their contract ──────────────────────────────────────

describe("workspace-marker helpers", () => {
  it("isWorkspaceRoot is true exactly for a dir carrying .quay/config.yml", () => {
    const ws = makeWorkspace("carrier-marker-");
    const bare = mkTmp("carrier-nomarker-");
    assert.equal(isWorkspaceRoot(ws), true);
    assert.equal(isWorkspaceRoot(bare), false);
  });

  it("findRepoRoot walks up to the nearest marker and returns null with none", () => {
    const ws = makeWorkspace("carrier-walk-");
    const deep = path.join(ws, "a", "b", "c");
    fs.mkdirSync(deep, { recursive: true });
    assert.equal(findRepoRoot(deep), ws);
    assert.equal(findRepoRoot(mkTmp("carrier-none-")), null);
  });
});

// ── 5. the REAL seam — the provider MCP server, spawned the way Core spawns it ─────────────────
//
// This is the production path the defect was observed on: Core launches the provider with
// `cwd = <workspaceRoot>/<provider.path>` and `env = resolveProviderEnv(...)`. The test reproduces
// that shape with the cwd sitting inside ANOTHER workspace and only QUAY_NATIVE_TASKS_DIR pinned —
// exactly the config a third-party project installed before the carrier pins existed carried.
//
// It can fail (hard rule 4): the other workspace holds a SENTINEL goal, so a cwd-based resolution
// returns a non-empty list. Post-fix the list must be empty and a write must land in OUR goals dir.

describe("provider MCP server isolates adr/goal/meta from a cwd workspace (AC1)", () => {
  let project;
  let other;
  let client;
  let transport;

  before(async () => {
    project = mkTmp("carrier-e2e-project-");
    const projectTasks = path.join(project, "tasks");
    fs.mkdirSync(projectTasks, { recursive: true });
    fs.mkdirSync(path.join(project, "goals"), { recursive: true });

    // The "other" workspace = what the pre-fix resolution would have bound to. Its sentinel goal
    // is the observable difference: if the fix regresses, goal_list returns it.
    other = makeWorkspace("carrier-e2e-other-");
    fs.mkdirSync(path.join(other, "goals"), { recursive: true });
    fs.writeFileSync(
      path.join(other, "goals", "AC-999.md"),
      [
        "---",
        "id: AC-999",
        "kind: criterion",
        "status: achieved",
        "criterion: SENTINEL — this record lives in the OTHER workspace",
        "expect: never visible to the project under test",
        "origin: test fixture (carrier-dirs isolation)",
        "---",
        "",
        "Sentinel body — present only so the other workspace's goal store is non-empty.",
      ].join("\n"),
      "utf8",
    );

    transport = new StdioClientTransport({
      command: "node",
      args: [binPath, "mcp"],
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: projectTasks },
      cwd: other, // ⚠️ cwd inside a DIFFERENT workspace — the production shape of the defect
    });
    client = new Client({ name: "carrier-dirs-test", version: "0.0.1" });
    await client.connect(transport);
  });

  after(async () => {
    await client.close();
  });

  it("goal_list sees only the project's goals (empty), never the other workspace's sentinel", async () => {
    const res = await client.callTool({ name: "goal_list", arguments: {} });
    const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
    const payload = JSON.parse(text);

    assert.equal(
      res.isError,
      undefined,
      `goal_list must not error; got: ${text.slice(0, 400)}`,
    );
    const records = payload.goals ?? payload.records ?? payload;
    assert.ok(Array.isArray(records), `unexpected goal_list payload shape: ${text.slice(0, 400)}`);
    // ENUMERATE, don't boolean: report the count and any ids so a wrong non-empty answer is legible.
    const ids = records.map((r) => r.id);
    assert.deepEqual(
      ids,
      [],
      `goal_list must be empty for this project; got ${records.length} record(s): ${ids.join(", ")}`,
    );
    assert.ok(
      !text.includes("SENTINEL"),
      "the other workspace's sentinel goal must not be reachable through the provider",
    );
  });

  it("adr_list and meta_list are likewise empty", async () => {
    for (const tool of ["adr_list", "meta_list"]) {
      const res = await client.callTool({ name: tool, arguments: {} });
      const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
      assert.ok(
        !text.includes("SENTINEL") && !text.includes("ADR-001"),
        `${tool} must not expose quay's or the other workspace's records; got: ${text.slice(0, 300)}`,
      );
    }
  });

  it("a goal WRITTEN through the provider lands in the project's goals dir, not the other's", async () => {
    const before = fs.readdirSync(path.join(project, "goals"));
    const otherBefore = fs.readdirSync(path.join(other, "goals"));

    const res = await client.callTool({
      name: "goal_write",
      arguments: {
        id: "AC-901",
        criterion: "carrier isolation write probe",
        expect: "the record lands in the project's own goals dir",
        goal: "GOAL-901",
        origin: "test fixture (carrier-dirs isolation)",
      },
    });
    assert.equal(
      res.isError,
      undefined,
      `goal_write must succeed; got: ${(res.content ?? []).map((c) => c.text).join("")}`,
    );

    const after = fs.readdirSync(path.join(project, "goals"));
    const otherAfter = fs.readdirSync(path.join(other, "goals"));
    assert.ok(
      after.length > before.length,
      `the project's goals dir must gain the record (before=${before.length}, after=${after.length})`,
    );
    assert.deepEqual(
      otherAfter,
      otherBefore,
      "the other workspace's goals dir must be byte-for-byte untouched by our write",
    );
    assert.ok(
      !otherAfter.some((f) => f.includes("901")),
      `the write must not land in the other workspace; it holds: ${otherAfter.join(", ")}`,
    );
  });
});
