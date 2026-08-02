// @test-group engine
// Unit tests for human-steered-classify.ts — DIR-062 child A (M125).
// Run: node --test experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs
//      node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/human-steered-classify.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { touchesDriverFile, classify, selftest } from "../scripts/human-steered-classify.ts";

const SCRIPT = fileURLToPath(new URL("../scripts/human-steered-classify.ts", import.meta.url));
// DIR-120-B: the CLI's runtime DEFAULT_REGISTRY_PATH fallback was removed — --workspace now
// requires an explicit --registry, so any test exercising that path passes one explicitly.
const REAL_REGISTRY_PATH = fileURLToPath(new URL("../drivable-workspaces.yml", import.meta.url));

// ── touchesDriverFile ────────────────────────────────────────────────────────────────────────────
test("touchesDriverFile: OUTER-LOOP.md (nested path) -> true", () => {
  assert.equal(touchesDriverFile("experiments/quay-perpetual-stream/OUTER-LOOP.md"), true);
});
test("touchesDriverFile: inherited-core.md (bare basename) -> true", () => {
  assert.equal(touchesDriverFile("inherited-core.md"), true);
});
test("touchesDriverFile: a file under .claude/skills/ (nested) -> true", () => {
  assert.equal(touchesDriverFile("some/prefix/.claude/skills/quay-directive/SKILL.md"), true);
});
test("touchesDriverFile: a file under .claude/skills/ (repo-root-relative, no leading prefix) -> true", () => {
  assert.equal(touchesDriverFile(".claude/skills/quay-directive/SKILL.md"), true);
});
test("touchesDriverFile: an ordinary product file -> false", () => {
  assert.equal(touchesDriverFile("packages/quay/src/gate/registry.ts"), false);
});
test("touchesDriverFile: a similarly-named-but-different file -> false", () => {
  assert.equal(touchesDriverFile("experiments/quay-perpetual-stream/OUTER-LOOP-notes-draft.md"), false);
});
test("touchesDriverFile: empty/null/undefined -> false", () => {
  assert.equal(touchesDriverFile(""), false);
  assert.equal(touchesDriverFile(null), false);
  assert.equal(touchesDriverFile(undefined), false);
});

// ── classify ─────────────────────────────────────────────────────────────────────────────────────
const REGISTRY = { authorizedRoot: "/home/yale/work", workspacePaths: [] };

test("classify: driver-file edit alone -> humanSteered:true", () => {
  const r = classify({ touchedFiles: ["OUTER-LOOP.md"], registry: REGISTRY });
  assert.equal(r.humanSteered, true);
  assert.equal(r.clauses.driverFileEdit, true);
  assert.equal(r.clauses.missionRedirection, false);
  assert.equal(r.clauses.unauthorizedWorkspace, false);
});

test("classify: mission-redirection alone -> humanSteered:true", () => {
  const r = classify({ missionRedirection: true, registry: REGISTRY });
  assert.equal(r.humanSteered, true);
  assert.equal(r.clauses.missionRedirection, true);
});

test("classify: unauthorized workspace alone -> humanSteered:true, lists it", () => {
  const r = classify({ drivenWorkspaces: ["/opt/elsewhere"], registry: REGISTRY });
  assert.equal(r.humanSteered, true);
  assert.equal(r.clauses.unauthorizedWorkspace, true);
  assert.deepEqual(r.unauthorizedWorkspaces, ["/opt/elsewhere"]);
});

test("classify: clean milestone (product file, authorized workspaces, no redirection) -> false", () => {
  const r = classify({
    touchedFiles: ["packages/quay/src/gate/registry.ts"],
    drivenWorkspaces: ["/home/yale/work/quay"],
    registry: REGISTRY,
  });
  assert.equal(r.humanSteered, false);
});

test("classify: no fields at all -> humanSteered:false (vacuous)", () => {
  const r = classify({});
  assert.equal(r.humanSteered, false);
});

test("classify: no registry provided -> falls back to an empty registry (fail-closed: any driven workspace is unauthorized)", () => {
  const r = classify({ drivenWorkspaces: ["/home/yale/work/quay"] });
  assert.equal(r.humanSteered, true);
  assert.equal(r.clauses.unauthorizedWorkspace, true);
});

test("classify: multiple clauses fire simultaneously -> all reported true", () => {
  const r = classify({
    touchedFiles: ["OUTER-LOOP.md"],
    missionRedirection: true,
    drivenWorkspaces: ["/opt/elsewhere"],
    registry: REGISTRY,
  });
  assert.equal(r.humanSteered, true);
  assert.equal(r.clauses.driverFileEdit, true);
  assert.equal(r.clauses.missionRedirection, true);
  assert.equal(r.clauses.unauthorizedWorkspace, true);
});

// ── selftest() — the module's own embedded RED+GREEN fixture suite ─────────────────────────────────
test("selftest(): all embedded RED+GREEN fixture cases pass", () => {
  assert.equal(selftest(), true);
});

// ── CLI (isDirect block) — real subprocess invocation ───────────────────────────────────────────
function spawnCli(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

test("CLI: --selftest -> exit 0", () => {
  const r = spawnCli(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
});

test("CLI: --touched OUTER-LOOP.md -> prints humanSteered:true JSON, exit 0", () => {
  const r = spawnCli(["--touched", "OUTER-LOOP.md"]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.humanSteered, true);
  assert.equal(parsed.clauses.driverFileEdit, true);
});

test("CLI: --mission-redirection -> prints humanSteered:true JSON", () => {
  const r = spawnCli(["--mission-redirection"]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.humanSteered, true);
  assert.equal(parsed.clauses.missionRedirection, true);
});

test("CLI: --workspace against the real registry (authorized, explicit --registry) -> humanSteered:false", () => {
  const r = spawnCli(["--workspace", "/home/yale/work/quay", "--registry", REAL_REGISTRY_PATH]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.humanSteered, false);
});

test("CLI: --workspace against the real registry (unauthorized, explicit --registry) -> humanSteered:true", () => {
  const r = spawnCli(["--workspace", "/tmp/somewhere-not-registered", "--registry", REAL_REGISTRY_PATH]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.humanSteered, true);
  assert.equal(parsed.clauses.unauthorizedWorkspace, true);
});

test("CLI: --workspace given but --registry omitted -> usage error exit 2 (DIR-120-B: no more guessed default)", () => {
  const r = spawnCli(["--workspace", "/home/yale/work/quay"]);
  assert.equal(r.status, 2);
});

test("CLI: multiple --touched flags accumulate", () => {
  const r = spawnCli(["--touched", "packages/quay/src/foo.ts", "--touched", "OUTER-LOOP.md"]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.humanSteered, true);
});

test("CLI: no args at all -> usage error exit 2", () => {
  const r = spawnCli([]);
  assert.equal(r.status, 2);
});

test("CLI: unknown flag -> usage error exit 2", () => {
  const r = spawnCli(["--bogus-flag"]);
  assert.equal(r.status, 2);
});
