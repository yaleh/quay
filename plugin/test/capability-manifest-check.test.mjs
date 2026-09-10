// @test-group engine
// capability-manifest-check.test.mjs — 双向 capability↔delivery-manifest 枚举检查器测试
// (tasks/gap-delivery-manifest-capability-map).
//
// Pins:
//   (a) pure logic — enumerateCliCommands (dispatch 解析) / diffKind (unregistered + stale 双向);
//   (b) the REAL manifest is GREEN — every source capability (driver kind / CLI 顶层命令 /
//       MCP server) is registered and nothing registered is stale (exit 0);
//   (c) the NEGATIVE CONTROL (反例判据, 硬规则推论三) — 源码有而 manifest 未登记 ⇒ RED (exit 1);
//       manifest 登记但源码已无 ⇒ RED (exit 1); 读不到 manifest ⇒ NOT-EVALUATED (exit 2),
//       绝不与「合格」同形 (硬规则 3b). A checker that never goes red on a missing-registration
//       sample is indistinguishable from one that always passes.
//
// Run:
//   scripts/test.sh plugin/test/capability-manifest-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  enumerateDriverKinds,
  enumerateCliCommands,
  enumerateMcpServers,
  diffKind,
  check,
  SUPPORTED_KINDS,
} from "../scripts/capability-manifest-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "capability-manifest-check.ts");
const REAL_MANIFEST = path.join(repoRoot, "delivery-manifest.json");

const REAL_DRIVER_KINDS = ["promotion", "worker", "outer", "quality", "meta", "goal"];

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("SUPPORTED_KINDS covers the three task-mandated categories", () => {
  assert.deepEqual([...SUPPORTED_KINDS], ["driver-kind", "cli-command", "mcp-server"]);
});

test("enumerateCliCommands — extracts the top-level verbs from the dispatch skeleton (position, not keyword)", () => {
  const src = `
    if (cmd === "adr") return a;
    if (cmd === "task" && sub === "list") return b;
    if (cmd === "task" && sub === "view") return c;
    if (cmd === "gate") return d;
    if (cmd === "gate-log") return e;
    if (cmd === "driver") return f;
  `;
  const set = enumerateCliCommands(src);
  assert.ok(set, "must enumerate (null only when zero routing lines)");
  assert.deepEqual([...set].sort(), ["adr", "driver", "gate", "gate-log", "task"]);
});

test("enumerateCliCommands — returns null on a structurally-changed dispatch (NOT-EVALUATED, never 0 verbs)", () => {
  assert.equal(enumerateCliCommands("const x = 1;\n"), null);
});

test("diffKind — reports unregistered (source−manifest) and stale (manifest−source) in both directions", () => {
  const d = diffKind("driver-kind", new Set(["a", "b", "c"]), new Set(["c", "d"]));
  assert.deepEqual(d.unregistered, ["a", "b"]);
  assert.deepEqual(d.stale, ["d"]);
});

// ── source enumeration against the REAL repo ───────────────────────────────────────────────────────

test("enumerateDriverKinds — reads the real DRIVER_KINDS table (6 kinds)", () => {
  const set = enumerateDriverKinds();
  for (const k of REAL_DRIVER_KINDS) assert.ok(set.has(k), `missing driver kind: ${k}`);
  assert.equal(set.size, REAL_DRIVER_KINDS.length);
});

test("enumerateMcpServers — finds every packages/*/src/mcp-server.ts (quay + quay-native + quay-github + quay-backlog)", () => {
  const set = enumerateMcpServers(repoRoot);
  assert.ok(set, "must enumerate");
  for (const s of ["quay", "quay-native", "quay-github", "quay-backlog"]) {
    assert.ok(set.has(s), `missing mcp server: ${s}`);
  }
});

// ── real manifest is GREEN ──────────────────────────────────────────────────────────────────────────

test("check — the real delivery-manifest.json is consistent in both directions (exit 0)", () => {
  const res = check(repoRoot);
  assert.equal(res.evaluated, true);
  assert.equal(res.ok, true, res.reason);
  assert.deepEqual(res.structural, []);
  for (const d of res.diffs) {
    assert.deepEqual(d.unregistered, [], `${d.kind} has unregistered capabilities`);
    assert.deepEqual(d.stale, [], `${d.kind} has stale registrations`);
  }
});

test("CLI — real manifest exits 0 (PASS)", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ── negative control (反例判据 — the checker MUST go red, not self-assert PASS) ──────────────────────

function writeMutatedManifest(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-manifest-"));
  const src = JSON.parse(fs.readFileSync(REAL_MANIFEST, "utf8"));
  mutate(src);
  const p = path.join(dir, "delivery-manifest.json");
  fs.writeFileSync(p, JSON.stringify(src, null, 2));
  return { dir, p };
}

test("check — a source capability NOT registered (AC-202 class: unregistered driver kind) ⇒ RED", () => {
  const { dir, p } = writeMutatedManifest((m) => {
    m.capabilities = m.capabilities.filter((c) => !(c.kind === "driver-kind" && c.name === "goal"));
  });
  try {
    const res = check(repoRoot, { manifestPath: p });
    assert.equal(res.evaluated, true);
    assert.equal(res.ok, false);
    const driver = res.diffs.find((d) => d.kind === "driver-kind");
    assert.deepEqual(driver.unregistered, ["goal"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("check — a manifest entry whose source is gone (stale registration) ⇒ RED", () => {
  const { dir, p } = writeMutatedManifest((m) => {
    m.capabilities.push({ name: "nonexistent", kind: "driver-kind", sourceRef: "x" });
  });
  try {
    const res = check(repoRoot, { manifestPath: p });
    assert.equal(res.evaluated, true);
    assert.equal(res.ok, false);
    const driver = res.diffs.find((d) => d.kind === "driver-kind");
    assert.deepEqual(driver.stale, ["nonexistent"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI — unregistered capability exits 1 (RED), stale exits 1 (RED)", () => {
  const { dir, p } = writeMutatedManifest((m) => {
    m.capabilities = m.capabilities.filter((c) => !(c.kind === "driver-kind" && c.name === "goal"));
    m.capabilities.push({ name: "nonexistent", kind: "driver-kind", sourceRef: "x" });
  });
  try {
    const r = spawnSync(
      "node",
      ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot, "--manifest", p],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /UNREGISTERED: goal/);
    assert.match(r.stdout, /STALE: nonexistent/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("check — missing/unparseable manifest ⇒ NOT-EVALUATED (evaluated=false, exit 2), never PASS", () => {
  const res = check(repoRoot, { manifestPath: path.join(repoRoot, "no-such-manifest.json") });
  assert.equal(res.evaluated, false);
  assert.equal(res.ok, false);
  // CLI exit 2 on a missing manifest.
  const r = spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot, "--manifest", path.join(repoRoot, "no-such-manifest.json")],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test("check — an entry missing sourceRef is a structural defect ⇒ RED (AC1 每条都有 sourceRef)", () => {
  const { dir, p } = writeMutatedManifest((m) => {
    m.capabilities.push({ name: "nosrc", kind: "cli-command" });
  });
  try {
    const res = check(repoRoot, { manifestPath: p });
    assert.equal(res.evaluated, true);
    assert.equal(res.ok, false);
    assert.ok(res.structural.some((s) => s.includes("sourceRef")), JSON.stringify(res.structural));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
