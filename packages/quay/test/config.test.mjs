// @test-group product
// QN-032 (iteration 22): regression test for config.js's findConfig/
// loadConfig/activeProvider — the literal first link in the `skeleton`
// V_instance factor's own chain (protocol §5.1: "config -> mcp -> serve ->
// action -> Skill -> done"). Prior to this task, config.js had zero direct
// test coverage; its only prior exercise was incidental, as a side-effect of
// serve.test.mjs's (QN-031) always-valid throwaway config fixture, which
// never triggers any of this module's three error-throwing branches or its
// multi-level upward-search behavior.
//
// Run: node test/config.test.mjs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { findConfig, loadConfig, activeProvider } from "../src/config.ts";
import { resolveServeBinding } from "../src/serve-binding.ts";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function mkTree(root, ...segs) {
  const dir = path.join(root, ...segs);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function main() {
  // --- findConfig(): multi-level upward search (found case) ---
  const root1 = fs.mkdtempSync(path.join(os.tmpdir(), "quay-config-test-"));
  const aDir = mkTree(root1, "a");
  const bcDir = mkTree(root1, "a", "b", "c");
  fs.mkdirSync(path.join(aDir, ".quay"), { recursive: true });
  const configYamlPath = path.join(aDir, ".quay", "config.yml");
  fs.writeFileSync(
    configYamlPath,
    "providers:\n  native:\n    enabled: true\n    tasks_dir: \"/tmp/whatever\"\n  github:\n    enabled: false\n"
  );
  const found = findConfig(bcDir);
  assert(
    found === configYamlPath,
    `findConfig() walks upward from a nested dir (${bcDir}) and finds .quay/config.yml written 2 levels up (got ${found})`
  );

  // --- findConfig(): not-found case ---
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "quay-config-nocfg-"));
  const noCfgDir = mkTree(root2, "x", "y");
  // os.tmpdir() itself has no .quay ancestor in this sandboxed environment;
  // confirm that assumption holds before trusting the null result below.
  assert(
    findConfig(os.tmpdir()) === null,
    "sanity check: os.tmpdir() itself has no .quay/config.yml in its ancestry (precondition for the negative case below)"
  );
  assert(
    findConfig(noCfgDir) === null,
    `findConfig() returns null when no .quay/config.yml exists anywhere in the ancestry (searched from ${noCfgDir})`
  );

  // --- loadConfig(): happy path ---
  const loaded = loadConfig(bcDir);
  assert(loaded.configPath === configYamlPath, "loadConfig() returns the correct configPath");
  assert(
    loaded.workspaceRoot === aDir,
    `loadConfig() computes workspaceRoot as two directories up from configPath (expected ${aDir}, got ${loaded.workspaceRoot})`
  );
  assert(
    loaded.config?.providers?.native?.enabled === true,
    "loadConfig() returns the parsed YAML config with the expected shape"
  );

  // --- loadConfig(): error path ---
  let loadThrew = null;
  try {
    loadConfig(noCfgDir);
  } catch (err) {
    loadThrew = err;
  }
  assert(loadThrew !== null, "loadConfig() throws when no .quay/config.yml exists in the ancestry");
  assert(
    loadThrew && /no \.quay\/config\.yml found/.test(loadThrew.message),
    `loadConfig()'s thrown error message contains "no .quay/config.yml found" (got: ${loadThrew && loadThrew.message})`
  );

  // --- activeProvider(cfg, id): happy path, explicit id, including a disabled provider ---
  const cfg = loaded;
  const githubProvider = activeProvider(cfg, "github");
  assert(
    githubProvider.id === "github" && githubProvider.enabled === false,
    "activeProvider(cfg, 'github') returns the disabled provider when explicitly requested by id (enabled:true is not required for explicit-id selection, per the source's own comment)"
  );
  const nativeProviderExplicit = activeProvider(cfg, "native");
  assert(
    nativeProviderExplicit.id === "native" && nativeProviderExplicit.enabled === true,
    "activeProvider(cfg, 'native') returns the matching provider's fields spread in, with id set"
  );

  // --- activeProvider(cfg, id): error path, id not present ---
  let noSuchProviderThrew = null;
  try {
    activeProvider(cfg, "nonexistent-provider");
  } catch (err) {
    noSuchProviderThrew = err;
  }
  assert(noSuchProviderThrew !== null, "activeProvider(cfg, id) throws for an id not present in providers map");
  assert(
    noSuchProviderThrew && /no such provider/.test(noSuchProviderThrew.message),
    `activeProvider()'s thrown error message contains "no such provider" (got: ${noSuchProviderThrew && noSuchProviderThrew.message})`
  );

  // --- activeProvider(cfg): happy path, no id, exactly one enabled ---
  const autoSelected = activeProvider(cfg);
  assert(
    autoSelected.id === "native",
    `activeProvider(cfg) with no id auto-selects the sole enabled provider (got ${autoSelected.id})`
  );

  // --- activeProvider(cfg): error path, no provider enabled ---
  const allDisabledCfg = {
    config: { providers: { native: { enabled: false }, github: { enabled: false } } },
  };
  let noEnabledThrew = null;
  try {
    activeProvider(allDisabledCfg);
  } catch (err) {
    noEnabledThrew = err;
  }
  assert(noEnabledThrew !== null, "activeProvider(cfg) throws when no provider in the map has enabled:true");
  assert(
    noEnabledThrew && /no enabled provider/.test(noEnabledThrew.message),
    `activeProvider()'s thrown error message contains "no enabled provider" (got: ${noEnabledThrew && noEnabledThrew.message})`
  );

  // --- activeProvider(cfg): error path, empty providers map ---
  let emptyMapThrew = null;
  try {
    activeProvider({ config: {} });
  } catch (err) {
    emptyMapThrew = err;
  }
  assert(emptyMapThrew !== null, "activeProvider(cfg) throws when the config has no providers map at all");

  // --- M26-adversarial-eval (DIR-001 item 4, "bad config" category):
  // loadConfig() with a SYNTACTICALLY malformed .quay/config.yml (present,
  // but not valid YAML) -- distinct from the not-found case above (which
  // config.js already handled with its own clear "no .quay/config.yml
  // found" message). Confirmed during Phase A audit: YAML.parse() throws a
  // raw YAMLParseError with no wrapping, and this path had ZERO test
  // coverage before this milestone. The error DOES propagate cleanly (no
  // crash, no hang) up to bin/quay.js's top-level main().catch handler,
  // which already prints err.stack and exits non-zero -- this is asserted
  // here directly against loadConfig() itself, the actual throw site, per
  // this milestone's "fault-injection test must assert safe degradation"
  // requirement (Done-when clause 5).
  const root3 = fs.mkdtempSync(path.join(os.tmpdir(), "quay-config-malformed-"));
  const malformedDir = mkTree(root3, "a");
  fs.mkdirSync(path.join(malformedDir, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(malformedDir, ".quay", "config.yml"),
    "providers:\n  native:\n  - bad: [unterminated\n"
  );
  let malformedThrew = null;
  try {
    loadConfig(malformedDir);
  } catch (err) {
    malformedThrew = err;
  }
  assert(
    malformedThrew !== null,
    "loadConfig() with a syntactically malformed (present but invalid) .quay/config.yml throws rather than returning garbage or hanging"
  );
  assert(
    malformedThrew && /YAMLParseError|flow sequence|nested mapping/i.test(malformedThrew.name || malformedThrew.message || String(malformedThrew)),
    `loadConfig()'s malformed-YAML error is a real, nameable parse error, not a generic/opaque failure (got: ${malformedThrew && (malformedThrew.name + ": " + malformedThrew.message)})`
  );
  fs.rmSync(root3, { recursive: true, force: true });

  fs.rmSync(root1, { recursive: true, force: true });
  fs.rmSync(root2, { recursive: true, force: true });

  // --- serve: section — loadConfig carries it, and resolveServeBinding reads THAT document ---
  // gap-serve-binding-defaults-three-copies-to-one-definition-point P3: the `serve:` keys are a
  // config surface, so the chain that must hold is loadConfig() -> resolveServeBinding(). Asserting
  // the pair here (the config module's own test) is what ties "the key is delivered and readable" to
  // "the resolver reads the very document the CLI loads".
  const root4 = fs.mkdtempSync(path.join(os.tmpdir(), "quay-config-serve-"));
  const serveDir = mkTree(root4, "a");
  fs.mkdirSync(path.join(serveDir, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(serveDir, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\nserve:\n  host: \"10.9.8.7\"\n  port: 4321\n"
  );
  const cfg4 = loadConfig(serveDir);
  assert(cfg4.config && cfg4.config.serve && cfg4.config.serve.port === 4321,
    "loadConfig() carries the serve: section verbatim (it is a plain document read)");
  const bound = resolveServeBinding({ config: cfg4.config });
  assert(bound.kind === "resolved" && bound.host === "10.9.8.7" && bound.port === 4321 && bound.source === "config",
    `resolveServeBinding reads the SAME document loadConfig produced (got ${JSON.stringify(bound)})`);
  const badDir = mkTree(root4, "b");
  fs.mkdirSync(path.join(badDir, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(badDir, ".quay", "config.yml"), "providers: {}\nserve:\n  port: nope\n");
  const badBound = resolveServeBinding({ config: loadConfig(badDir).config });
  assert(badBound.kind === "not-evaluated",
    "a malformed serve: value read through the SAME chain is refused, never silently defaulted");
  fs.rmSync(root4, { recursive: true, force: true });

  console.log(failures === 0 ? "\nAll QN-032 config.js regression tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
