// @test-group governance
// runtime-usage-inventory.test.mjs — gap-no-inventory-of-what-the-two-layer-mode-actually-runs.
// Unit + integration tests for the runtime-usage-inventory tool (plugin/scripts/runtime-usage-inventory.ts).
//
// Coverage map (task ACs):
//   AC1  — enumerateScripts covers the full script set, total is self-consistent (no omissions).
//   AC2  — executed is command-position matched, quotes stripped: `grep 'foo.ts'` / `ls foo.ts` /
//          `cat foo.ts` NEVER count (fixture asserts executed==0); `node foo.ts` counts.
//   AC3  — imported_by parses import/require STATEMENTS (comment-stripped), not substrings.
//   AC4  — bidirectional negative control against the REAL transcripts: scripts/test.sh must be
//          `live` and chart2-s1-distribution-reliability.ts must NOT be `live` (skips if the
//          sessions dir is absent).
//   AC5  — DORMANT_BY_DECISION is an explicit list (chart2/git-lens/governance-product-ratio/outward-vt/
//          portfolio), source-cited; never inferred from a path prefix.
//   AC6  — never-runs-test lists every *.test.* outside scripts/test.sh's canonical glob.
//   AC7  — buildInventory computes the main→long diff (low-frequency ≠ dead).
//   AC10 — this file declares `// @test-group governance`.
//
// Run:
//   scripts/test.sh --for-task gap-no-inventory-of-what-the-two-layer-mode-actually-runs
//   scripts/test.sh plugin/test/runtime-usage-inventory.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  enumerateScripts,
  stripQuotedContent,
  splitCommandSegments,
  countExecutedInCommand,
  extractModuleSpecifiers,
  classifyScript,
  globMatch,
  inTestGlob,
  buildInventory,
  extractHeaderComment,
  extractInstrumentDeclaration,
  buildInstrumentsManifest,
  DORMANT_BY_DECISION,
  TEST_GLOB_PATTERNS,
} from "../scripts/runtime-usage-inventory.ts";

// Every synthetic-repo dir is removed once at the end of this file (the carrier-array + after()
// pattern) — a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = path.resolve(__dirname, "..", "..");

  // A minimal ScriptEntry fixture used by command-position tests.
  const SCRIPT_FIXTURE = {
    relPath: "plugin/scripts/runtime-usage-inventory.ts",
    realPath: "plugin/scripts/runtime-usage-inventory.ts",
    basename: "runtime-usage-inventory.ts",
    aliases: [],
  };

  // ── AC2: command-position executed detection ────────────────────────────────────────────────
  test("AC2: quote-stripped; `grep 'foo.ts'` never counts", () => {
    const paths = [SCRIPT_FIXTURE.relPath, SCRIPT_FIXTURE.realPath];
    assert.equal(countExecutedInCommand(`grep '${SCRIPT_FIXTURE.relPath}' Makefile`, SCRIPT_FIXTURE, paths), 0);
    assert.equal(countExecutedInCommand(`grep "${SCRIPT_FIXTURE.relPath}" Makefile`, SCRIPT_FIXTURE, paths), 0);
    assert.equal(countExecutedInCommand("echo \"running plugin/scripts/runtime-usage-inventory.ts\"", SCRIPT_FIXTURE, paths), 0);
    assert.equal(countExecutedInCommand("echo `node plugin/scripts/runtime-usage-inventory.ts`", SCRIPT_FIXTURE, paths), 0);
  });

  test("AC2: reference-only tools (`ls`/`cat`/`git`/`find`) never count", () => {
    const paths = [SCRIPT_FIXTURE.relPath, SCRIPT_FIXTURE.realPath];
    assert.equal(countExecutedInCommand(`ls ${SCRIPT_FIXTURE.relPath}`, SCRIPT_FIXTURE, paths), 0);
    assert.equal(countExecutedInCommand(`cat ${SCRIPT_FIXTURE.relPath}`, SCRIPT_FIXTURE, paths), 0);
    assert.equal(countExecutedInCommand(`git diff ${SCRIPT_FIXTURE.relPath}`, SCRIPT_FIXTURE, paths), 0);
    assert.equal(countExecutedInCommand(`grep -n ${SCRIPT_FIXTURE.relPath} file`, SCRIPT_FIXTURE, paths), 0);
  });

  test("AC2: interpreter argument position counts as executed", () => {
    const paths = [SCRIPT_FIXTURE.relPath, SCRIPT_FIXTURE.realPath];
    assert.equal(countExecutedInCommand(`node ${SCRIPT_FIXTURE.relPath}`, SCRIPT_FIXTURE, paths), 1);
    assert.equal(countExecutedInCommand(`node --no-warnings --experimental-strip-types ${SCRIPT_FIXTURE.relPath} --json`, SCRIPT_FIXTURE, paths), 1);
    assert.equal(countExecutedInCommand(`cd /home/yale/work/quay-worktrees/x && node ${SCRIPT_FIXTURE.relPath}`, SCRIPT_FIXTURE, paths), 1);
    // env-prefix assignments before the program (REFUTE finding 2)
    assert.equal(countExecutedInCommand(`FOO=1 BAR=2 node ${SCRIPT_FIXTURE.relPath}`, SCRIPT_FIXTURE, paths), 1);
    assert.equal(countExecutedInCommand(`QUAY_TEST_LIVE_GITHUB=1 bash scripts/test.sh`, { relPath: "scripts/test.sh", realPath: "scripts/test.sh", basename: "test.sh", aliases: [] }, ["scripts/test.sh"]), 1);
  });

  test("REFUTE: `bash -e` (errexit) is not inline code; only `bash -c` is", () => {
    const sh = { relPath: "scripts/test.sh", realPath: "scripts/test.sh", basename: "test.sh", aliases: [] };
    const paths = [sh.relPath];
    assert.equal(countExecutedInCommand("bash -e scripts/test.sh", sh, paths), 1, "bash -e still executes the script");
    assert.equal(countExecutedInCommand("bash -x scripts/test.sh", sh, paths), 1);
    assert.equal(countExecutedInCommand("bash -c 'echo hi' scripts/test.sh", sh, paths), 0, "bash -c code is inline");
    // node -e is inline code, so a trailing path is an arg to the eval, not an execution
    const fixt = [SCRIPT_FIXTURE.relPath];
    assert.equal(countExecutedInCommand(`node -e 'x' ${SCRIPT_FIXTURE.relPath}`, SCRIPT_FIXTURE, fixt), 0);
  });

  test("AC2: `bash script.sh` and direct `./script.sh` count", () => {
    const sh = { relPath: "scripts/test.sh", realPath: "scripts/test.sh", basename: "test.sh", aliases: [] };
    const paths = [sh.relPath, sh.realPath];
    assert.equal(countExecutedInCommand("bash scripts/test.sh", sh, paths), 1);
    assert.equal(countExecutedInCommand("bash scripts/test.sh --for-task x --allow-thin", sh, paths), 1);
    assert.equal(countExecutedInCommand("cd /home/yale/work/quay && bash scripts/test.sh", sh, paths), 1);
    // quoted mention is NOT execution
    assert.equal(countExecutedInCommand("echo 'running scripts/test.sh'", sh, paths), 0);
  });

  test("AC2: inline-code flags (`node -e` / `bash -c`) do not count the following args", () => {
    const paths = [SCRIPT_FIXTURE.relPath, SCRIPT_FIXTURE.realPath];
    assert.equal(countExecutedInCommand(`node -e 'code' ${SCRIPT_FIXTURE.relPath}`, SCRIPT_FIXTURE, paths), 0);
    assert.equal(countExecutedInCommand("bash -c 'echo hi' scripts/test.sh", { relPath: "scripts/test.sh", realPath: "scripts/test.sh", basename: "test.sh", aliases: [] }, ["scripts/test.sh"]), 0);
  });

  test("AC2: command-substitution segment is its own command", () => {
    const sh = { relPath: "scripts/test.sh", realPath: "scripts/test.sh", basename: "test.sh", aliases: [] };
    const paths = [sh.relPath];
    assert.equal(countExecutedInCommand("echo $(bash scripts/test.sh)", sh, paths), 1);
  });

  // ── stripQuotedContent / splitCommandSegments ───────────────────────────────────────────────
  test("stripQuotedContent removes single, double and backtick quotes", () => {
    assert.equal(stripQuotedContent("grep 'foo.ts' bar"), "grep  bar");
    assert.equal(stripQuotedContent('echo "a b" c'), "echo  c");
    assert.equal(stripQuotedContent("echo `ls` x"), "echo  x");
    assert.equal(stripQuotedContent("echo 'don\\'t'"), "echo "); // escaped quote inside
  });

  test("splitCommandSegments splits on ; && | ( ) and newline", () => {
    const segs = splitCommandSegments("node a.ts && bash b.sh | cat c.sh; (node d.ts)\necho x");
    assert.ok(segs.length >= 5);
    assert.deepEqual(segs[0], ["node", "a.ts"]);
    assert.deepEqual(segs[1], ["bash", "b.sh"]);
  });

  // ── AC3: import/require statement parsing ───────────────────────────────────────────────────
  test("AC3: import/require statement specifiers are parsed, comments are stripped", () => {
    const src = [
      `import { a } from "./x.ts";`,
      `import type { B } from "./y.ts";`,
      `const c = await import("./z.mjs");`,
      `const d = require("./w.cjs");`,
      `// import { bogus } from "./commented.ts";`,
      `/* import { bogus2 } from "./block-commented.ts"; */`,
    ].join("\n");
    const specs = extractModuleSpecifiers(src);
    assert.ok(specs.includes("./x.ts"));
    assert.ok(specs.includes("./y.ts"));
    assert.ok(specs.includes("./z.mjs"));
    assert.ok(specs.includes("./w.cjs"));
    assert.ok(!specs.includes("./commented.ts"));
    assert.ok(!specs.includes("./block-commented.ts"));
  });

  test("AC3: bare substring mention is not an import", () => {
    const src = `// see "./x.ts" for details\nconst s = "import from ./x.ts";`;
    const specs = extractModuleSpecifiers(src);
    assert.deepEqual(specs, []);
  });

  // ── AC1: full-set coverage ──────────────────────────────────────────────────────────────────
  test("AC1: enumeration covers every script and the total is self-consistent", () => {
    const { scripts, rawEntries } = enumerateScripts(REPO_ROOT);
    // Floor was 200 before the prepare/execute pipeline retirement (ADR-022 /
    // gap-retire-the-prepare-execute-pipeline-cluster) deleted ~22 scripts from the tree; the floor
    // is a sanity bound, not a hard target, so it is lowered with generous headroom (~183 live).
    assert.ok(scripts.length >= 170, `expected >=170 scripts, got ${scripts.length}`);
    assert.ok(scripts.length <= rawEntries, "raw entries must be >= distinct scripts");
    // every entry has the fields classification needs
    for (const s of scripts) {
      assert.ok(s.relPath && s.basename && s.realPath, "every script has relPath/basename/realPath");
      assert.ok(["plugin-scripts", "experiments-scripts", "workflows", "scripts"].includes(s.category));
    }
  });

  // ── AC5: dormant-by-decision is explicit and never path-prefix-inferred ────────────────────
  test("AC5: dormant-by-decision list is explicit, source-cited, includes the AC4 negative control", () => {
    assert.ok(DORMANT_BY_DECISION.length >= 10, "explicit seal list present");
    assert.ok(
      DORMANT_BY_DECISION.includes("experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts"),
      "chart2-s1-distribution-reliability.ts is on the explicit seal list",
    );
    // the list must not be built by prefix: every entry is an exact path
    for (const p of DORMANT_BY_DECISION) {
      assert.ok(!p.includes("*"), "no glob wildcards in the seal list");
      assert.ok(p.endsWith(".ts") || p.endsWith(".sh"), "seal list entries are scripts");
    }
  });

  // ── AC6: never-runs-test (canonical-glob exclusion) ────────────────────────────────────────
  test("AC6: canonical test glob is the scripts/test.sh glob (ADR-019)", () => {
    assert.deepEqual(TEST_GLOB_PATTERNS, [
      "packages/*/test/*.test.mjs",
      "plugin/test/*.test.mjs",
      "experiments/quay-perpetual-stream/test/*.test.mjs",
    ]);
    assert.equal(inTestGlob("plugin/test/runtime-usage-inventory.test.mjs"), true);
    assert.equal(inTestGlob("experiments/quay-perpetual-stream/scripts/anti-gaming-guard.test.ts"), false);
    assert.equal(inTestGlob("scripts/delivery-manifest-check.test.ts"), false);
    assert.equal(globMatch("packages/*/test/*.test.mjs", "packages/quay/test/gate.test.mjs"), true);
    assert.equal(globMatch("packages/*/test/*.test.mjs", "packages/quay/scripts/x.test.mjs"), false);
  });

  // ── classifyScript six-way ─────────────────────────────────────────────────────────────────
  test("classifyScript: six mechanical classes, correct priority", () => {
    assert.equal(classifyScript(1, 0, 0, "x.ts", false, false), "live");
    assert.equal(classifyScript(0, 1, 0, "x.ts", false, false), "library");
    assert.equal(classifyScript(0, 0, 1, "x.sh", false, false), "ci-only");
    assert.equal(classifyScript(0, 0, 0, "experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts", false, false), "dormant-by-decision");
    assert.equal(classifyScript(0, 0, 0, "experiments/quay-perpetual-stream/scripts/anti-gaming-guard.test.ts", true, false), "never-runs-test");
    assert.equal(classifyScript(0, 0, 0, "some/where/unaccounted.ts", false, false), "unaccounted");
  });

  // ── AC7 + AC4: end-to-end buildInventory over a SYNTHETIC transcript dir ────────────────────
  test("AC7: buildInventory computes the main→long diff (low-frequency ≠ dead)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rui-test-"));
    _tmpDirs.push(tmp);
    const root = path.join(tmp, "repo");
    // Minimal repo: two scripts, one workflow, one dormant.
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "experiments", "quay-perpetual-stream", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, ".claude", "workflows"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "hot.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(root, "plugin", "scripts", "cold.ts"), "export const b = 2;\n");
    fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/usr/bin/env bash\nbash plugin/scripts/hot.ts\n");
    fs.writeFileSync(path.join(root, ".claude", "workflows", "execute-milestone.js"), "// wf\n");
    // the sealed meter lives in the experiments scripts dir (matches DORMANT_BY_DECISION's path)
    fs.writeFileSync(path.join(root, "experiments", "quay-perpetual-stream", "scripts", "chart2-s1-distribution-reliability.ts"), "export const c = 3;\n");
    // sessions dir with a synthetic inner transcript
    const sessions = path.join(tmp, "sessions");
    const sid = "inner-session";
    fs.mkdirSync(path.join(sessions, sid, "subagents"), { recursive: true });
    const inner = [];
    const t0 = "2026-08-02T12:00:00.000Z";
    inner.push(JSON.stringify({ timestamp: t0, type: "assistant", message: { content: [
      { type: "tool_use", name: "Bash", input: { command: "bash scripts/test.sh" } },
      { type: "tool_use", name: "Bash", input: { command: "grep 'plugin/scripts/cold.ts' README" } },
      { type: "tool_use", name: "Bash", input: { command: "ls plugin/scripts/chart2-s1-distribution-reliability.ts" } },
    ] } }));
    fs.writeFileSync(path.join(sessions, sid + ".jsonl"), inner.join("\n") + "\n");
    // a "classic" pre-window session that ran the workflow (long-window evidence)
    fs.mkdirSync(path.join(sessions, "classic-session", "subagents"), { recursive: true });
    const classic = [];
    classic.push(JSON.stringify({ timestamp: "2026-08-01T12:00:00.000Z", type: "assistant", message: { content: [
      { type: "tool_use", name: "Workflow", input: { scriptPath: "/home/yale/work/quay/.claude/workflows/execute-milestone.js" } },
    ] } }));
    fs.writeFileSync(path.join(sessions, "classic-session.jsonl"), classic.join("\n") + "\n");

    const inv = buildInventory(root, sessions, "2026-08-02T11:00:00Z", "2026-08-03T02:54:00Z", 72, {
      innerSessions: new Set([sid]),
    });
    const byRel = new Map(inv.scripts.map((s) => [s.relPath, s]));
    // hot.ts: executed in main → live
    assert.equal(byRel.get("plugin/scripts/hot.ts").class, "live");
    // cold.ts: only mentioned in `grep '...'` → never-runs? no → unaccounted in main
    assert.equal(byRel.get("plugin/scripts/cold.ts").main.executed, 0);
    // chart2-s1: sealed, not executed → dormant-by-decision
    assert.equal(byRel.get("experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts").class, "dormant-by-decision");
    // scripts/test.sh: executed in main → live (AC4 positive control on fixture)
    assert.equal(byRel.get("scripts/test.sh").class, "live");
    // workflow: unaccounted in main, executed in long → appears in the diff
    const wf = byRel.get(".claude/workflows/execute-milestone.js");
    assert.equal(wf.main.executed, 0);
    assert.ok(wf.long.executed > 0, "workflow executed in the long window");
    assert.ok(inv.summary.diffMainToLong.some((d) => d.script === ".claude/workflows/execute-milestone.js"));
  });

  test("REFUTE: wrapper-indirect honors gate_delegate_ts and ignores echo mentions", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rui-wrap-"));
    _tmpDirs.push(tmp);
    const root = path.join(tmp, "repo");
    fs.mkdirSync(path.join(root, "experiments", "quay-perpetual-stream", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    // A gate wrapper that delegates via gate_delegate_ts (live in transcript) → target .ts is live
    fs.writeFileSync(
      path.join(root, "experiments", "quay-perpetual-stream", "scripts", "gate-script-lib.sh"),
      'gate_delegate_ts() { node "$(dirname "$0")/$1" "$@"; }\n',
    );
    fs.writeFileSync(
      path.join(root, "experiments", "quay-perpetual-stream", "scripts", "it0-real-check.sh"),
      'source "$(dirname "$0")/gate-script-lib.sh"\ngate_delegate_ts "it0-real-check.ts" 2 "<usage>" "$@"\necho "this wrapper also mentions node it0-echo-mention.ts when run"\n',
    );
    fs.writeFileSync(path.join(root, "experiments", "quay-perpetual-stream", "scripts", "it0-real-check.ts"), "export const r = 1;\n");
    fs.writeFileSync(path.join(root, "experiments", "quay-perpetual-stream", "scripts", "it0-echo-mention.ts"), "export const e = 1;\n");
    // sessions: run the wrapper
    const sessions = path.join(tmp, "sessions");
    const sid = "inner";
    fs.mkdirSync(path.join(sessions, sid, "subagents"), { recursive: true });
    fs.writeFileSync(path.join(sessions, sid + ".jsonl"), JSON.stringify({ timestamp: "2026-08-02T12:00:00.000Z", type: "assistant", message: { content: [
      { type: "tool_use", name: "Bash", input: { command: "bash experiments/quay-perpetual-stream/scripts/it0-real-check.sh" } },
    ] } }) + "\n");

    const inv = buildInventory(root, sessions, "2026-08-02T11:00:00Z", "2026-08-03T02:54:00Z", 72, { innerSessions: new Set([sid]) });
    const byRel = new Map(inv.scripts.map((s) => [s.relPath, s]));
    const target = byRel.get("experiments/quay-perpetual-stream/scripts/it0-real-check.ts");
    assert.ok(target, "gate-delegated .ts enumerated");
    assert.ok(target.main.indirectExec, "gate_delegate_ts target is marked indirect-executed");
    assert.equal(target.class, "live", "gate_delegate_ts target is live");
    const mention = byRel.get("experiments/quay-perpetual-stream/scripts/it0-echo-mention.ts");
    assert.ok(mention, "echo-mentioned .ts enumerated");
    assert.equal(mention.main.indirectExec, false, "echo mention is NOT indirect-executed (REFUTE finding 1)");
    assert.notEqual(mention.class, "live");
  });

  // ── Instrument manifest (gap-eighty-one-instruments...) ──────────────────────────────────────
  // The entry-point directory is DERIVED from the filesystem (never a hardcoded "81"), and the
  // admission filter (AC4: cannot say what question it answers => does not get in) is mechanical.
  test("extractHeaderComment: block comments, // runs, and # runs (shebang-safe)", () => {
    assert.equal(extractHeaderComment("/* a\n b */\ncode"), " a\n b "); // block interior preserved as-is
    assert.equal(extractHeaderComment("// one\n// two\n\ncode\n"), "one\ntwo");
    assert.equal(extractHeaderComment("#!/usr/bin/env bash\n# a comment\necho hi\n"), "/usr/bin/env bash\na comment");
    assert.equal(extractHeaderComment("export const a = 1;\n"), "");
  });

  test("extractInstrumentDeclaration: @instrument tag wins; em-dash header derived; silent => null", () => {
    assert.equal(
      extractInstrumentDeclaration("// foo.ts — a derived description.\nexport const a = 1;\n", "foo.ts"),
      "a derived description."
    );
    assert.equal(
      extractInstrumentDeclaration('// foo.ts\n// @instrument "answers the foo question"\nexport const a = 1;\n', "foo.ts"),
      "answers the foo question"
    );
    assert.equal(extractInstrumentDeclaration("#!/usr/bin/env bash\necho hi\n", "x.sh"), null);
    assert.equal(extractInstrumentDeclaration("export const a = 1;\n", "bar.ts"), null);
  });

  test("buildInstrumentsManifest: derived count + visible admission filter", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rui-instr-"));
    _tmpDirs.push(tmp);
    const root = path.join(tmp, "repo");
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "alpha.ts"), "// alpha.ts — answers the alpha question.\nexport const a = 1;\n");
    fs.writeFileSync(path.join(root, "plugin", "scripts", "beta.sh"), "#!/usr/bin/env bash\n# @instrument \"echoes beta\"\necho beta\n");
    fs.writeFileSync(path.join(root, "plugin", "scripts", "gamma.ts"), "export const g = 1;\n"); // silent -> not admitted
    fs.writeFileSync(path.join(root, "plugin", "scripts", "tsconfig.json"), "{}"); // non-script -> excluded
    const m = buildInstrumentsManifest(root);
    assert.equal(m.total, 3); // alpha.ts + beta.sh + gamma.ts (tsconfig.json is not a script)
    assert.equal(m.admitted, 2);
    assert.deepEqual(m.notAdmitted, ["plugin/scripts/gamma.ts"]);
    const alpha = m.instruments.find((i) => i.name === "alpha");
    assert.ok(alpha, "alpha is admitted");
    assert.equal(alpha.description, "answers the alpha question.");
    assert.equal(alpha.kind, "node");
    const beta = m.instruments.find((i) => i.name === "beta");
    assert.equal(beta.kind, "bash");
    // derived, not hardcoded: the real repo's plugin/scripts is enumerated by the same code path
    const real = buildInstrumentsManifest(REPO_ROOT);
    assert.ok(real.total >= 70, `real plugin/scripts instrument count is derived (>=70 floor), got ${real.total}`);
  });

  // ── AC4: real-transcript bidirectional control (skips if the sessions dir is absent) ────────
  test("AC4: real transcripts — scripts/test.sh is live; chart2-s1 is NOT live", { timeout: 120_000 }, (t) => {
    const sessionsDir = path.join(os.homedir(), ".claude", "projects", "-home-yale-work-quay");
    if (!fs.existsSync(sessionsDir)) {
      t.skip("real sessions dir not present");
      return;
    }
    const inv = buildInventory(
      REPO_ROOT,
      sessionsDir,
      "2026-08-02T11:00:00Z",
      "2026-08-03T02:54:00Z",
      72,
      { innerSessions: new Set([
        "3bbd3095-de01-467c-8c6e-abb00f342e53",
        "82ecfb6a-94ba-462d-ac8d-dfa0984e6dbf",
        "47eb704e-a8a7-4e2f-9ad6-e419f4dc51eb",
      ]) },
    );
    const byRel = new Map(inv.scripts.map((s) => [s.relPath, s]));
    const testSh = byRel.get("scripts/test.sh");
    assert.ok(testSh, "scripts/test.sh enumerated");
    assert.equal(testSh.class, "live", "scripts/test.sh must be live (AC4 positive control)");
    assert.ok(testSh.main.executed > 0, `scripts/test.sh executed ${testSh.main.executed}x`);
    const chart2 = byRel.get("experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts");
    assert.ok(chart2, "chart2-s1 enumerated");
    assert.notEqual(chart2.class, "live", "chart2-s1 must NOT be live (AC4 negative control)");
    assert.equal(chart2.main.executed, 0, "chart2-s1 executed 0x in the window");
    // AC6: at least 4 never-runs-test experiments .test.ts files
    const nrt = inv.summary.neverRunsTest.filter((p) => p.includes("experiments") && p.endsWith(".test.ts"));
    assert.ok(nrt.length >= 4, `expected >=4 experiments .test.ts never-runs-test, got ${nrt.length}`);
  });
}
