// @test-group engine
// probe-fallback-path-check.test.mjs — the "a probe's declared fallback is a path that resolves"
// check (task gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared).
//
// WHAT IS PINNED:
//   (a) the FALLBACK-section extractor: the paragraph+bullets shape (architecture-analysis) and the
//       nested-bullet shape (semantic-dedup-scan), a BLOCKQUOTE mention of `fallback:` is prose and
//       must not become the section (the silent-zero-paths degradation measured while writing it),
//       and the `.json` / `.js` boundary in the path regex;
//   (b) existence + fixture-run are TWO arms: a file that exists but whose static import graph does
//       not resolve is a violation (the archived-`git-lens-*.ts` failure mode is a resolution error,
//       which alone would still exit 1 and look like a normal "no findings" run);
//   (c) the real corpus: every path named in any `plugin/probes/*.md` FALLBACK section exists and
//       its fixture run exits 0/1 — and the specific archived `git-lens-*.ts` paths are GONE;
//   (d) the WIRING: `probe-routine.ts` refuses the spawn (zero spawn, `not-evaluated`) when the
//       declared fallback is not runnable, and still spawns when it is.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  checkProbeFallbacks,
  extractFallbackPaths,
  extractFallbackSection,
  resolveFallbackPath,
  runFallbackFixture,
} from "../scripts/probe-fallback-path-check.ts";
import { llmProbeRoutine } from "../scripts/probe-routine.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN_ROOT = path.join(REPO_ROOT, "plugin");

const CREATED_DIRS = [];
after(() => {
  for (const d of CREATED_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function makeTmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  CREATED_DIRS.push(d);
  return d;
}

/** A temp plugin root with the probes (and any extra files) the case needs. */
function makePlugin({ probes = {}, files = {} } = {}) {
  const root = makeTmpDir("probe-fallback-");
  fs.mkdirSync(path.join(root, "plugin", "probes"), { recursive: true });
  for (const [name, body] of Object.entries(probes)) {
    fs.writeFileSync(
      path.join(root, "plugin", "probes", `${name}.md`),
      `---\ninstrument: none\nfallback: live-readers\n---\n${body}`,
      "utf8",
    );
  }
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
  }
  return { root, pluginRoot: path.join(root, "plugin") };
}

// ── (a) the extractor ────────────────────────────────────────────────────────────────────────────

test("extractFallbackSection — paragraph + bullets shape, interrupted by the next prose paragraph", () => {
  const body = [
    "Intro prose.",
    "",
    "When the primary cannot scope, use the FALLBACK readers below:",
    "",
    "- `plugin/scripts/a.ts --help` — reader A.",
    "- `plugin/scripts/b.ts --help` — reader B.",
    "",
    "For each finding, state the files.",
  ].join("\n");
  const section = extractFallbackSection(body);
  assert.ok(section, "a section is found");
  assert.equal(section.startLine, 3);
  assert.equal(section.endLine, 6, "the trailing prose paragraph ends the section");
  assert.match(section.text, /a\.ts/);
  assert.match(section.text, /b\.ts/);
  assert.doesNotMatch(section.text, /For each finding/);
});

test("extractFallbackSection — the deep-scan nested-bullet shape keeps the nested readers", () => {
  const body = [
    "- PRIMARY instrument: the MCP tool.",
    "- FALLBACK (recorded 2026-07-20): the LIVE readers in `plugin/scripts`:",
    "  - `node x plugin/scripts/a.ts --root .` — reader A.",
    "  - `node x plugin/scripts/b.ts --root .` — reader B.",
    "- Then complete the inventory yourself.",
    "",
    "Report the inventory SIZE.",
  ].join("\n");
  const section = extractFallbackSection(body);
  assert.ok(section);
  assert.match(section.text, /a\.ts/);
  assert.match(section.text, /b\.ts/);
  assert.equal(extractFallbackPaths("deep", body).length, 2);
});

test("extractFallbackSection — a BLOCKQUOTE mention of `fallback:` is prose, not the section", () => {
  // The exact degradation measured on the real corpus: the first "fallback" hit was a blockquote
  // line at indent 0, so the section ended immediately and ZERO paths were checked.
  const body = [
    "> Before spawning, the driver records a not-evaluated fact naming the `fallback:` declared above.",
    "",
    "When the primary cannot scope, use the FALLBACK readers below:",
    "- `plugin/scripts/live.ts` — the real reader.",
  ].join("\n");
  assert.equal(extractFallbackSection(body).startLine, 3);
  assert.deepEqual(extractFallbackPaths("p", body).map((r) => r.relPath), ["plugin/scripts/live.ts"]);
});

test("extractFallbackPaths — no marker ⇒ no paths; the `.json`/`.js` boundary is respected", () => {
  assert.deepEqual(extractFallbackPaths("none", "just prose about plugin/scripts/x.ts\n"), []);
  const body = ["FALLBACK readers:", "- read `plugin/freshness-producers.json` and `plugin/scripts/ok.mjs`."].join("\n");
  assert.deepEqual(extractFallbackPaths("p", body).map((r) => r.relPath), ["plugin/scripts/ok.mjs"]);
});

// ── (b) existence vs fixture run are two arms ───────────────────────────────────────────────────

test("checkProbeFallbacks — an EXISTS-but-unresolvable module is a violation, not a pass", () => {
  const { root, pluginRoot } = makePlugin({
    probes: {
      p: ["FALLBACK readers:", "- `plugin/scripts/needs-missing-lib.ts --help`"].join("\n"),
    },
    files: {
      "plugin/scripts/needs-missing-lib.ts": 'import { thing } from "./lib-that-was-moved.ts";\nprocess.exit(0);\n',
    },
  });
  const report = checkProbeFallbacks(pluginRoot);
  assert.equal(report.evaluated, true);
  assert.equal(report.ok, false);
  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].exists, true, "the file itself exists");
  assert.equal(report.violations[0].fixture.moduleResolutionError, true);
  assert.match(report.violations[0].reason, /MODULE-RESOLUTION/);

  // Negative control for the seam: existence-only would have called this path fine — which is why
  // the fixture run exists at all.
  const existenceOnly = checkProbeFallbacks(pluginRoot, { runFixture: false });
  assert.equal(existenceOnly.ok, true);
  assert.ok(!report.ok, "…and the full check is the one that catches it");
  assert.ok(root);
});

test("checkProbeFallbacks — an ABSENT path names every candidate it looked at", () => {
  const { pluginRoot } = makePlugin({
    probes: { p: "FALLBACK readers:\n- `plugin/scripts/git-lens-l-d-code-doc-ratio.ts`" },
  });
  const report = checkProbeFallbacks(pluginRoot);
  assert.equal(report.ok, false);
  assert.match(report.violations[0].reason, /absent/);
  assert.match(report.violations[0].reason, /git-lens-l-d-code-doc-ratio\.ts/);
  assert.ok(report.violations[0].candidates.length >= 1);
});

test("checkProbeFallbacks — a fixture run exiting 2 (usage) is a violation; 0 and 1 are accepted", () => {
  const { pluginRoot } = makePlugin({
    probes: {
      p: [
        "FALLBACK readers:",
        "- `plugin/scripts/ok0.ts`",
        "- `plugin/scripts/ok1.ts`",
        "- `plugin/scripts/usage2.ts`",
      ].join("\n"),
    },
    files: {
      "plugin/scripts/ok0.ts": "process.exit(0);\n",
      "plugin/scripts/ok1.ts": "process.exit(1);\n",
      "plugin/scripts/usage2.ts": "process.exit(2);\n",
    },
  });
  const report = checkProbeFallbacks(pluginRoot);
  assert.equal(report.ok, false);
  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].relPath, "plugin/scripts/usage2.ts");
  assert.match(report.violations[0].reason, /expected 0 or 1/);
});

test("runFallbackFixture — a shell path is syntax-checked (bash -n), never executed", () => {
  const dir = makeTmpDir("probe-fallback-sh-");
  const ok = path.join(dir, "ok.sh");
  const bad = path.join(dir, "bad.sh");
  fs.writeFileSync(ok, "set -euo pipefail\necho hi\n", "utf8");
  fs.writeFileSync(bad, "if then fi\n", "utf8");
  assert.equal(runFallbackFixture(ok, dir).exit, 0);
  assert.notEqual(runFallbackFixture(bad, dir).exit, 0);
});

// ── (c) the real corpus ─────────────────────────────────────────────────────────────────────────

test("the REAL probes: every FALLBACK-section path exists and passes its fixture run", () => {
  const report = checkProbeFallbacks(PLUGIN_ROOT);
  assert.equal(report.evaluated, true);
  assert.equal(report.ok, true, report.reason);
  assert.ok(report.probesScanned.includes("architecture-analysis"));
  assert.ok(report.probesScanned.includes("semantic-dedup-scan"));

  const named = report.readings.map((r) => r.relPath);
  // The archived paths MUST be gone (the task's finding): all three absent on disk since 2026-09-07.
  for (const archived of [
    "plugin/scripts/git-lens-l-d-code-doc-ratio.ts",
    "plugin/scripts/git-lens-l-g-structural-drift.ts",
    "plugin/scripts/git-lens-l-s-behavior-variance.ts",
  ]) {
    assert.ok(!named.includes(archived), `${archived} must not be cited as a runnable fallback`);
  }
  // …and the live readers that replaced them are present in the shallow probe's fallback section.
  for (const live of [
    "plugin/scripts/phase-declare.ts",
    "plugin/scripts/ls-mutation-reading.ts",
    "plugin/scripts/archguard-runner.ts",
  ]) {
    assert.ok(named.includes(live), `${live} is named by a probe fallback`);
  }
});

test("the REAL probes' frontmatter no longer points at the retired git-lens tool family", () => {
  for (const probe of ["architecture-analysis", "semantic-dedup-scan"]) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, "probes", `${probe}.md`), "utf8");
    const frontmatter = text.slice(0, text.indexOf("\n---", 4));
    assert.match(frontmatter, /^fallback:\s*live-readers\s*$/m, `${probe}: fallback label is live-readers`);
    assert.doesNotMatch(frontmatter, /^fallback:\s*git-lens\s*$/m);
  }
});

// ── (d) the wiring: probe-routine refuses to spawn on an unrunnable fallback ─────────────────────

const FINDING = {
  id: "findRepoRoot",
  kind: "byte-identical-body",
  symbols: ["findRepoRoot"],
  files: ["plugin/scripts/a.ts:10", "packages/quay/src/b.ts:22"],
  verdict: "real-duplication",
  rationale: "identical normalized bodies",
  suggestedAction: "extract",
};
const PROBE_OUTPUT = JSON.stringify({ findings: [FINDING], shards: 1, inventory: { plugin_scripts: 1, package_src: 1, candidate_clusters: 1 } });

/** A workspace the routine can run in: `.quay/` + a probe spec + a git repo (FILE-ONLY snapshot). */
function makeRoutineWorkspace(probeBody, extraFiles = {}) {
  const { root, pluginRoot } = makePlugin({
    probes: { "semantic-dedup-scan": probeBody },
    files: extraFiles,
  });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  spawnSync("git", ["-C", root, "init", "-q"], { encoding: "utf8" });
  return { root, pluginRoot };
}

function runRoutine({ root, pluginRoot }) {
  let spawns = 0;
  const opts = {
    root,
    pluginRoot,
    probeTimeoutMs: 30_000,
    filingEnabled: false, // this test is about the pre-spawn gate, not the filing track
    probeArgv: () => [process.execPath, "-e", ""],
    spawnFn: async () => {
      spawns += 1;
      return { status: 0, stdout: PROBE_OUTPUT, stderr: "", error: null };
    },
  };
  const decl = { name: "semantic-dedup-scan", trigger: "interval:1440m", probe: "semantic-dedup-scan", dispatch: null };
  return { run: () => llmProbeRoutine(decl, opts).run({ halted: false }), spawns: () => spawns };
}

test("probe-routine pre-spawn: an unrunnable declared fallback ⇒ not-evaluated and ZERO spawn", async () => {
  const ws = makeRoutineWorkspace(
    "FALLBACK readers:\n- `plugin/scripts/git-lens-l-d-code-doc-ratio.ts`",
  );
  const { run, spawns } = runRoutine(ws);
  const facts = await run();
  assert.equal(facts[0].state, "not-evaluated");
  assert.match(facts[0].reason, /declared fallback is not runnable/);
  assert.match(facts[0].reason, /git-lens-l-d-code-doc-ratio\.ts/);
  assert.equal(spawns(), 0, "the probe must not be spawned on a dead fallback");
  assert.equal(
    fs.existsSync(path.join(ws.root, ".quay", "routine-findings.jsonl")),
    false,
    "⛔ nothing may be recorded — a dead fallback must not look like an empty measurement",
  );
});

test("probe-routine pre-spawn: a runnable fallback still spawns (the gate is not always-refusing)", async () => {
  const ws = makeRoutineWorkspace(
    "FALLBACK readers:\n- `plugin/scripts/live-reader.ts --help`",
    { "plugin/scripts/live-reader.ts": "process.exit(0);\n" },
  );
  const { run, spawns } = runRoutine(ws);
  const facts = await run();
  assert.equal(spawns(), 1, "a runnable fallback does not block the spawn");
  assert.doesNotMatch(facts[0].reason ?? "", /declared fallback is not runnable/);
});

// ── path resolution across the two layouts ──────────────────────────────────────────────────────

test("resolveFallbackPath — the repo layout and the installed-plugin layout are both tried", () => {
  const root = makeTmpDir("probe-fallback-layout-");
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "scripts", "x.ts"), "process.exit(0);\n", "utf8");
  const inRepo = resolveFallbackPath(root, path.join(root, "plugin"), "plugin/scripts/x.ts");
  assert.equal(inRepo.exists, true);
  assert.equal(inRepo.resolvedPath, path.join(root, "plugin", "scripts", "x.ts"));

  // Installed-plugin layout: pluginRoot is the plugin dir itself, whose parent is not a repo.
  const installed = makeTmpDir("probe-fallback-installed-");
  fs.mkdirSync(path.join(installed, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(installed, "scripts", "y.ts"), "process.exit(0);\n", "utf8");
  const installedResolved = resolveFallbackPath(path.dirname(installed), installed, "plugin/scripts/y.ts");
  assert.equal(installedResolved.exists, true);
  assert.equal(installedResolved.resolvedPath, path.join(installed, "scripts", "y.ts"));
});

test("resolveFallbackPath — a raw-.ts-less ARTIFACT install resolves via scripts/dist/<name>.js", () => {
  // The publish step strips raw .ts; without this candidate the pre-spawn gate would report every
  // fallback absent on a real install and suppress the probe track there forever.
  const installed = makeTmpDir("probe-fallback-artifact-");
  fs.mkdirSync(path.join(installed, "scripts", "dist"), { recursive: true });
  fs.writeFileSync(path.join(installed, "scripts", "dist", "z.js"), "process.exit(0);\n", "utf8");
  const resolved = resolveFallbackPath(path.dirname(installed), installed, "plugin/scripts/z.ts");
  assert.equal(resolved.exists, true);
  assert.equal(resolved.resolvedPath, path.join(installed, "scripts", "dist", "z.js"));
  assert.equal(runFallbackFixture(resolved.resolvedPath, installed).exit, 0);

  // ⛔ …and a path that exists in NEITHER form is still absent (the archived git-lens-*.ts case).
  const archived = resolveFallbackPath(path.dirname(installed), installed, "plugin/scripts/git-lens-l-d-code-doc-ratio.ts");
  assert.equal(archived.exists, false);
});
