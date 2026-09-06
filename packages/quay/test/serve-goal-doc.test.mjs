// @test-group product
// Stage — /goal + /doc web views (SPEC §4: the third sibling kind's route, done together with
// /doc which previously had NO route, both following the /adr shape). The goal page's most
// valuable column is the most recent verdict + time, read from the record's `evidence` field
// (which the goal gate runner updates after every criterion execution).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

let server, port, originalCwd, workspaceRoot;

before(async () => {
  const tasksDir = makeTmpDir("goal-serve-tasks-");
  const adrDir = makeTmpDir("goal-serve-adr-");
  workspaceRoot = makeTmpDir("goal-serve-ws-");
  // The goal store lives at <workspaceRoot>/goals; the document store at <workspaceRoot>/docs-managed.
  const goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "docs-managed"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "goals", "GOAL-001-three-layer.md"),
    "---\nid: GOAL-001\ntitle: three-layer unification\nstatus: active\nkind: goal\norigin: 2026-08-09 human goal setting\n---\n## Goal\none target statement\n");
  fs.writeFileSync(path.join(workspaceRoot, "goals", "AC-028-experience-flows.md"),
    "---\nid: AC-028\ntitle: experience flows between layers\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: git rev-list --count integration..develop\nexpect: \"=0\"\norigin: 2026-08-09 measured criterion\nevidence:\n  at: 2026-08-09T07:40:08Z\n  verdict: pass\n  reading: \"0\"\n---\n## Rationale\nmeasured\n");
  fs.writeFileSync(path.join(workspaceRoot, "docs-managed", "DOC-001-quay-directive-skill.md"),
    "---\nid: DOC-001\ntitle: quay-directive skill\nstatus: active\nkind: skill\n---\n## Body\nthe directive skill\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

test("AC5 — GET /goal lists phase + criterion records with origin and recent verdict", async () => {
  const r = await get(port, "/goal");
  assert.equal(r.status, 200);
  assert.match(r.body, /GOAL-001/);
  assert.match(r.body, /AC-028/);
  assert.match(r.body, /three-layer unification/);
  assert.match(r.body, /experience flows/);
  assert.match(r.body, /origin/);
  // The most valuable column: recent verdict + time (from the record's evidence).
  assert.match(r.body, /pass/);
  assert.match(r.body, /2026-08-09T07:40:08Z/);
});

test("AC5 — GET /goal/AC-028 renders the detail page with criterion and verdict", async () => {
  const r = await get(port, "/goal/AC-028");
  assert.equal(r.status, 200);
  assert.match(r.body, /criterion/);
  assert.match(r.body, /git rev-list/);
  assert.match(r.body, /pass/);
  assert.match(r.body, /2026-08-09T07:40:08Z/);
});

test("AC5 — GET /goal/GOAL-001 renders a goal (no criterion cell) with origin", async () => {
  const r = await get(port, "/goal/GOAL-001");
  assert.equal(r.status, 200);
  assert.match(r.body, /three-layer unification/);
  assert.match(r.body, /origin/);
});

test("AC5 — GET /goal/nope → 404", async () => {
  assert.equal((await get(port, "/goal/AC-999")).status, 404);
});

test("AC5 — /doc route exists (previously no route: grep -c document = 0) and lists DOC-001", async () => {
  const r = await get(port, "/doc");
  assert.equal(r.status, 200);
  assert.match(r.body, /DOC-001/);
  assert.match(r.body, /quay-directive skill/);
});

test("AC5 — GET /doc/DOC-001 renders the document body", async () => {
  const r = await get(port, "/doc/DOC-001");
  assert.equal(r.status, 200);
  assert.match(r.body, /the directive skill/);
});

test("the task list (/tasks) nav links to goals and docs", async () => {
  const r = await get(port, "/tasks");
  assert.equal(r.status, 200);
  assert.match(r.body, /\/goal/);
  assert.match(r.body, /\/doc/);
});

test("AC98 — a filter with no matching goals renders the prose-source pointer, not 'No goals.'", async () => {
  const r = await get(port, "/goal?status=superseded"); // no superseded records
  assert.equal(r.status, 200);
  // AC98: the zero-record view must point at the two prose sources and never say "No goals."
  assert.match(r.body, /orchestration\/manager-phase-goal\.md/);
  assert.match(r.body, /orchestration\/outer-phase-goal\.md/);
  assert.doesNotMatch(r.body, /No goals/);
});
