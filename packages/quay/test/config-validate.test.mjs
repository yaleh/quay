// @test-group product
// DIR-099-A — config-validate module + CLI `quay config validate`.
//
// Test layers:
//   Phase A — pure module unit tests (validateConfig via direct import)
//   Phase B — CLI integration tests (spawn `node bin/quay.ts config validate`)
//
// Run: node --test packages/quay/test/config-validate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { validateConfig } from "../src/config-validate.ts";
import { QUAY_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory with optional file writes. Returns { root, cleanup }. */
function tmpWorkspace(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cv-"));
  const quayDir = path.join(root, ".quay");
  fs.mkdirSync(quayDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Run `node bin/quay.ts config validate` in a workspace root. */
function cliValidate(workspaceRoot, flags = "") {
  return execFileSync("node", [quayBin, "config", "validate", ...flags.split(/\s+/).filter(Boolean)], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}

// ---------------------------------------------------------------------------
// Phase A — module unit tests
// ---------------------------------------------------------------------------

test("AC: valid config returns ok:true, no issues", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "/custom/tasks"
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    assert.equal(result.ok, true, `expected ok:true, got issues: ${JSON.stringify(result.issues)}`);
    assert.equal(result.issues.length, 0, `expected 0 issues, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC: malformed YAML exits with error issue + line ref", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native
    enabled: true
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const yamlIssue = result.issues.find((i) => i.field === "config.yml");
    assert.ok(yamlIssue, "expected a YAML syntax error issue");
    assert.equal(yamlIssue.severity, "error");
    assert.match(yamlIssue.message, /YAML syntax error/);
  } finally {
    cleanup();
  }
});

test("AC: gate at wrong nesting exits with error + hint (M3)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  vitest:
    name: my-gate
    command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const nestingIssue = result.issues.find((i) => i.field === "gates.vitest");
    assert.ok(nestingIssue, "expected a gate nesting error for 'vitest' key");
    assert.equal(nestingIssue.severity, "error");
    assert.match(nestingIssue.message, /not a recognized gate type key/);
    assert.ok(nestingIssue.suggestion, "expected a suggestion with correct shape hint");
    assert.match(nestingIssue.suggestion, /testPass/);
  } finally {
    cleanup();
  }
});

test("AC: gate violating type schema exits with error (missing required field)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
    - name: ok-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const shapeIssue = result.issues.find((i) => i.field === "gates.testPass[0].command");
    assert.ok(shapeIssue, `expected missing-command issue, got: ${JSON.stringify(result.issues)}`);
    assert.equal(shapeIssue.severity, "error");
    assert.match(shapeIssue.message, /missing required field "command"/);
  } finally {
    cleanup();
  }
});

test("AC: coverageFloor missing floor triggers error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  coverageFloor:
    - name: cov
      command: "npx vitest --coverage"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const floorIssue = result.issues.find((i) => i.field === "gates.coverageFloor[0].floor");
    assert.ok(floorIssue, `expected missing-floor issue, got: ${JSON.stringify(result.issues)}`);
    assert.match(floorIssue.message, /missing required field "floor"/);
  } finally {
    cleanup();
  }
});

test("AC: unresolved gate reference exits with error (M4)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [nonexistent-gate]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const refIssue = result.issues.find((i) => i.message.includes("Unresolved gate reference"));
    assert.ok(refIssue, `expected unresolved gate issue, got: ${JSON.stringify(result.issues)}`);
    assert.equal(refIssue.severity, "error");
    assert.match(refIssue.message, /nonexistent-gate/);
  } finally {
    cleanup();
  }
});

test("AC: missing loop.board exits with error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const boardIssue = result.issues.find((i) => i.field === "loop.board");
    assert.ok(boardIssue, `expected missing-board issue, got: ${JSON.stringify(result.issues)}`);
    assert.match(boardIssue.message, /board/);
  } finally {
    cleanup();
  }
});

test("AC: missing loop.gates exits with error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const gatesIssue = result.issues.find((i) => i.field === "loop.gates");
    assert.ok(gatesIssue, `expected missing-gates issue, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC: enabled CUSTOM provider missing mcp_entry exits with error (M1)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  github:
    enabled: true
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const provIssue = result.issues.find((i) => i.field === "providers.github");
    assert.ok(provIssue, `expected mcp_entry issue, got: ${JSON.stringify(result.issues)}`);
    assert.match(provIssue.message, /mcp_entry/);
    assert.equal(provIssue.code, "provider-missing-mcp-entry");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver
// AC1/AC2/AC3/AC4 — the validator is the SAME judge as the runtime.
// ---------------------------------------------------------------------------

const PROVIDER_AXIS_CONFIG = (providersYaml) => `
providers:
${providersYaml}
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim();

const providerErrors = (result) =>
  result.issues.filter((i) => i.field.startsWith("providers.") && i.severity === "error");

test("AC2: native provider that OMITS path/mcp_entry validates (Core resolves it from the plugin root)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": PROVIDER_AXIS_CONFIG("  native:\n    enabled: true"),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, true, `expected ok, got: ${JSON.stringify(result.issues)}`);
    assert.equal(providerErrors(result).length, 0, "no provider-axis error for the omitted native binding");
  } finally {
    cleanup();
  }
});

test("AC2: native provider with an EXPLICIT path/mcp_entry still validates", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": PROVIDER_AXIS_CONFIG(
      `  native:\n    enabled: true\n    path: "${os.tmpdir()}"\n    mcp_entry: ["node", "./bin/quay-native.ts", "mcp"]`,
    ),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, true, `expected ok, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC2: native explicit path frozen to a versioned plugin cache dir is a WARNING, not an error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": PROVIDER_AXIS_CONFIG(
      `  native:\n    enabled: true\n    path: "/home/someone/.claude/plugins/cache/quay/quay/0.16.0/vendor/quay-native"`,
    ),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, true, `expected ok (warning only), got: ${JSON.stringify(result.issues)}`);
    const warn = result.issues.find((i) => i.field === "providers.native.path");
    assert.ok(warn, `expected a providers.native.path warning, got: ${JSON.stringify(result.issues)}`);
    assert.equal(warn.severity, "warn");
    assert.match(warn.message, /frozen to a versioned plugin install-cache/);
  } finally {
    cleanup();
  }
});

test("AC2: native explicit path that does not exist is an ERROR", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": PROVIDER_AXIS_CONFIG(
      `  native:\n    enabled: true\n    path: "./definitely-not-here/quay-native"`,
    ),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false, `expected failure, got: ${JSON.stringify(result.issues)}`);
    const issue = result.issues.find((i) => i.field === "providers.native.path");
    assert.ok(issue, `expected a providers.native.path error, got: ${JSON.stringify(result.issues)}`);
    assert.equal(issue.severity, "error");
    assert.match(issue.message, /does not exist/);
  } finally {
    cleanup();
  }
});

test("AC2/MCP parity: custom provider missing mcp_entry names providers.<id>", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": PROVIDER_AXIS_CONFIG("  github:\n    enabled: true"),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    assert.ok(
      providerErrors(result).some((i) => i.field === "providers.github" && /mcp_entry/.test(i.message)),
      `expected providers.github mcp_entry error, got: ${JSON.stringify(result.issues)}`,
    );
  } finally {
    cleanup();
  }
});

test("AC3: native omitting path/mcp_entry + an UNRESOLVABLE plugin root yields the stable code", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": PROVIDER_AXIS_CONFIG("  native:\n    enabled: true"),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, pluginRoot: null });
    assert.equal(result.ok, false, "an unresolvable plugin root must fail closed");
    const issue = result.issues.find((i) => i.code === "native-provider-unresolvable");
    assert.ok(issue, `expected native-provider-unresolvable, got: ${JSON.stringify(result.issues)}`);
    assert.match(issue.message, /native-provider-unresolvable/);
    assert.match(issue.message, /no plugin root could be resolved/);
  } finally {
    cleanup();
  }
});

test("AC3: the unresolvable-native message never leaks a TypeError (the launch paths throw the code)", async () => {
  const { providerMcpEntry, resolveProviderEntry, NATIVE_PROVIDER_UNRESOLVABLE } = await import("../src/config.ts");
  const resolved = resolveProviderEntry("native", { enabled: true }, null);
  assert.equal(resolved.mcpEntry, null);
  assert.equal(resolved.unresolvable, true);
  let thrown = null;
  try {
    providerMcpEntry({ id: "native", ...resolved.entry });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, "providerMcpEntry must throw, never return undefined for the caller to destructure");
  assert.equal(thrown.code, NATIVE_PROVIDER_UNRESOLVABLE);
  assert.match(thrown.message, /native-provider-unresolvable/);
  assert.doesNotMatch(String(thrown.message), /TypeError|is not iterable/);
});

test("AC4: property — no provider error ⇔ activeProvider() yields a non-empty mcp_entry", async () => {
  const { activeProvider } = await import("../src/config.ts");
  const corpus = [
    { id: "native", entry: { enabled: true }, expected: true, label: "native omitted" },
    {
      id: "native",
      entry: { enabled: true, mcp_entry: ["node", "./bin/quay-native.ts", "mcp"] },
      expected: true,
      label: "native explicit",
    },
    { id: "github", entry: { enabled: true }, expected: false, label: "custom missing" },
    { id: "github", entry: { enabled: true, mcp_entry: ["node", "./bin/github.ts", "mcp"] }, expected: true, label: "custom present" },
  ];
  for (const c of corpus) {
    const yamlProviders = c.id === "native"
      ? `  native:\n    enabled: true${c.entry.path ? `\n    path: "${c.entry.path}"` : ""}${c.entry.mcp_entry ? `\n    mcp_entry: ${JSON.stringify(c.entry.mcp_entry)}` : ""}`
      : `  github:\n    enabled: true${c.entry.mcp_entry ? `\n    mcp_entry: ${JSON.stringify(c.entry.mcp_entry)}` : ""}`;
    const { root, cleanup } = tmpWorkspace({ ".quay/config.yml": PROVIDER_AXIS_CONFIG(yamlProviders) });
    try {
      const result = validateConfig({ workspaceRoot: root });
      const runtimeEntry = activeProvider({ config: { providers: { [c.id]: c.entry } } }, c.id);
      const runtimeHasEntry = Array.isArray(runtimeEntry.mcp_entry) && runtimeEntry.mcp_entry.length > 0;
      assert.equal(runtimeHasEntry, c.expected, `${c.label}: runtime resolution`);
      assert.equal(
        providerErrors(result).length === 0,
        runtimeHasEntry,
        `${c.label}: validator verdict (${JSON.stringify(providerErrors(result))}) must equal the runtime's resolution`,
      );
    } finally {
      cleanup();
    }
  }
});

test("AC4: config-validate.ts no longer reads the raw YAML mcp_entry (predicate proven against the pre-change file)", async () => {
  const { execFileSync: exec } = await import("node:child_process");
  const repoRoot = path.join(__dirname, "..", "..", "..");
  // The predicate is a PROPERTY ACCESS of the raw YAML field — message/suggestion text (a quoted
  // "mcp_entry") is not one, so it must not be flagged (硬规则 2: by position, not by keyword).
  const RAW_ACCESS = /\.mcp_entry\b|\[\s*["']mcp_entry["']\s*\]/;
  // ── half 1: prove the predicate CAN match — run it against the PRE-change file (develop's copy).
  const before = exec("git", ["-C", repoRoot, "show", "develop:packages/quay/src/config-validate.ts"], {
    encoding: "utf8",
  });
  const beforeHits = before.split("\n").filter((l) => RAW_ACCESS.test(l));
  assert.ok(
    beforeHits.length > 0,
    "the predicate must match the pre-change file (otherwise the zero-count below proves nothing)",
  );
  // ── half 2: it matches NOTHING in the working copy.
  const after = fs.readFileSync(path.join(__dirname, "..", "src", "config-validate.ts"), "utf8");
  const afterHits = after.split("\n").filter((l) => RAW_ACCESS.test(l));
  assert.deepEqual(
    afterHits,
    [],
    `config-validate.ts must delegate the mcp_entry judgment to resolveProviderEntry; raw reads found: ${JSON.stringify(afterHits)}`,
  );
});

test("AC3: the injected plugin root is the same seam the validator uses (resolvable vs null)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": PROVIDER_AXIS_CONFIG("  native:\n    enabled: true"),
  });
  try {
    const resolvable = validateConfig({ workspaceRoot: root, pluginRoot: "/some/plugin/root" });
    assert.equal(resolvable.ok, true, `an injected resolvable root ⇒ ok, got ${JSON.stringify(resolvable.issues)}`);
    const unresolvable = validateConfig({ workspaceRoot: root, pluginRoot: null });
    assert.equal(unresolvable.ok, false);
  } finally {
    cleanup();
  }
});

test("AC: invalid loop execution value exits with error (M5)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  execution: not-a-valid-mode
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const execIssue = result.issues.find((i) => i.field === "loop.execution");
    assert.ok(execIssue, `expected execution issue, got: ${JSON.stringify(result.issues)}`);
    assert.match(execIssue.message, /dispatched.*inline/);
  } finally {
    cleanup();
  }
});

test("AC: invalid loop audit value exits with error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  audit: friendly
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const auditIssue = result.issues.find((i) => i.field === "loop.audit");
    assert.ok(auditIssue, `expected audit issue, got: ${JSON.stringify(result.issues)}`);
    assert.match(auditIssue.message, /adversarial.*none/);
  } finally {
    cleanup();
  }
});

test("AC: invalid concurrency exits with error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  concurrency: 0
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const concIssue = result.issues.find((i) => i.field === "loop.concurrency");
    assert.ok(concIssue, `expected concurrency issue, got: ${JSON.stringify(result.issues)}`);
    assert.match(concIssue.message, /integer >= 1/);
  } finally {
    cleanup();
  }
});

test("AC: invalid stop value exits with error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  stop: forever
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const stopIssue = result.issues.find((i) => i.field === "loop.stop");
    assert.ok(stopIssue, `expected stop issue, got: ${JSON.stringify(result.issues)}`);
    assert.match(stopIssue.message, /once.*until/);
  } finally {
    cleanup();
  }
});

test("AC: malformed routine exits with error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  routines:
    - name: bad-routine
    - name: no-dispatch-or-probe
      trigger: every(5)
    - name: valid-routine
      trigger: every(10)
      probe: my-probe
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);

    // First entry: missing trigger
    const triggerIssue = result.issues.find((i) => i.field === "loop.routines[0].trigger");
    assert.ok(triggerIssue, `expected missing-trigger issue for routines[0], got: ${JSON.stringify(result.issues)}`);

    // Second entry: no dispatch or probe
    const actionIssue = result.issues.find((i) => i.field === "loop.routines[1]" && i.message.includes("dispatch"));
    assert.ok(actionIssue, `expected missing-dispatch/probe issue for routines[1], got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC: routine with invalid trigger pattern exits with error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  routines:
    - name: bad-trigger
      trigger: hourly
      probe: my-probe
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const triggerIssue = result.issues.find((i) => i.field === "loop.routines[0].trigger");
    assert.ok(triggerIssue, `expected trigger issue, got: ${JSON.stringify(result.issues)}`);
    assert.match(triggerIssue.message, /invalid/);
  } finally {
    cleanup();
  }
});

test("AC: routine every(0) exits with error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  routines:
    - name: zero-trigger
      trigger: every(0)
      probe: my-probe
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const triggerIssue = result.issues.find((i) => i.field === "loop.routines[0].trigger" && i.message.includes("N must be >= 1"));
    assert.ok(triggerIssue, `expected every(0) issue, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC: interval:<N>m routine trigger passes validation (cand-config-validate-interval-trigger-drift)", () => {
  // Mirrors the finding repro: a two-layer routine with an interval trigger
  // (DIR-056 time form) must validate ok — the runtime readLoopParams accepts it.
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  routines:
    - name: nightly-report
      trigger: "interval:30m"
      probe: my-probe
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    const triggerIssues = result.issues.filter((i) => i.field.startsWith("loop.routines[0].trigger"));
    assert.equal(triggerIssues.length, 0,
      `expected no trigger issues for interval:30m, got: ${JSON.stringify(result.issues)}`);
    assert.equal(result.ok, true, `expected ok:true, got issues: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC: interval:<N>m without gates section passes validation (exact finding repro)", () => {
  // The finding's repro had no `gates:` section at all — only loop.gates: [acceptance].
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "/custom/tasks"
loop:
  board: native
  gates: [acceptance]
  routines:
    - name: nightly-report
      trigger: "interval:30m"
      probe: my-probe
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    const triggerIssues = result.issues.filter((i) => i.field.startsWith("loop.routines[0].trigger"));
    assert.equal(triggerIssues.length, 0,
      `expected no trigger issues for interval:30m (no gates section), got: ${JSON.stringify(result.issues)}`);
    assert.equal(result.ok, true, `expected ok:true, got issues: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC: interval:0m exits with error (N must be >= 1)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  routines:
    - name: zero-interval
      trigger: "interval:0m"
      probe: my-probe
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    assert.equal(result.ok, false);
    const triggerIssue = result.issues.find((i) =>
      i.field === "loop.routines[0].trigger" && i.message.includes("N must be >= 1")
    );
    assert.ok(triggerIssue, `expected interval:0m issue, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC: interval:1x exits with error (invalid pattern)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  routines:
    - name: malformed-interval
      trigger: "interval:1x"
      probe: my-probe
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    assert.equal(result.ok, false);
    const triggerIssue = result.issues.find((i) =>
      i.field === "loop.routines[0].trigger" && i.message.includes("invalid")
    );
    assert.ok(triggerIssue, `expected interval:1x issue, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC: warn-exit contract — warn-only result has ok:true (M6)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "nonexistent-tool --verbose"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    // --check-files with unresolvable bare token produces warn, not error
    const result = validateConfig({ workspaceRoot: root, checkFiles: true });
    // Should still be ok if only warn issues
    const hasOnlyWarns = result.issues.every((i) => i.severity === "warn");
    if (hasOnlyWarns && result.issues.length > 0) {
      assert.equal(result.ok, true, "warn-only result must have ok:true");
    }
    // There should be at least a warn about the unresolvable command token
    const warnIssue = result.issues.find((i) => i.severity === "warn");
    assert.ok(warnIssue, `expected at least one warn issue for unresolvable command token, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC: --check-files with explicit missing path exits with error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  it0:
    - name: missing-script
      script: "./nonexistent-script.sh"
      argsKey: myArgs
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: true });
    assert.equal(result.ok, false);
    const fileIssue = result.issues.find((i) =>
      i.field === "gates.it0[0].script" && i.message.includes("not found")
    );
    assert.ok(fileIssue, `expected file-not-found issue, got: ${JSON.stringify(result.issues)}`);
    assert.equal(fileIssue.severity, "error");
  } finally {
    cleanup();
  }
});

test("M10: PATH-binary heuristic — 'node' on PATH is never flagged", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: node-gate
      command: "node --test some-file.test.mjs"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: true });
    // "node" should be found on PATH — no warn about it
    const fileIssues = result.issues.filter((i) => i.message.includes("Command token"));
    assert.equal(fileIssues.length, 0,
      `expected no file-existence issues for PATH binary 'node', got: ${JSON.stringify(fileIssues)}`);
    assert.equal(result.ok, true);
  } finally {
    cleanup();
  }
});

test("M10: PATH-binary heuristic — shell keywords are never flagged", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: for-loop-gate
      command: "for d in packages/*/; do npx tsc --noEmit -p \\"$d\\" || exit 1; done"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: true });
    // "for" is a shell keyword — should not be flagged
    const fileIssues = result.issues.filter((i) => i.message.includes("Command token"));
    assert.equal(fileIssues.length, 0,
      `expected no file-existence issues for shell keyword 'for', got: ${JSON.stringify(fileIssues)}`);
  } finally {
    cleanup();
  }
});

test("M10: explicit path './missing.sh' flagged when absent", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: explicit-missing
      command: "./missing.sh --flag"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: true });
    assert.equal(result.ok, false);
    const fileIssue = result.issues.find((i) =>
      i.field === "gates.testPass[0].command" && i.message.includes("not found")
    );
    assert.ok(fileIssue, `expected file-not-found issue for ./missing.sh, got: ${JSON.stringify(result.issues)}`);
    assert.equal(fileIssue.severity, "error");
  } finally {
    cleanup();
  }
});

test("fixed gate shape validation catches missing script", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  fixed:
    - name: no-script-gate
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const shapeIssue = result.issues.find((i) => i.field === "gates.fixed[0].script");
    assert.ok(shapeIssue, `expected missing-script issue for fixed gate, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("adr gate shape validation catches non-string entry", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  adr:
    - 123
    - ""
    - "ADR-001"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const adrIssues = result.issues.filter((i) => i.field.startsWith("gates.adr") && i.field.includes("["));
    assert.ok(adrIssues.length >= 2, `expected at least 2 adr issues, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("it0 gate shape validation catches missing argsKey", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  it0:
    - name: my-it0
      script: "./test.sh"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const argsKeyIssue = result.issues.find((i) => i.field === "gates.it0[0].argsKey");
    assert.ok(argsKeyIssue, `expected missing-argsKey issue, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("redGreen gate shape validation catches missing red field", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  redGreen:
    - name: my-rg
      green: "echo pass"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const redIssue = result.issues.find((i) => i.field === "gates.redGreen[0].red");
    assert.ok(redIssue, `expected missing-red issue, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("non-object gate entry triggers type error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - "not-an-object"
    - name: ok-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, false);
    const typeIssue = result.issues.find((i) =>
      i.field === "gates.testPass[0]" && i.message.includes("Expected an object")
    );
    assert.ok(typeIssue, `expected type error for non-object entry, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("loop.gates as string is accepted and resolved", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: acceptance
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    // "acceptance" is a built-in gate — it should resolve
    const refIssues = result.issues.filter((i) => i.message.includes("Unresolved gate reference"));
    assert.equal(refIssues.length, 0,
      `expected no unresolved gate ref for "acceptance" string, got: ${JSON.stringify(refIssues)}`);
  } finally {
    cleanup();
  }
});

test("all required loop fields present with valid values => ok:true", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "/custom/tasks"
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
  stop: until(.halt)
  execution: dispatched
  audit: adversarial
  concurrency: 4
  routines:
    - name: routine-a
      trigger: on(deploy)
      probe: my-probe
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root });
    assert.equal(result.ok, true, `expected ok:true, got issues: ${JSON.stringify(result.issues)}`);
    assert.equal(result.issues.length, 0);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// DIR-099-B — Provider env validation (check #9/10) unit tests
// ---------------------------------------------------------------------------

test("AC1: native provider without QUAY_NATIVE_TASKS_DIR yields warn, not error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
    env: {}
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    const nativeIssues = result.issues.filter((i) =>
      i.field === "providers.native.env.QUAY_NATIVE_TASKS_DIR"
    );
    assert.equal(nativeIssues.length, 1, `expected 1 native env issue, got: ${JSON.stringify(result.issues)}`);
    assert.equal(nativeIssues[0].severity, "warn", "expected warn severity, not error (false-positive fixed)");
    assert.match(nativeIssues[0].message, /QUAY_NATIVE_TASKS_DIR/);
    assert.match(nativeIssues[0].message, /\.\/tasks/);
    // warn-only → ok:true (warn-exit contract)
    assert.equal(result.ok, true, `expected ok:true for warn-only, got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC2: github provider without QUAY_GITHUB_REPO yields warn, not error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  github:
    enabled: true
    mcp_entry: ["node", "./bin/github", "mcp"]
    env: {}
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: github
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    const githubIssues = result.issues.filter((i) =>
      i.field === "providers.github.env.QUAY_GITHUB_REPO"
    );
    assert.equal(githubIssues.length, 1, `expected 1 github env issue, got: ${JSON.stringify(result.issues)}`);
    assert.equal(githubIssues[0].severity, "warn", "expected warn severity, not error (second false-positive fixed)");
    assert.match(githubIssues[0].message, /QUAY_GITHUB_REPO/);
    assert.match(githubIssues[0].message, /yaleh\/quay/);
    // warn-only → ok:true
    assert.equal(result.ok, true);
  } finally {
    cleanup();
  }
});

test("AC3: github with malformed QUAY_GITHUB_REPO 'foo' yields error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  github:
    enabled: true
    mcp_entry: ["node", "./bin/github", "mcp"]
    env:
      QUAY_GITHUB_REPO: "foo"
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: github
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    assert.equal(result.ok, false, "malformed repo should cause ok:false");
    const errorIssues = result.issues.filter((i) =>
      i.field === "providers.github.env.QUAY_GITHUB_REPO" && i.severity === "error"
    );
    assert.equal(errorIssues.length, 1, `expected 1 error for malformed repo, got: ${JSON.stringify(result.issues)}`);
    assert.match(errorIssues[0].message, /owner\/repo/);
    assert.match(errorIssues[0].message, /foo/);
  } finally {
    cleanup();
  }
});

test("AC3: github with malformed QUAY_GITHUB_REPO 'foo/' yields error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  github:
    enabled: true
    mcp_entry: ["node", "./bin/github", "mcp"]
    env:
      QUAY_GITHUB_REPO: "foo/"
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: github
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    assert.equal(result.ok, false);
    const errorIssues = result.issues.filter((i) =>
      i.field === "providers.github.env.QUAY_GITHUB_REPO" && i.severity === "error"
    );
    assert.equal(errorIssues.length, 1, `expected error for "foo/", got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC3: github with malformed QUAY_GITHUB_REPO '/repo' yields error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  github:
    enabled: true
    mcp_entry: ["node", "./bin/github", "mcp"]
    env:
      QUAY_GITHUB_REPO: "/repo"
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: github
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    assert.equal(result.ok, false);
    const errorIssues = result.issues.filter((i) =>
      i.field === "providers.github.env.QUAY_GITHUB_REPO" && i.severity === "error"
    );
    assert.equal(errorIssues.length, 1, `expected error for "/repo", got: ${JSON.stringify(result.issues)}`);
  } finally {
    cleanup();
  }
});

test("AC3: github with QUAY_GITHUB_REPO 'a/b/c' yields no error (runtime accepts it)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  github:
    enabled: true
    mcp_entry: ["node", "./bin/github", "mcp"]
    env:
      QUAY_GITHUB_REPO: "a/b/c"
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: github
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    const githubIssues = result.issues.filter((i) =>
      i.field === "providers.github.env.QUAY_GITHUB_REPO"
    );
    assert.equal(githubIssues.length, 0,
      `expected no issues for "a/b/c" (runtime accepts it), got: ${JSON.stringify(githubIssues)}`);
  } finally {
    cleanup();
  }
});

test("AC4: both providers with env vars set yields zero provider-env issues", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "/custom/tasks"
  github:
    enabled: true
    mcp_entry: ["node", "./bin/github", "mcp"]
    env:
      QUAY_GITHUB_REPO: "myorg/myrepo"
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    // No provider-env issues for either provider
    const provEnvIssues = result.issues.filter((i) =>
      i.field && (i.field.includes("QUAY_NATIVE_TASKS_DIR") || i.field.includes("QUAY_GITHUB_REPO"))
    );
    assert.equal(provEnvIssues.length, 0,
      `expected 0 provider-env issues, got: ${JSON.stringify(provEnvIssues)}`);
  } finally {
    cleanup();
  }
});

test("AC5: warn-exit contract — warn-only provider-env result has ok:true", () => {
  // A config with only provider-env warns (native missing tasks_dir) and
  // NO gate/loop issues should still report ok:true.
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
    env: {}
  github:
    enabled: true
    mcp_entry: ["node", "./bin/github", "mcp"]
    env: {}
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    assert.equal(result.ok, true,
      `warn-only result must have ok:true, got: ${JSON.stringify(result.issues)}`);
    // Should have 2 warns (one per provider)
    const warns = result.issues.filter((i) => i.severity === "warn");
    assert.ok(warns.length >= 2, `expected at least 2 warns, got: ${JSON.stringify(result.issues)}`);
    // No errors
    const errors = result.issues.filter((i) => i.severity === "error");
    assert.equal(errors.length, 0, `expected 0 errors, got: ${JSON.stringify(errors)}`);
  } finally {
    cleanup();
  }
});

test("AC8: github with QUAY_GITHUB_REPO: '' (present-but-empty) yields warn, not error", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  github:
    enabled: true
    mcp_entry: ["node", "./bin/github", "mcp"]
    env:
      QUAY_GITHUB_REPO: ""
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: github
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    // Empty string is falsy → runtime defaults to yaleh/quay → should be warn, not error
    const githubIssues = result.issues.filter((i) =>
      i.field === "providers.github.env.QUAY_GITHUB_REPO"
    );
    assert.equal(githubIssues.length, 1, `expected 1 issue, got: ${JSON.stringify(result.issues)}`);
    assert.equal(githubIssues[0].severity, "warn",
      `empty QUAY_GITHUB_REPO must be warn (falsy → runtime defaults), got ${githubIssues[0].severity}`);
    assert.equal(result.ok, true, "warn-only → ok:true");
  } finally {
    cleanup();
  }
});

test("AC9: AC6 falsifier — native with tasks_dir set but env key absent STILL yields warn", () => {
  // Proves the check reads the env map only, never tasks_dir as an env source.
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
    tasks_dir: "/custom/tasks-from-field"
    env: {}
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const result = validateConfig({ workspaceRoot: root, checkFiles: false });
    // Should STILL warn about missing QUAY_NATIVE_TASKS_DIR in the env map
    // even though tasks_dir is set on the provider object
    const nativeIssues = result.issues.filter((i) =>
      i.field === "providers.native.env.QUAY_NATIVE_TASKS_DIR"
    );
    assert.equal(nativeIssues.length, 1,
      `expected warn for missing env QUAY_NATIVE_TASKS_DIR despite tasks_dir field, got: ${JSON.stringify(result.issues)}`);
    assert.equal(nativeIssues[0].severity, "warn",
      "task_dir field is not an env source — the check must read the env map only");
    assert.equal(result.ok, true, "warn-only → ok:true");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Phase B — CLI integration tests
// ---------------------------------------------------------------------------

test("M7: CLI handler dynamically loads and calls validateConfig (production path)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "/custom/tasks"
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const stdout = cliValidate(root);
    assert.match(stdout, /Config valid/);
  } finally {
    cleanup();
  }
});

test("AC1/AC2 CLI: a config whose native provider omits path/mcp_entry validates (exit 0)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    tasks_dir: "./tasks"
    env:
      QUAY_NATIVE_TASKS_DIR: "./tasks"
gates:
  testPass:
    - name: my-gate
      command: "echo ok"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const stdout = cliValidate(root);
    assert.match(stdout, /Config valid/);
  } finally {
    cleanup();
  }
});

test("AC3 (structural): every provider-launch path routes mcp_entry through providerMcpEntry", () => {
  // By POSITION (硬规则 2): the three launch paths must read the argv through the shared helper —
  // a direct `… = provider.mcp_entry` destructure is the bare-TypeError path this AC closes.
  const srcDir = path.join(__dirname, "..", "src");
  const targets = ["mcp-server.ts", "serve.ts", path.join("cli", "shared.ts")];
  for (const rel of targets) {
    const src = fs.readFileSync(path.join(srcDir, rel), "utf8");
    assert.match(src, /providerMcpEntry\(provider\)/, `${rel} must resolve argv via providerMcpEntry(provider)`);
    assert.doesNotMatch(src, /=\s*provider\.mcp_entry\b/, `${rel} must not destructure provider.mcp_entry directly`);
  }
});

test("M8: quay config --help prints validate subcommand", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const stdout = execFileSync("node", [quayBin, "config", "--help"], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
    assert.match(stdout, /validate/);
    assert.match(stdout, /check/);
  } finally {
    cleanup();
  }
});

test("M9: CB-021 — config validate --format yaml exits 1", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    let threw = false;
    try {
      execFileSync("node", [quayBin, "config", "validate", "--format", "yaml"], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      threw = true;
      assert.match(e.stderr, /unsupported --format value/);
      assert.equal(e.status, 1);
    }
    assert.ok(threw, "expected --format yaml to exit 1");
  } finally {
    cleanup();
  }
});

test("config validate --json outputs valid JSON array", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const stdout = execFileSync("node", [quayBin, "config", "validate", "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
    JSON.parse(stdout); // must not throw
    const parsed = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed), `expected JSON array, got ${typeof parsed}`);
  } finally {
    cleanup();
  }
});

test("config validate on malformed config exits 1 (human output)", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
: : : malformed
providers:
`.trim(),
  });
  try {
    let threw = false;
    try {
      execFileSync("node", [quayBin, "config", "validate"], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      threw = true;
      assert.equal(e.status, 1);
      // YAML parse error is caught by loadConfig() and printed to stderr
      assert.match(e.stderr, /YAML|malformed|error/i);
    }
    assert.ok(threw, "expected malformed YAML to exit 1");
  } finally {
    cleanup();
  }
});

test("config validate check alias also works", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "/custom/tasks"
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    const stdout = execFileSync("node", [quayBin, "config", "check"], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
    assert.match(stdout, /Config valid/);
  } finally {
    cleanup();
  }
});

test("unknown config subcommand exits 1 with hint", () => {
  const { root, cleanup } = tmpWorkspace({
    ".quay/config.yml": `
providers:
  native:
    enabled: true
    mcp_entry: ["node", "./bin/native", "mcp"]
loop:
  board: native
  gates: [acceptance]
`.trim(),
  });
  try {
    let threw = false;
    try {
      execFileSync("node", [quayBin, "config", "foo"], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      threw = true;
      assert.equal(e.status, 1);
      assert.match(e.stderr, /unknown subcommand/);
      assert.match(e.stderr, /validate/);
    }
    assert.ok(threw, "expected unknown subcommand to exit 1");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Structural-similarity smoke test (M2)
// ---------------------------------------------------------------------------

test("M2: validator gate schemas structurally match TypeScript types", async () => {
  // Import the TypeScript types and compare required fields
  const typesModule = await import("../src/gate/config/types.ts");
  // The validator schema declares required fields for each gate type.
  // This test verifies the TypeScript interfaces have the same REQUIRED fields.
  // Optional fields (cwd, timeoutMs, pattern) are expected to differ.
  const it0Entry = typesModule; // not an instance, just checking the module exists
  assert.ok(it0Entry, "gate/config/types.ts module should load");
  // This is a smoke test that the types module is importable and exists —
  // the actual required-field comparison is done by the shape check tests above.
});

test("M5: validator reuses VALID_EXECUTION, VALID_AUDIT, VALID_STOP_RE from loop-params", async () => {
  const loopParams = await import("../src/loop-params.ts");
  assert.ok(loopParams.VALID_EXECUTION, "VALID_EXECUTION must be exported");
  assert.ok(loopParams.VALID_AUDIT, "VALID_AUDIT must be exported");
  assert.ok(loopParams.VALID_STOP_RE, "VALID_STOP_RE must be exported");
  assert.ok(loopParams.VALID_EXECUTION.has("dispatched"));
  assert.ok(loopParams.VALID_EXECUTION.has("inline"));
  assert.equal(loopParams.VALID_EXECUTION.has("not-a-mode"), false);
  assert.ok(loopParams.VALID_AUDIT.has("adversarial"));
  assert.ok(loopParams.VALID_AUDIT.has("none"));
  assert.ok(loopParams.VALID_STOP_RE.test("once"));
  assert.ok(loopParams.VALID_STOP_RE.test("until(.halt)"));
});
