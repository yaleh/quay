// @test-group engine
// defect-shape-aggregate.test.mjs — tasks/gap-no-cross-task-defect-shape-aggregation.
//
// PROBLEM UNDER TEST: the loop's input is a SINGLE defect (every family is `gap-*`), and
// architectural debt NEVER appears as one failure — it appears as "N failures sharing one root".
// No mechanism aggregates across tasks, so a root that manifests as N sibling defects stays
// invisible inside any one task's record. This suite proves the aggregator
// (plugin/scripts/defect-shape-aggregate.ts) clusters landed (`status: done`) `gap-*` defects by
// their mechanism VOCABULARY (code identifiers + CLI flags), and:
//
//   AC1  — the CLI runs over a workspace and emits ranked clusters + member ids.
//   AC2  — the cluster signal rediscovers a KNOWN-TRUE sample (the "status-parsing rewrite" and
//          "AC-counter" roots): synthetic defects sharing `readTaskStatusAtRef` /
//          `countAcCheckboxes` land in the same cluster with the right members.
//   AC3  — negative control: tasks that merely touch the SAME FILE (`worker-driver.ts`) for
//          unrelated reasons are NOT merged into a cluster — file overlap is never a cluster
//          binder (reported as sharedFiles context only).
//   AC4  — passive: the aggregator reads tasks/*.md (+ git, read-only) and never writes/triggers.
//   AC5  — the CLI has a real invocation surface (spawnSync smoke) and a named call site.
//
// Run:
//   scripts/test.sh --for-task gap-no-cross-task-defect-shape-aggregation

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import {
  extractMechanismTokens,
  parseTouchedFiles,
  readDoneGapTasks,
  computeDocFreq,
  buildDistinctiveClusters,
  mergeClusters,
  aggregateDefectClusters,
} from "../scripts/defect-shape-aggregate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "plugin/scripts/defect-shape-aggregate.ts");

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

/** Write a synthetic gap-* task file: frontmatter (id, status) + body with optional Touches. */
function writeTask(root, id, { status = "done", body = "", touches = [] } = {}) {
  const tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  const touchesBlock = touches.length ? `## Touches\n${touches.map((t) => `- ${t}`).join("\n")}\n` : "";
  const text = `---\nid: ${id}\ntitle: ${id} title\nstatus: ${status}\nlabels:\n  - gap\n---\n\n${body}\n\n${touchesBlock}`;
  fs.writeFileSync(path.join(tasksDir, `${id}.md`), text);
}

/** A workspace root whose tasks/ dir holds `tasks` (auto-cleaned by the shared tmp helper). */
function makeWorkspace(tag) {
  const root = makeTmpDir(tag);
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  return root;
}

// ── token extraction ───────────────────────────────────────────────────────────────────────────────

test("extractMechanismTokens keeps camelCase/snake/SCREAMING/flags, drops prose + generic APIs", () => {
  const text = "readTaskStatusAtRef was copied; countAcCheckboxes diverges; QUAY_MAIN_CHECKOUT;\n" +
    "the fix is --git-common-dir, via startsWith and readFileSync and a plain word recovering";
  const tokens = extractMechanismTokens(text);
  assert.ok(tokens.includes("readtaskstatusatref"), "camelCase identifier is a mechanism token");
  assert.ok(tokens.includes("countaccheckboxes"), "second camelCase identifier kept");
  assert.ok(tokens.includes("quay_main_checkout"), "SCREAMING_SNAKE kept");
  assert.ok(tokens.includes("--git-common-dir"), "CLI flag kept");
  // generic APIs + prose are NOT mechanism tokens:
  assert.ok(!tokens.includes("startswith"), "generic API startsWith dropped");
  assert.ok(!tokens.includes("readfilesync"), "generic API readFileSync dropped");
  assert.ok(!tokens.includes("recovering"), "bare prose word dropped");
  assert.ok(!tokens.includes("the"), "stopword dropped");
});

test("parseTouchedFiles uses the single touches-parser (annotations/backticks stripped)", () => {
  const raw = "## Touches\n- `plugin/scripts/worker-driver.ts`（自身）\n- plugin/test/x.test.mjs (new)\n- ./plugin/scripts/repo-root.ts\n";
  const files = parseTouchedFiles(raw);
  assert.deepEqual(files, ["plugin/scripts/worker-driver.ts", "plugin/test/x.test.mjs", "plugin/scripts/repo-root.ts"]);
});

// ── clustering primitives ─────────────────────────────────────────────────────────────────────────

test("computeDocFreq + buildDistinctiveClusters bind tasks that share a distinctive token", () => {
  const tasks = [
    { id: "a", status: "done", tokens: ["readtaskstatusatref"], touchedFiles: [], landedAt: 1 },
    { id: "b", status: "done", tokens: ["readtaskstatusatref"], touchedFiles: [], landedAt: 2 },
    { id: "c", status: "done", tokens: ["othertoken"], touchedFiles: [], landedAt: 3 },
  ];
  const df = computeDocFreq(tasks);
  assert.equal(df.get("readtaskstatusatref"), 2);
  const clusters = buildDistinctiveClusters(tasks, df, 8);
  const statusCluster = clusters.find((c) => c.token === "readtaskstatusatref");
  assert.ok(statusCluster, "the shared token produces a cluster");
  assert.deepEqual(statusCluster.members, ["a", "b"]);
  // a token in only ONE task (df=1) is not distinctive → no cluster:
  assert.ok(!clusters.some((c) => c.token === "othertoken"));
});

test("mergeClusters joins near-duplicate token clusters, keeps disjoint roots apart", () => {
  const tokenClusters = [
    { token: "readtaskstatusatref", members: ["a", "b", "c", "d"] },
    { token: "fetchtaskstatusatref", members: ["a", "b", "c", "e"] }, // overlaps 3/5 with the first
    { token: "countaccheckboxes", members: ["x", "y", "z"] },         // disjoint root
  ];
  const merged = mergeClusters(tokenClusters, 0.5);
  // first two merge (Jaccard 3/5), the third stays separate:
  assert.equal(merged.length, 2);
  const big = merged.find((c) => c.tokens.includes("readtaskstatusatref"));
  assert.deepEqual(big.members, ["a", "b", "c", "d", "e"]);
  const small = merged.find((c) => c.tokens.includes("countaccheckboxes"));
  assert.deepEqual(small.members, ["x", "y", "z"]);
});

// ── end-to-end aggregation (AC2 rediscovery + AC3 negative control) ──────────────────────────────

test("AC2: aggregator rediscovers the status-parsing and AC-counter roots (known-true sample)", () => {
  const root = makeWorkspace("defect-agg-ac2-");
  // Cluster 1 — the "status parsing rewrite" root: 4 defects naming the SAME function.
  for (const id of ["gap-status-a", "gap-status-b", "gap-status-c", "gap-status-d"]) {
    writeTask(root, id, { body: `## Proposal\nThe defect is readTaskStatusAtRef duplicated in ${id}.` });
  }
  // Cluster 2 — the "AC counter" root: 3 defects naming countAcCheckboxes.
  for (const id of ["gap-acbox-a", "gap-acbox-b", "gap-acbox-c"]) {
    writeTask(root, id, { body: "## Proposal\nAC checkbox counting via countAcCheckboxes diverged." });
  }

  const clusters = aggregateDefectClusters(root, { maxDf: 8, minClusterSize: 3 });

  const status = clusters.find((c) => c.tokens.includes("readtaskstatusatref"));
  assert.ok(status, "the status-parsing root is rediscovered");
  assert.deepEqual(status.members, ["gap-status-a", "gap-status-b", "gap-status-c", "gap-status-d"]);

  const acbox = clusters.find((c) => c.tokens.includes("countaccheckboxes"));
  assert.ok(acbox, "the AC-counter root is rediscovered");
  assert.deepEqual(acbox.members, ["gap-acbox-a", "gap-acbox-b", "gap-acbox-c"]);
});

test("AC3: file overlap is NOT a cluster binder — tasks touching the same file for unrelated reasons stay apart", () => {
  const root = makeWorkspace("defect-agg-ac3-");
  // 5 defects that ALL touch worker-driver.ts but share NO mechanism token (distinct roots).
  for (let i = 0; i < 5; i++) {
    writeTask(root, `gap-wd-${i}`, {
      body: `## Proposal\nDistinct root signal uniqueToken${i}Number.`,
      touches: ["plugin/scripts/worker-driver.ts", `plugin/scripts/other-${i}.ts`],
    });
  }
  const clusters = aggregateDefectClusters(root, { maxDf: 8, minClusterSize: 2 });

  // No cluster binds on the shared file, and none merges the 5 unrelated defects:
  assert.ok(!clusters.some((c) => c.tokens.includes("worker-driver.ts")), "file path is never a cluster token");
  const big = clusters.filter((c) => c.members.length >= 2);
  assert.equal(big.length, 0, "5 unrelated same-file defects form no cluster");
});

test("readDoneGapTasks reads only status:done gap-* files", () => {
  const root = makeWorkspace("defect-agg-read-");
  writeTask(root, "gap-done-1", { status: "done" });
  writeTask(root, "gap-ready-1", { status: "ready" });
  writeTask(root, "gap-todo-1", { status: "todo" });
  writeTask(root, "not-a-gap-task", { status: "done" });
  const tasks = readDoneGapTasks(root);
  assert.deepEqual(tasks.map((t) => t.id).sort(), ["gap-done-1"]);
});

// ── CLI smoke (AC1/AC5: a real, runnable invocation surface) ─────────────────────────────────────

test("CLI --json emits ranked clusters and reports the passive invariant", () => {
  const root = makeWorkspace("defect-agg-cli-");
  for (const id of ["gap-s1", "gap-s2", "gap-s3"]) {
    writeTask(root, id, { body: `## Proposal\nreadTaskStatusAtRef copied in ${id}.` });
  }
  const r = spawnSync("node", ["--experimental-strip-types", SCRIPT, "--root", root, "--json", "--min-cluster-size", "3"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.meta.shapeAggregateIsPassive, 1, "AC4 passive invariant in meta");
  assert.ok(out.clusters.length >= 1, "at least one cluster");
  assert.ok(out.clusters.some((c) => c.members.length === 3 && c.tokens.includes("readtaskstatusatref")));
});

test("CLI --human prints a human-readable cluster line", () => {
  const root = makeWorkspace("defect-agg-human-");
  for (const id of ["gap-h1", "gap-h2", "gap-h3"]) {
    writeTask(root, id, { body: `## Proposal\ncountAcCheckboxes diverged in ${id}.` });
  }
  const r = spawnSync("node", ["--experimental-strip-types", SCRIPT, "--root", root, "--human", "--min-cluster-size", "3"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /CLUSTER root="countaccheckboxes"/);
});
