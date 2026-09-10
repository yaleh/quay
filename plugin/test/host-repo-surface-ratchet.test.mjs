// @test-group engine
// host-repo-surface-ratchet.test.mjs — gap-host-repo-surface-ratchet (GOAL-015 退出条件④ / AC-236).
//
// Pins the shrink-only ratchet's judgment in all THREE directions (AC3/AC4/AC5) via the PURE
// judgment function (baseline ⊆ current, both directions) + the CLI end-to-end (exit 0 / 1 / 3):
//
//   baseline ⊆ current 必须绿  — checkSubset({...}, {…: same-or-fewer}).ok === true   (新增允许)
//   baseline 多一个元素必须红  — checkSubset(current-without-X, baseline-with-X).ok === false, and
//                                shrunken names the missing element (删除/改名转红 — AC3)
//   NOT-EVALUATED             — enumerateSurface(root-without-the-entry).evaluated === false (AC4)
//   exit 3                    — the CLI exits 3 + stderr carries NOT-EVALUATED when a source is gone
//
// Run:
//   node --test plugin/test/host-repo-surface-ratchet.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

import {
  checkSubset,
  enumerateSurface,
  countsOf,
  writeBaseline,
  readBaseline,
} from "../scripts/host-repo-surface-ratchet.ts";

function makeTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `hrsr-${prefix}-`)); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }

// ── a hermetic fixture carrying the three CONTROLLED surfaces ─────────────────────────────────────

function makeFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hrsr-${prefix}-`));
  fs.mkdirSync(path.join(root, "packages", "quay", "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "quay", "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  writeCli(root, ["init", "task"]);
  writeRoutes(root, ["/", "/tasks", "/dashboard"], "/health");
  fs.writeFileSync(
    path.join(root, "plugin", "scripts", "config-key-consumer-check.ts"),
    `process.stdout.write(JSON.stringify({ entries: [\n  { key: "k1", state: "has-consumer" },\n  { key: "k2", state: "has-consumer" },\n] }) + "\\n");\n`,
  );
  return root;
}

function writeCli(root, verbs) {
  // Write VALID JS (not raw text) that prints the usage lines — the checker runs it via
  // `node --experimental-strip-types`, so the fake must parse as a program.
  const lines = ["Usage:", ...verbs.map((v) => `  quay ${v} [--flag]`)];
  const src = `process.stdout.write(${JSON.stringify(lines.join("\n") + "\n")});\n`;
  fs.writeFileSync(path.join(root, "packages", "quay", "bin", "quay.ts"), src);
}

function writeRoutes(root, handlerRoutes, serveRoute) {
  fs.writeFileSync(
    path.join(root, "packages", "quay", "src", "serve-handlers.ts"),
    handlerRoutes.map((r) => `if (url.pathname === "${r}") {}`).join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(root, "packages", "quay", "src", "serve.ts"),
    `if (url.pathname === "${serveRoute}") {}\n`,
  );
}

function runChecker(root, extraArgs = []) {
  const checker = path.join(REPO_ROOT, "plugin", "scripts", "host-repo-surface-ratchet.ts");
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", checker, "--root", root, ...extraArgs], { encoding: "utf8" });
}

// ── the pure judgment (AC3 negative + AC5 positive directions) ────────────────────────────────────

test("checkSubset ok when baseline ⊆ current on every set", () => {
  const current = { cli_verbs: ["init", "task"], web_routes: ["/", "/tasks"], config_keys_with_consumer: ["k1", "k2"] };
  const baseline = { cli_verbs: ["init"], web_routes: ["/"], config_keys_with_consumer: ["k1"] };
  const v = checkSubset(current, baseline);
  assert.equal(v.ok, true, "baseline ⊆ current must be ok");
  assert.deepEqual(v.shrunken, {}, "no shrink → empty shrunken map");
});

test("AC3 删除必须红 — a baseline element missing from current reddens and names the element", () => {
  const current = { cli_verbs: ["init", "task"], web_routes: ["/", "/tasks"], config_keys_with_consumer: ["k1", "k2"] };
  const baseline = { cli_verbs: ["init", "task"], web_routes: ["/", "/tasks", "/goals"], config_keys_with_consumer: ["k1", "k2"] };
  const v = checkSubset(current, baseline);
  assert.equal(v.ok, false, "a baseline route missing from current must go RED");
  assert.deepEqual(v.shrunken, { web_routes: ["/goals"] }, "the shrunken element must be named (逐字)");
});

test("AC5 新增允许 — an ADDED element (not in baseline) stays green (direction is not inverted)", () => {
  const current = { cli_verbs: ["init", "task", "serve"], web_routes: ["/", "/tasks", "/new"], config_keys_with_consumer: ["k1", "k2", "k3"] };
  const baseline = { cli_verbs: ["init", "task"], web_routes: ["/", "/tasks"], config_keys_with_consumer: ["k1", "k2"] };
  const v = checkSubset(current, baseline);
  assert.equal(v.ok, true, "an added element must stay GREEN (baseline ⊆ current, never the reverse)");
});

test("countsOf reports the three set cardinalities", () => {
  const s = { cli_verbs: ["a", "b"], web_routes: ["/x"], config_keys_with_consumer: ["k"] };
  assert.deepEqual(countsOf(s), { cli_verbs: 2, web_routes: 1, config_keys_with_consumer: 1 });
});

// ── AC4 NOT-EVALUATED (hard rule 3b): 读不懂输入 ≠ 合格 ───────────────────────────────────────────

test("AC4 — enumerateSurface with NO CLI entry ⇒ evaluated:false (NOT-EVALUATED, never a green count)", () => {
  const root = makeTmp("no-entry");
  try {
    fs.mkdirSync(path.join(root, "packages", "quay", "src"), { recursive: true });
    const r = enumerateSurface(root);
    assert.equal(r.evaluated, false, "a root without packages/quay/bin/quay.ts must be NOT-EVALUATED");
  } finally { cleanup(root); }
});

// ── CLI end-to-end (AC3 / AC4 / AC5 as the three exit codes) ──────────────────────────────────────

test("AC3 — the CLI exits 1 and prints the shrunken element verbatim when the surface shrinks", () => {
  const root = makeFixture("shrink");
  try {
    const checker = path.join(REPO_ROOT, "plugin", "scripts", "host-repo-surface-ratchet.ts");
    // Capture the baseline from the green fixture.
    let res = runChecker(root, ["--capture", "--json"]);
    assert.equal(res.status, 0, `--capture must succeed, got ${res.status}: ${res.stdout}${res.stderr}`);

    res = runChecker(root, ["--json"]);
    assert.equal(res.status, 0, `a green fixture must exit 0, got ${res.status}: ${res.stdout}${res.stderr}`);

    // INJECT: remove one route (/tasks) → surface shrank ⇒ exit 1 + the route is named verbatim.
    writeRoutes(root, ["/", "/dashboard"], "/health");
    res = runChecker(root, ["--json"]);
    assert.equal(res.status, 1, `a shrunken surface must exit 1, got ${res.status}: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /\/tasks/, "the removed route must be printed verbatim (逐字)");
    assert.match(res.stdout, /host-repo surface shrank/, "the shrink message must name the violation");

    // RESTORE → green again.
    writeRoutes(root, ["/", "/tasks", "/dashboard"], "/health");
    res = runChecker(root, ["--json"]);
    assert.equal(res.status, 0, `a restored fixture must exit 0, got ${res.status}: ${res.stdout}${res.stderr}`);
  } finally { cleanup(root); }
});

test("AC5 — the CLI stays exit 0 when an element is ADDED beyond the baseline (not inverted)", () => {
  const root = makeFixture("add");
  try {
    let res = runChecker(root, ["--capture", "--json"]);
    assert.equal(res.status, 0);

    // ADD a route (beyond baseline) → still exit 0.
    writeRoutes(root, ["/", "/tasks", "/dashboard", "/brand-new"], "/health");
    res = runChecker(root, ["--json"]);
    assert.equal(res.status, 0, `an added route must stay exit 0, got ${res.status}: ${res.stdout}${res.stderr}`);
  } finally { cleanup(root); }
});

test("AC4 — the CLI exits 3 with NOT-EVALUATED on stderr when a source cannot be read", () => {
  const root = makeFixture("ne");
  try {
    let res = runChecker(root, ["--capture", "--json"]);
    assert.equal(res.status, 0);

    // Break an enumerated source: delete the web-route source file.
    fs.rmSync(path.join(root, "packages", "quay", "src", "serve-handlers.ts"));
    res = runChecker(root, ["--json"]);
    assert.equal(res.status, 3, `NOT-EVALUATED must exit 3, got ${res.status}: ${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /NOT-EVALUATED/, "the NOT-EVALUATED third state must be distinguishable on stderr");
  } finally { cleanup(root); }
});

// ── baseline round-trip ────────────────────────────────────────────────────────────────────────────

test("writeBaseline + readBaseline round-trips the three sets (three non-empty keys)", () => {
  const root = makeTmp("roundtrip");
  try {
    const surface = { cli_verbs: ["init"], web_routes: ["/"], config_keys_with_consumer: ["k1"] };
    writeBaseline(root, surface);
    const read = readBaseline(root);
    assert.deepEqual(read, surface, "baseline must round-trip the three sets");
  } finally { cleanup(root); }
});
