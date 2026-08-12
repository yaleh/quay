// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-11 real-install e2e; install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop install subprocess tree. The install/quay-init family
// rotated flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init-loop-consumer-doc-refs.test.mjs — gap-quay-init-loop-tick-doc-paths-reference-unlanded-
// plugin-loop (AC37, ad-arm1 archguard). The consumer tick doc docs/analysis/fast-mode-loop-tick.md
// referenced plugin/loop/* paths that quay-init NEVER lays (the loop lays orchestration/ +
// docs/analysis/), and the referenced⊆landed gate did not catch it (it scanned only the plugin
// source docs, and `plugin/loop` was not in the path-spelling alternation). This pins the fix:
//   AC2 — verify_referenced_landed ALSO scans the CONSUMER-LAID docs (docs/analysis/): a laid doc
//         referencing a path that does not land FAILS the install (referenced-not-landed).
//   AC3 — the shipped tick docs + skills reference the consumer landing (orchestration/ +
//         docs/analysis/), never the non-landed plugin/loop/ bundle-source path.
//   AC5 — the docs/analysis/ copy a consumer actually reads has ZERO plugin/loop/ refs, and every
//         orchestration//docs/analysis/ ref is landed or declared self-create/reference-doc.
//   regression — a reintroduced plugin/loop/ ref in a source doc makes the install FAIL (the AC37
//         path-spelling blind spot stays closed).
//
// Run:
//   scripts/test.sh plugin/test/quay-init-loop-consumer-doc-refs.test.mjs
//   node --test plugin/test/quay-init-loop-consumer-doc-refs.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
// AC3 (gap-serial-install-family-shared-prebuilt-fixture): the positive-case install is pure setup —
// copy it from the shared prebuilt fixture; the negative controls stay REAL installs.
import { laydownWorkspace, runInit, makeTmp, cleanup, pluginDir, declaredSet } from "./quay-init-loop-helpers.mjs";

const INIT_ARGS = (ws) => ["--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0"];

// The REF extraction the Contract measure + the gate share: every path-prefixed reference in a doc.
const REF_RE = /(plugin\/loop|plugin\/scripts|orchestration|docs\/analysis)\/[a-zA-Z0-9._-]+/g;
function extractPathRefs(text) {
  const refs = new Set();
  let m;
  while ((m = REF_RE.exec(text)) !== null) refs.add(m[0]);
  return [...refs];
}

// The shipped docs/skills that quay-init lays VERBATIM to a consumer must never reference the
// non-landed plugin/loop/ bundle-source path.
function shippedDocs() {
  const files = [];
  const loopDir = path.join(pluginDir, "loop");
  for (const f of fs.readdirSync(loopDir)) if (f.endsWith(".md")) files.push(path.join(loopDir, f));
  for (const d of fs.readdirSync(path.join(pluginDir, "skills"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(pluginDir, "skills", d.name, "SKILL.md");
    if (fs.existsSync(f)) files.push(f);
  }
  return files;
}

// ── AC3: shipped docs/skills never reference the non-landed plugin/loop/ source path ──────────────
test("AC3 — the shipped tick docs + skills have ZERO plugin/loop/ path references (the non-landed bundle-source path)", () => {
  const offenders = [];
  for (const f of shippedDocs()) {
    const src = fs.readFileSync(f, "utf8");
    for (const ref of extractPathRefs(src)) {
      if (ref.startsWith("plugin/loop/")) offenders.push(`${path.relative(pluginDir, f)}: ${ref}`);
    }
  }
  assert.deepEqual(offenders, [],
    "no shipped doc/skill may reference plugin/loop/* (quay-init never lays it; the consumer landing is orchestration/ + docs/analysis/)");
});

// ── AC2 + AC5: a real install passes the gate, and the consumer-laid docs/analysis/ copy has zero
//    plugin/loop refs with every orchestration//docs/analysis/ ref landed-or-declared ──────────────
test("AC2+AC5 — a real --loop install: verify-referenced-landed OK, and every consumer-doc ref is landed or declared self-create/reference-doc (no plugin/loop refs)", () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-referenced-landed: OK/,
      "the referenced⊆landed gate must pass with the consumer docs laid at orchestration/ + docs/analysis/");
    const laid = path.join(ws, "docs", "analysis", "fast-mode-loop-tick.md");
    assert.ok(fs.existsSync(laid), "the inner tick doc must land at docs/analysis/fast-mode-loop-tick.md");
    assert.equal(fs.readFileSync(laid, "utf8"),
      fs.readFileSync(path.join(pluginDir, "loop", "fast-mode-loop-tick.md"), "utf8"),
      "the laid copy must be byte-identical to the plugin source (verbatim laydown)");
    // The consumer-laid docs/analysis/ copy is what a target project ACTUALLY reads — its refs must
    // resolve in the target (landed or declared). No plugin/loop/ ref may survive the verbatim copy.
    const selfcreate = declaredSet(pluginDir, "self-create");
    const refdoc = declaredSet(pluginDir, "reference-doc");
    const missing = [];
    const docsDir = path.join(ws, "docs", "analysis");
    for (const f of fs.readdirSync(docsDir)) {
      if (!f.endsWith(".md")) continue;
      const src = fs.readFileSync(path.join(docsDir, f), "utf8");
      for (const ref of extractPathRefs(src)) {
        if (ref.startsWith("plugin/loop/")) missing.push(`${f}: plugin/loop/ ref (never lands) — ${ref}`);
        else if (!fs.existsSync(path.join(ws, ref)) && !selfcreate.has(ref) && !refdoc.has(ref)) {
          missing.push(`${f}: ${ref} is neither landed nor declared self-create/reference-doc`);
        }
      }
    }
    assert.deepEqual(missing, [], "every consumer-laid docs/analysis/ ref must be landed or declared; none may point at plugin/loop/");
  } finally { cleanup(ws); }
});

// ── AC2 negative control: a consumer-laid doc referencing a path that never lands FAILS the install ─
test("AC2 negative — a pre-existing consumer docs/analysis/ doc referencing a non-landed path FAILS --loop (referenced-not-landed)", () => {
  const ws = makeTmp();
  try {
    fs.mkdirSync(path.join(ws, "docs", "analysis"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs", "analysis", "evil-consumer-doc.md"),
      "this consumer doc references a path the loop never lays: plugin/scripts/nonexistent-checker.ts\n", "utf8");
    const r = runInit(ws, INIT_ARGS(ws));
    assert.notEqual(r.status, 0, "--loop must FAIL when a consumer-laid docs/analysis/ doc references a non-landed path");
    assert.match(r.stderr, /referenced-not-landed/, "must use the referenced-not-landed category");
    assert.match(r.stderr, /nonexistent-checker\.ts/, "must name the non-landed referenced path");
  } finally { cleanup(ws); }
});

// ── AC37 regression: a reintroduced plugin/loop/ ref in a source doc FAILS the install ─────────────
test("AC37 regression — a reintroduced plugin/loop/ ref in a shipped tick doc FAILS --loop (path-spelling blind spot stays closed)", () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.appendFileSync(path.join(src, "loop", "fast-mode-tick-core.md"),
      "\nplugin/loop/orchestrator-loop-tick.md is referenced here (regression probe)\n", "utf8");
    const ws = makeTmp();
    try {
      const r = runInit(ws, INIT_ARGS(ws), src);
      assert.notEqual(r.status, 0, "--loop must FAIL when a shipped doc references the non-landed plugin/loop/ path");
      assert.match(r.stderr, /referenced-not-landed/, "must use the referenced-not-landed category");
      assert.match(r.stderr, /plugin\/loop\/orchestrator-loop-tick\.md/, "must name the plugin/loop/ referenced path");
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});
