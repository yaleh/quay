// @test-group product
//
// init-provider-registry.test.mjs — the durability fixture for the fresh-install provider
// EXTENSION POINT (task gap-init-ts-4214-line-slice-with-extension-point-first; DIR-133 裁定 2).
//
// WHAT THIS FILE IS FOR. `packages/quay/src/init.ts` is the repo's largest single file (4214 lines /
// 79 exports at HEAD 329087733) and the provider axis is the one that actually moves: adding a
// provider used to mean editing the centre (a hardcoded `providers:` block + a hardcoded github
// example + the native-only `mcpEntryForProvider`). A slice that only MOVES those lines elsewhere
// regrows the centre (quay `worker`: 82% of later growth back into the centre file; plantuml-js
// `elk.ts`: 570→150→278). So the slice lands an extension point, and this file is what keeps it
// from decaying back into a comment:
//
//   - the descriptor table is a LOOKUP (`createProviderInitRegistry`), so a provider can be
//     registered from OUTSIDE `init.ts` with no centre edit;
//   - `init.ts` renders through `renderProviderSection` and names no concrete provider — asserted
//     here from the SOURCE, positionally, because that is the property that has to survive.
//
// THE FOUR ARMS (the counted forms the checker requires — `extension-point-criteria-check.ts`):
//
//   正臂        register a descriptor from OUTSIDE init.ts, ask for that provider id, and count the
//               descriptor's own marker in the generated config: `triggered=1`. A "the handler
//               exists" assertion would stay green with the wiring cut; a count cannot.
//   负臂        the SAME count for an UNREGISTERED id is `triggered=0` AND `lookup()` returns null
//               (`handlerRegistered=false`) AND the unregistered provider still gets the generic
//               ABI block (no native pins) — the last one is the arm's teeth: a leaking dispatcher
//               would hand the unregistered id a registered provider's block.
//   注入泄漏     replace the lookup table with one that ignores registration and always resolves to
//               the native descriptor. The SAME positive assertion must go red.
//   红线基线    `wc -l packages/quay/src/init.ts` before the change was 4214; the assertion
//               `after < 4214` was RED before the slice (see the task body for the run) and is
//               what this file's own source-position test rides on indirectly — the centre no
//               longer carries the provider implementation.
//
// ⛔ Not covered here (deliberately): the EXISTING-config edit paths (`upgradeConfigContent`,
// `ensureProviderCarrierEnvText`'s `CARRIER_KINDS`, `corruptBackupPathFor`). They mutate a config a
// user already owns; this axis is FRESH-install generation only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProviderInitRegistry,
  mcpEntryForProvider,
  NATIVE_PROVIDER_INIT,
  PROVIDER_INIT_REGISTRY,
} from "../src/init-provider-registry.ts";
import { generateConfigContent } from "../src/init.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INIT_TS = path.join(HERE, "..", "src", "init.ts");
const REGISTRY_TS = path.join(HERE, "..", "src", "init-provider-registry.ts");

/** Count lines whose trimmed text equals `marker` — the `triggered=N` count, never an existence check. */
function countMarker(content, marker) {
  return content.split("\n").filter((line) => line.trim() === marker).length;
}

/** The `providers.<id>:` block as text (from the key line to the next blank line). */
function providerBlock(content, id) {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line === `  ${id}:`);
  if (start === -1) return null;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (i > start && lines[i].trim() === "") break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** A provider registered from OUTSIDE init.ts — the extension point's whole point. */
const DEMO_PROVIDER_INIT = {
  id: "demo",
  renderBody: ({ abs }) => [
    "    enabled: true",
    "    tasks_dir: " + JSON.stringify(abs("tasks")),
    "    demo_marker: 1",
  ],
};

function configFor(providerId, extra = {}) {
  return generateConfigContent({
    providerId,
    providerPath: "./packages/quay-demo",
    isNode: true,
    isGo: false,
    ...extra,
  });
}

// ── 正臂 ─────────────────────────────────────────────────────────────────────────────────────────

test("正臂: a descriptor registered OUTSIDE init.ts is rendered — triggered=1", () => {
  // Registration happens in THIS file, not in the centre. A fresh registry keeps the assertion
  // independent of the process-wide one other tests touch.
  const registry = createProviderInitRegistry();
  registry.register(DEMO_PROVIDER_INIT);
  assert.notEqual(registry.lookup("demo"), null, "the registration must be visible to exact lookup");

  const content = configFor("demo", { registry });
  assert.equal(countMarker(content, "demo_marker: 1"), 1, "triggered must be exactly 1 (count, not existence)");
  assert.equal(providerBlock(content, "demo") !== null, true, "the block must render under the requested id");
});

// ── 负臂 ─────────────────────────────────────────────────────────────────────────────────────────

test("负臂: an UNREGISTERED id reads triggered=0 and handlerRegistered=false — and gets no registered provider's block", () => {
  const registry = createProviderInitRegistry();
  registry.register(DEMO_PROVIDER_INIT);

  // handlerRegistered=false: exact lookup must NOT fall back (硬规则 3b — "not registered" must not
  // share the shape of "registered").
  assert.equal(registry.lookup("ghost"), null, "handlerRegistered=false");

  const content = configFor("ghost", { registry });
  assert.equal(countMarker(content, "demo_marker: 1"), 0, "triggered must be 0 for an unregistered id");

  // The arm's teeth: the unregistered provider still gets a VALID block (behaviour preserved), but
  // it is the GENERIC ABI shape — never a registered provider's body. A leaking dispatcher would
  // hand `ghost` the native body and this assertion would red.
  const ghost = providerBlock(content, "ghost");
  assert.notEqual(ghost, null, "an unregistered provider must still render a generic block");
  assert.doesNotMatch(ghost, /QUAY_NATIVE_TASKS_DIR/, "the generic block must not carry the native provider's pins");
  assert.match(ghost, /^ {4}path: /m, "the generic block must declare a path (native's does not)");
  assert.match(ghost, /^ {4}mcp_entry: /m, "the generic block must declare an mcp_entry");
});

// ── 注入泄漏 ─────────────────────────────────────────────────────────────────────────────────────

test("注入泄漏: a lookup table that ignores registration reds the SAME assertions", () => {
  const nativeBody = NATIVE_PROVIDER_INIT;
  const leaky = createProviderInitRegistry();
  // The leak: registration is ignored, every id resolves to the native descriptor.
  leaky.resolve = () => nativeBody;
  leaky.lookup = () => nativeBody;

  // The positive arm's own assertion, against the leaking dispatcher: red.
  const leakedDemo = configFor("demo", { registry: leaky });
  assert.equal(
    countMarker(leakedDemo, "demo_marker: 1"),
    0,
    "INJECTION LEAK: the positive arm must go RED (demo's body never rendered)",
  );

  // …and the negative arm's hand-written half reds too: an unregistered id now "resolves".
  assert.equal(leaky.lookup("ghost") !== null, true, "INJECTION LEAK: handlerRegistered must red");
});

// ── 生产载体：注册走进程级注册表，init.ts 不含具体 provider 实现 ───────────────────────────────

test("production carrier: registering into the process-wide table is picked up with NO init.ts edit", () => {
  const marker = "    singleton_demo_marker: 1";
  PROVIDER_INIT_REGISTRY.register({
    id: "singleton-demo",
    renderBody: ({ abs }) => ["    enabled: true", "    tasks_dir: " + JSON.stringify(abs("tasks")), marker.trim()],
  });

  // No `registry` option: this is the SAME call `quay init` makes.
  const content = configFor("singleton-demo");
  assert.equal(countMarker(content, marker.trim()), 1, "triggered=1 through the production registry");
});

test("init.ts carries the CALL SITE only — the concrete providers live in init-provider-registry.ts", () => {
  const initSrc = fs.readFileSync(INIT_TS, "utf8");
  const registrySrc = fs.readFileSync(REGISTRY_TS, "utf8");

  // The centre renders through the extension point…
  assert.match(initSrc, /renderProviderSection\(/, "init.ts must render the providers section through the extension point");
  // …and carries no concrete provider implementation. These three spellings are the ones the
  // pre-slice centre held; each is now descriptor-only.
  assert.equal(initSrc.includes("NATIVE_PROVIDER_INIT"), false, "no native descriptor in the centre");
  assert.equal(initSrc.includes("default_task_status: todo"), false, "the native descriptor's body must not live in the centre");
  assert.equal(initSrc.includes("uncomment to use GitHub Issues"), false, "the github example must not live in the centre");

  // …while the module that OWNS them does (a positive control: the assertions above are not
  // satisfied by the tokens being absent everywhere).
  assert.equal(registrySrc.includes("QUAY_NATIVE_TASKS_DIR"), true, "the registry module must carry the native body");
  assert.equal(registrySrc.includes("uncomment to use GitHub Issues"), true, "the registry module must carry the github example");
});

// ── 行为回归：模板输出与切片前一致 ─────────────────────────────────────────────────────────────

test("regression: the native fresh-install block is unchanged by the slice", () => {
  const content = configFor("native");
  const block = providerBlock(content, "native");
  assert.notEqual(block, null, "the native provider must still be rendered");
  assert.match(block, /^ {4}enabled: true$/m);
  assert.match(block, /^ {4}tasks_dir: "\.\/tasks"$/m);
  for (const pin of ["QUAY_NATIVE_TASKS_DIR", "QUAY_NATIVE_GOAL_DIR", "QUAY_NATIVE_ADR_DIR", "QUAY_NATIVE_META_DIR"]) {
    assert.match(block, new RegExp(`^ {6}${pin}: "\\./(tasks|goals|adr|meta)"$`, "m"), `${pin} must still be emitted`);
  }
  // The 2026-10-06 ruling still holds: the native entry declares no binding keys.
  assert.doesNotMatch(block, /^ {4}path: /m, "native must not declare a path");
  assert.doesNotMatch(block, /^ {4}mcp_entry: /m, "native must not declare an mcp_entry");

  // The absolute-path form (a real workspace root) must survive the move into the descriptor.
  const abs = generateConfigContent({
    providerId: "native",
    providerPath: "./packages/quay-native",
    isNode: true,
    isGo: false,
    root: "/tmp/ws",
  });
  assert.match(abs, /^ {6}QUAY_NATIVE_TASKS_DIR: "\/tmp\/ws\/tasks"$/m, "root-absolute pins must still be emitted");
});

test("regression: the github descriptor is a REAL registration — a live block and the commented example", () => {
  const live = configFor("github");
  const block = providerBlock(live, "github");
  assert.notEqual(block, null, "asking for github must emit a live github block");
  assert.match(block, /^ {4}path: "\.\/packages\/quay-demo"$/m, "the live block uses the caller's providerPath");
  assert.match(block, /^ {4}mcp_entry: \["node", "\.\/bin\/quay-native\.ts", "mcp"\]$/m);

  // A DIFFERENT provider still gets the commented example (it is a trailing of the github
  // descriptor, not a hardcoded line in the centre); the enabled provider's own example is
  // suppressed — a commented copy of the block that just rendered says nothing.
  const native = configFor("native");
  assert.match(native, /^ {2}# github:$/m, "the commented example must still be present for other providers");
  assert.match(native, /^ {2}# {3}mcp_entry: \["node", "\.\/bin\/quay-github\.mjs", "mcp"\]$/m);
  assert.doesNotMatch(live, /^ {2}# github:$/m, "the enabled provider must not be repeated as a commented example");
});

test("mcpEntryForProvider keeps discriminating installed vs dev provider paths", () => {
  assert.equal(mcpEntryForProvider("./node_modules/quay-native"), '["node", "./dist/quay-native.js", "mcp"]');
  assert.equal(mcpEntryForProvider("./packages/quay-native"), '["node", "./bin/quay-native.ts", "mcp"]');
  assert.equal(mcpEntryForProvider("C:\\npm\\node_modules\\quay-native"), '["node", "./dist/quay-native.js", "mcp"]');
});
