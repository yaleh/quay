// @test-group product
// @load-sensitive child-spawn
//
// characterization-serve-routes — the BEHAVIOUR-EQUIVALENCE baseline for quay serve's HTTP surface,
// taken before the planned handler refactors (serve handler-context typing unification). It records,
// for EVERY GET route the dispatcher registers, the response the server actually produces against a
// fixed workspace, so a refactor that changes a page's rendered bytes reds here even when the route
// still returns 200.
//
// The two load-bearing properties, both required by the task's ACs:
//
//   ① The route set is DERIVED from the dispatcher's real registry — `handleAllRoutes` in
//      packages/quay/src/serve-handlers.ts — never hand-copied here. A hand-copied list drifts the
//      moment a route is added; the derivation makes a new route RED (missing snapshot key) instead
//      of silently un-snapshotted. `deriveGetRoutes()` reads the source text and applies the same
//      two matcher shapes the dispatcher uses (`url.pathname === "…"` literals + `/^\…$/` regex
//      matchers), excluding the POST-only arms.
//   ② The snapshot holds NORMALIZED responses. Volatile fields (the workspace, plugin root, HOME
//      and PATH fixture paths, the bound port, the hostname, timestamps, epochs, git hashes, UUIDs,
//      versions) are replaced by stable markers. "Make it deterministic" is achieved by SEEDING the
//      volatile INPUTS — a hermetic fixture plugin root (`QUAY_PLUGIN_ROOT`, the resolver's own
//      documented hermetic-test seam), a stub `claude` on PATH, an empty HOME and fixed-date git
//      commits — not by deleting whole routes from the baseline.
//
// ⛔ Test-only. No production source is touched by this task.
//
// Run (scoped):
//   scripts/test.sh packages/quay/test/characterization-serve-routes.test.mjs
// Regenerate the snapshot:
//   UPDATE_SNAPSHOT=1 node --test packages/quay/test/characterization-serve-routes.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/serve.ts";
import { createStore } from "../../quay-native/src/store.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, "fixtures", "characterization", "serve-routes.snapshot.json");
const HANDLERS_SRC = path.join(__dirname, "..", "src", "serve-handlers.ts");
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// ── ① route-set derivation (from the dispatcher's OWN registry) ───────────────────────────────────

/**
 * The `if (req.method === "POST") { … }` block's [start, end] character range, brace-counted from the
 * opening `{`. Literals inside it are POST-only and must NOT enter the GET route set.
 *
 * FAIL-CLOSED: returns `null` when the block cannot be found, and the caller refuses to derive a set
 * from an unrecognised dispatcher shape rather than silently inventing a route list (硬规则 3b — an
 * unreadable input must not produce a value that looks like a successful read).
 */
function postBlockRange(src) {
  const m = /if \(req\.method === "POST"\) \{/.exec(src);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return [m.index, i];
    }
  }
  return null;
}

/** `/^\/task\/([^/]+)$/` (the regex literal's source, slashes included) → `/task/:param`. */
function regexSourceToPattern(literal) {
  return literal
    .slice(1, -1) // strip the surrounding /
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\([^)]*\)/g, ":param");
}

/**
 * Derive the dispatcher's GET route set from serve-handlers.ts's own source.
 * Returns the patterns in REGISTRY ORDER (literals in source order, then the regex matchers in
 * source order) — a stable order makes a mismatch diff readable.
 */
export function deriveGetRoutes(src) {
  const post = postBlockRange(src);
  if (post === null) {
    throw new Error(
      "characterization-serve-routes: could not locate handleAllRoutes' `if (req.method === \"POST\")` block — " +
        "the dispatcher shape changed, so the GET route set cannot be derived (refusing to guess)",
    );
  }
  const routes = [];
  const litRe = /url\.pathname === "([^"]+)"/g;
  let m;
  while ((m = litRe.exec(src))) {
    const idx = m.index;
    const lineStart = src.lastIndexOf("\n", idx) + 1;
    const line = src.slice(lineStart, src.indexOf("\n", idx));
    const postOnly = (idx >= post[0] && idx <= post[1]) || /req\.method === "POST"/.test(line);
    if (!postOnly) routes.push({ pattern: m[1], kind: "literal" });
  }
  const rxRe = /(\/\^[^\n]*?\/)\.exec\(url\.pathname\)/g;
  while ((m = rxRe.exec(src))) {
    routes.push({ pattern: regexSourceToPattern(m[1]), kind: "regex" });
  }
  return routes;
}

// ── the concrete URL each derived pattern is probed with ──────────────────────────────────────────
// A registry pattern alone is not fetchable (`:param` is not a path). Every derived pattern MUST have
// an entry here; a missing entry is a hard failure in the snapshot test (never a silent skip), so a
// newly registered route cannot sneak in un-snapshotted.
const SESSION_PROBE_ID = "00000000-0000-0000-0000-000000000000";
const SAMPLE_URLS = new Map([
  ["/", "/"],
  ["/tasks", "/tasks"],
  ["/dashboard", "/dashboard"],
  ["/dashboard/cards", "/dashboard/cards"],
  ["/system", "/system"],
  ["/manager", "/manager"],
  ["/tests", "/tests"],
  ["/tests/file", "/tests/file?path=packages%2Fquay%2Ftest%2Fa.test.mjs"],
  ["/sessions", "/sessions"],
  ["/session/:param", `/session/${SESSION_PROBE_ID}`],
  ["/session/:param/earlier", `/session/${SESSION_PROBE_ID}/earlier?before=0`],
  ["/session/:param/download", `/session/${SESSION_PROBE_ID}/download`],
  ["/architecture", "/architecture"],
  ["/live", "/live"],
  ["/journal", "/journal"],
  ["/git", "/git"],
  ["/git-history", "/git-history"],
  ["/git-history.json", "/git-history.json"],
  ["/board", "/board"],
  ["/needs-human", "/needs-human"],
  ["/adr", "/adr"],
  ["/adr/:param", "/adr/ADR-001"],
  ["/goal", "/goal"],
  ["/goal/:param", "/goal/GOAL-001"],
  ["/doc", "/doc"],
  ["/doc/:param", "/doc/DOC-001"],
  ["/task/:param", "/task/T-1"],
  ["/fan-in-log/:param/:param", "/fan-in-log/T-1/x.log"],
  ["/fan-in-log/:param/:param/download", "/fan-in-log/T-1/x.log/download"],
]);

// ── response normalization ────────────────────────────────────────────────────────────────────────

/** Replace every value that varies between two runs on the same machine, or between machines, with
 *  a stable marker. Order matters: longest/most specific first. */
function normalize(text, ctx) {
  let s = text;
  for (const [value, marker] of [
    [ctx.workspaceRoot, "⟨WS⟩"],
    [ctx.pluginRoot, "⟨PLUGIN⟩"],
    [ctx.home, "⟨HOME⟩"],
    [ctx.binDir, "⟨BIN⟩"],
    [ctx.tmpParent, "⟨TMP⟩"],
    [ctx.workspaceBase, "⟨WSBASE⟩"],
    [ctx.hostname, "⟨HOST⟩"],
  ]) {
    if (value) s = s.split(value).join(marker);
  }
  s = s.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, "⟨TS⟩");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:\.\d+)?Z?\b/g, "⟨TS⟩");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "⟨DATE⟩");
  // Relative-time renders (`relativeTime()` → "0s ago" / "2m ago" / "1h ago" / "3d ago") are a
  // Date.now()-derived value: the elapsed count depends on WHEN the capture runs. A byte-exact
  // baseline that keeps them flakes the moment the fixture-write → render gap crosses a second
  // boundary — measured: green in isolation (135ms capture), red under the full suite's 127-way
  // concurrency (the /task/:param page, captured late, renders "1s ago" not "0s ago"). Normalize
  // the whole family, exactly as the ISO/epoch rules above already do for absolute timestamps.
  s = s.replace(/\b\d+[smhd] ago\b/g, "⟨REL⟩");
  s = s.replace(/\b\d{12,13}\b/g, "⟨EPOCH_MS⟩");
  s = s.replace(/\b\d{9,11}\b/g, "⟨EPOCH_S⟩");
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "⟨UUID⟩");
  s = s.replace(/\b[0-9a-f]{7,40}\b/g, "⟨HEX⟩");
  s = s.replace(/\b\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?\b/g, "⟨VER⟩");
  if (ctx.port) s = s.split(`:${ctx.port}`).join(":⟨PORT⟩");
  return s;
}

// ── hermetic fixture ──────────────────────────────────────────────────────────────────────────────

/** A fixture plugin tree that satisfies the resolver's kernel anchor and answers the two mechanism
 *  scripts /system reads, so /system renders its REAL page shape from FIXED numbers instead of this
 *  host's load average. Omitted scripts (loop-driver-check, task-status-drift-check) resolve to null,
 *  which is itself a deterministic "未接入" reading. */
function writeFixturePluginRoot(root) {
  const plugin = path.join(root, "plugin");
  fs.mkdirSync(path.join(plugin, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(plugin, "scripts", "driver-runtime.ts"),
    'export const KNOWN_KINDS = ["promotion", "worker"];\n' +
      "export function aliveness() { return { supervisorPid: null, driverPid: null, supervisorAlive: false, driverAlive: false, running: false }; }\n" +
      "export function carrierStats() { return { records: 0, lastTs: null }; }\n",
  );
  fs.writeFileSync(
    path.join(plugin, "scripts", "resource-gate.sh"),
    "#!/usr/bin/env bash\n" +
      "echo '{\"cpu_stall_avg10\":1.5,\"cpu_stall_avg300\":2.5,\"mem_avail_mb\":8000,\"loadavg\":4.0,\"nproc\":8,\"node_procs\":3,\"verdict\":\"GO\",\"load_threshold\":16,\"load_over_factor\":2}'\n",
  );
  fs.writeFileSync(
    path.join(plugin, "scripts", "process-budget.sh"),
    "#!/usr/bin/env bash\n" + "echo '{\"total_budget\":64,\"in_use\":5,\"available\":59,\"verdict\":\"GO\"}'\n",
  );
  return plugin;
}

/** A stub `claude` ahead of the real PATH. /sessions shells out to `claude agents --json` (a
 *  MACHINE-WIDE registry); with the stub it is always an empty array, so the page renders the same
 *  empty state on a dev box and on a CI runner that has no `claude` at all. */
function writeFakeClaudeBin(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const claude = path.join(dir, "claude");
  fs.writeFileSync(claude, "#!/usr/bin/env bash\necho '[]'\n");
  fs.chmodSync(claude, 0o755);
  return dir;
}

function seedWorkspaceFiles(ws, tasksDir) {
  const store = createStore(tasksDir);
  store.write("T-1", {
    title: "Characterization task",
    status: "todo",
    labels: ["char"],
    body: "## Proposal\n\nfixture body\n",
  });
  fs.mkdirSync(path.join(ws, "goals"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "goals", "GOAL-001-goal.md"),
    "---\nid: GOAL-001\ntitle: Characterization goal\nstatus: active\norigin: fixture\n---\n\n## Criterion\n\nfixture criterion text long enough to be a real body\n",
  );
  fs.mkdirSync(path.join(ws, "adr"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "adr", "ADR-001-fixture.md"),
    "---\nid: ADR-001\ntitle: Characterization ADR\nstatus: proposed\n---\n\nfixture adr body\n",
  );
  fs.mkdirSync(path.join(ws, "docs-managed"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "docs-managed", "DOC-001-fixture.md"),
    "---\nid: DOC-001\ntitle: Characterization doc\nstatus: active\n---\n\nfixture doc body\n",
  );
}

/** Fixed-date git history: the commit hashes are still normalized (⟨HEX⟩), but the FIXED dates keep
 *  the page's subject/ordering stable instead of run-time dependent. */
function seedGit(ws) {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  fs.writeFileSync(path.join(ws, "README.md"), "characterization fixture\n");
  execFileSync("git", ["init", "-q", "-b", "master"], { cwd: ws, env: gitEnv });
  execFileSync("git", ["add", "-A"], { cwd: ws, env: gitEnv });
  execFileSync("git", ["commit", "-q", "-m", "characterization fixture commit"], { cwd: ws, env: gitEnv });
}

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

/** Build the whole hermetic fixture and start the server on an ephemeral port. */
async function setupFixture() {
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), "quay-char-routes-"));
  const ws = path.join(tmpParent, "workspace");
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  const pluginRoot = writeFixturePluginRoot(path.join(tmpParent, "fixture"));
  const binDir = writeFakeClaudeBin(path.join(tmpParent, "bin"));
  const home = path.join(tmpParent, "home");
  fs.mkdirSync(home, { recursive: true });

  seedWorkspaceFiles(ws, tasksDir);
  seedGit(ws);

  const savedEnv = {
    QUAY_PLUGIN_ROOT: process.env.QUAY_PLUGIN_ROOT,
    HOME: process.env.HOME,
    PATH: process.env.PATH,
  };
  const savedCwd = process.cwd();
  process.env.QUAY_PLUGIN_ROOT = pluginRoot;
  process.env.HOME = home;
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  process.chdir(ws);

  const server = await startServer({ port: 0 });
  return {
    tmpParent,
    ws,
    pluginRoot,
    binDir,
    home,
    server,
    port: server.address().port,
    savedEnv,
    savedCwd,
    ctx: {
      workspaceRoot: ws,
      workspaceBase: path.basename(ws),
      pluginRoot,
      home,
      binDir,
      tmpParent,
      hostname: os.hostname(),
      port: server.address().port,
    },
  };
}

async function teardownFixture(fix) {
  if (!fix) return;
  try {
    fix.server.close();
    if (fix.server.client) await fix.server.client.close();
  } catch {
    /* best-effort teardown */
  }
  process.chdir(fix.savedCwd);
  for (const [k, v] of Object.entries(fix.savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(fix.tmpParent, { recursive: true, force: true });
}

let FIX = null;
before(async () => {
  FIX = await setupFixture();
});
after(async () => {
  await teardownFixture(FIX);
});

/** The derived registry, computed ONCE from the dispatcher source. */
function readDerivedRoutes() {
  return deriveGetRoutes(fs.readFileSync(HANDLERS_SRC, "utf8"));
}

/** Probe every derived route against the live server and return the normalized snapshot. */
async function captureSnapshot() {
  const routes = readDerivedRoutes();
  const out = {};
  for (const { pattern } of routes) {
    const url = SAMPLE_URLS.get(pattern);
    if (url === undefined) {
      assert.fail(
        `route-set: the dispatcher registers ${JSON.stringify(pattern)} but this test has no sample URL for it — ` +
          `add it to SAMPLE_URLS (and re-run with UPDATE_SNAPSHOT=1) so the new route is characterized`,
      );
    }
    const res = await httpGet(FIX.port, url);
    out[pattern] = {
      status: res.status,
      contentType: normalize(res.headers["content-type"] ?? "", FIX.ctx),
      location: normalize(res.headers.location ?? "", FIX.ctx),
      body: normalize(res.body, FIX.ctx),
    };
  }
  return { routes: out };
}

function readSnapshot() {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
}

// ── the assertions ────────────────────────────────────────────────────────────────────────────────

test("route-set: the dispatcher-derived GET routes and the snapshot keys are the same set (missing either way is red)", () => {
  // The `route-set` name is the AC's grep anchor — keep it on this test.
  const derived = readDerivedRoutes().map((r) => r.pattern);
  assert.ok(derived.length >= 20, `the derivation must actually find the dispatcher's routes (found ${derived.length})`);
  const snapshot = readSnapshot();
  const snapshotKeys = Object.keys(snapshot.routes);

  const missingFromSnapshot = derived.filter((p) => !snapshotKeys.includes(p));
  const staleInSnapshot = snapshotKeys.filter((p) => !derived.includes(p));

  assert.deepEqual(
    missingFromSnapshot,
    [],
    `route-set: every GET route registered in packages/quay/src/serve-handlers.ts must be snapshotted; missing: ${JSON.stringify(missingFromSnapshot)}`,
  );
  assert.deepEqual(
    staleInSnapshot,
    [],
    `route-set: the snapshot carries routes the dispatcher no longer registers; remove them: ${JSON.stringify(staleInSnapshot)}`,
  );
  assert.deepEqual(snapshotKeys, derived, "route-set: the snapshot key set equals the derived GET route set, item by item");
});

test("route snapshot: every GET route's normalized response matches the checked-in baseline", async () => {
  const actual = await captureSnapshot();
  if (process.env.UPDATE_SNAPSHOT === "1") {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    console.log(`[characterization] snapshot regenerated: ${SNAPSHOT_PATH}`);
    return;
  }
  const expected = readSnapshot();
  const mismatches = [];
  for (const [pattern, want] of Object.entries(expected.routes)) {
    const got = actual.routes[pattern];
    if (got === undefined) {
      mismatches.push(`${pattern}: not captured`);
      continue;
    }
    if (got.status !== want.status) mismatches.push(`${pattern}: status ${got.status} != ${want.status}`);
    if (got.contentType !== want.contentType) mismatches.push(`${pattern}: content-type ${got.contentType} != ${want.contentType}`);
    if (got.location !== want.location) mismatches.push(`${pattern}: location ${got.location} != ${want.location}`);
    if (got.body !== want.body) {
      const at = firstDifference(got.body, want.body);
      mismatches.push(
        `${pattern}: body differs at char ${at}\n    expected: ${JSON.stringify(want.body.slice(Math.max(0, at - 60), at + 120))}\n    actual:   ${JSON.stringify(got.body.slice(Math.max(0, at - 60), at + 120))}`,
      );
    }
  }
  assert.deepEqual(
    mismatches,
    [],
    `route snapshot: ${mismatches.length} route(s) changed vs the baseline — a rendering change, or a genuine refactor that needs UPDATE_SNAPSHOT=1:\n  ${mismatches.join("\n  ")}`,
  );
});

test("route snapshot: the baseline is non-trivial (every route carries a body and a status)", () => {
  const snapshot = readSnapshot();
  for (const [pattern, entry] of Object.entries(snapshot.routes)) {
    assert.ok(typeof entry.status === "number", `${pattern}: the snapshot records an HTTP status`);
    assert.ok(typeof entry.body === "string", `${pattern}: the snapshot records a body`);
  }
  const htmlRoutes = Object.values(snapshot.routes).filter((e) => e.contentType.includes("text/html"));
  assert.ok(htmlRoutes.length >= 15, `the baseline covers the rendered HTML pages (found ${htmlRoutes.length})`);
  // No machine-specific value may survive normalization into the checked-in file.
  const raw = fs.readFileSync(SNAPSHOT_PATH, "utf8");
  for (const leak of [os.hostname(), FIX.tmpParent, FIX.pluginRoot, FIX.home, `:${FIX.port}`]) {
    assert.ok(!raw.includes(leak), `the snapshot must not embed the machine-specific value ${JSON.stringify(leak)}`);
  }
});

/** Index of the first differing character (or the shorter length when one is a prefix). */
function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return n;
}
