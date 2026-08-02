// @test-group engine
// Tests for read-probe-spec.mjs — DIR-056: probe spec loader. TDD RED→GREEN.
// These tests exercise fail-closed behavior and happy-path parsing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter, readProbeSpec } from "../scripts/read-probe-spec.ts";

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
function tmpPluginRoot(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `probe-spec-${label}-`));
  fs.mkdirSync(path.join(d, "probes"), { recursive: true });
  return d;
}

function writeProbe(pluginRoot, name, content) {
  fs.writeFileSync(path.join(pluginRoot, "probes", `${name}.md`), content);
}

const VALID_SPEC = `---
instrument: meta-cc
fallback: none
output_routing:
  defect: milestone-candidate
  adr: adr-draft
  default: milestone-candidate
---
You are a fresh-context miner. Do things.
`;

// ── parseFrontmatter unit tests ──────────────────────────────────────────────────────────────────

test("parseFrontmatter: parses frontmatter and body", () => {
  const { frontmatter, body } = parseFrontmatter(VALID_SPEC);
  assert.equal(frontmatter.instrument, "meta-cc");
  assert.equal(frontmatter.fallback, "none");
  assert.equal(typeof frontmatter.output_routing, "object");
  assert.match(body, /fresh-context miner/);
});

test("parseFrontmatter: no frontmatter → empty object + full body", () => {
  const { frontmatter, body } = parseFrontmatter("just a body\nno fences");
  assert.deepEqual(frontmatter, {});
  assert.match(body, /just a body/);
});

test("parseFrontmatter: malformed YAML frontmatter throws PROBE-SPEC FAIL-CLOSED", () => {
  const bad = `---\ninstrument: [unclosed\n---\nbody\n`;
  assert.throws(
    () => parseFrontmatter(bad),
    (e) => {
      assert(e.message.includes("PROBE-SPEC FAIL-CLOSED"), `got: ${e.message}`);
      return true;
    }
  );
});

// ── readProbeSpec fail-closed tests ─────────────────────────────────────────────────────────────

test("readProbeSpec: file not found → PROBE-SPEC FAIL-CLOSED", () => {
  const pluginRoot = tmpPluginRoot("notfound");
  assert.throws(
    () => readProbeSpec("no-such-probe", pluginRoot),
    (e) => {
      assert(e.message.includes("PROBE-SPEC FAIL-CLOSED"), `got: ${e.message}`);
      assert(e.message.includes("not found"), `expected 'not found' in: ${e.message}`);
      return true;
    }
  );
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test("readProbeSpec: malformed YAML frontmatter → PROBE-SPEC FAIL-CLOSED", () => {
  const pluginRoot = tmpPluginRoot("malformed");
  writeProbe(pluginRoot, "bad", "---\ninstrument: [unclosed\n---\nbody\n");
  assert.throws(
    () => readProbeSpec("bad", pluginRoot),
    (e) => {
      assert(e.message.includes("PROBE-SPEC FAIL-CLOSED"), `got: ${e.message}`);
      return true;
    }
  );
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test("readProbeSpec: missing 'instrument' field → PROBE-SPEC FAIL-CLOSED", () => {
  const pluginRoot = tmpPluginRoot("noinstrument");
  writeProbe(pluginRoot, "noinstr", "---\nfallback: none\n---\nbody\n");
  assert.throws(
    () => readProbeSpec("noinstr", pluginRoot),
    (e) => {
      assert(e.message.includes("PROBE-SPEC FAIL-CLOSED"), `got: ${e.message}`);
      assert(e.message.includes("instrument"), `expected 'instrument' in: ${e.message}`);
      return true;
    }
  );
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test("readProbeSpec: empty probe name → PROBE-SPEC FAIL-CLOSED", () => {
  const pluginRoot = tmpPluginRoot("emptyname");
  assert.throws(
    () => readProbeSpec("", pluginRoot),
    (e) => {
      assert(e.message.includes("PROBE-SPEC FAIL-CLOSED"), `got: ${e.message}`);
      return true;
    }
  );
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test("readProbeSpec: missing pluginRoot → PROBE-SPEC FAIL-CLOSED", () => {
  assert.throws(
    () => readProbeSpec("any", null),
    (e) => {
      assert(e.message.includes("PROBE-SPEC FAIL-CLOSED"), `got: ${e.message}`);
      return true;
    }
  );
});

// ── readProbeSpec happy-path tests ──────────────────────────────────────────────────────────────

test("readProbeSpec: valid spec returns parsed object with all fields", () => {
  const pluginRoot = tmpPluginRoot("valid");
  writeProbe(pluginRoot, "history-mining", VALID_SPEC);
  const spec = readProbeSpec("history-mining", pluginRoot);
  assert.equal(spec.instrument, "meta-cc");
  assert.equal(spec.fallback, "none");
  assert.equal(typeof spec.output_routing, "object");
  assert.equal(spec.output_routing.defect, "milestone-candidate");
  assert.equal(spec.output_routing.adr, "adr-draft");
  assert.equal(spec.output_routing.default, "milestone-candidate");
  assert.match(spec.objective, /fresh-context miner/);
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test("readProbeSpec: missing fallback defaults to 'none'", () => {
  const pluginRoot = tmpPluginRoot("nofallback");
  writeProbe(pluginRoot, "probe", "---\ninstrument: archguard\n---\ndo stuff\n");
  const spec = readProbeSpec("probe", pluginRoot);
  assert.equal(spec.instrument, "archguard");
  assert.equal(spec.fallback, "none");
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test("readProbeSpec: missing output_routing defaults to { default: milestone-candidate }", () => {
  const pluginRoot = tmpPluginRoot("norouting");
  writeProbe(pluginRoot, "probe", "---\ninstrument: none\n---\ndo stuff\n");
  const spec = readProbeSpec("probe", pluginRoot);
  assert.equal(spec.output_routing.default, "milestone-candidate");
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test("readProbeSpec: instrument: none is valid (no MCP tool needed)", () => {
  const pluginRoot = tmpPluginRoot("none-instrument");
  writeProbe(pluginRoot, "self-val", "---\ninstrument: none\nfallback: none\n---\ncheck code\n");
  const spec = readProbeSpec("self-val", pluginRoot);
  assert.equal(spec.instrument, "none");
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});
