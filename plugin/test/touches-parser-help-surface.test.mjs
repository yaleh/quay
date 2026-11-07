// @test-group engine
// touches-parser-help-surface.test.mjs — task gap-touches-parser-a-self-describing (AC1).
//
// THE GAP THIS TEST CLOSES: an agent learned the three `## Touches` rules (s3-7 annotation strip,
// sa5b-3 section selection, sa5b-4 label recognition) only by reading source or by hitting a
// rejection — `quay task create --help` carried NO Touches grammar at all, and `diagnoseTouches`
// codes were unnameable from the product surface.
//
// AC1 (CROSS-LAYER): run the REAL CLI (`node packages/quay/bin/quay.js task create --help`) and
// parse its STDOUT for `touches-<name> [problem|reading]`. The 7 codes read back must equal, item
// by item, the union of the two kernel tables — code AND kind AND rule AND meaning.
//
// ⛔ WHAT THIS TEST MUST NOT DO (the AC says so in words): import the tables and compare them to
// themselves. The assertion below only ever compares the TABLE (the authority) against PARSED
// STDOUT (a product surface produced by a separate process) — a help block that stops rendering a
// code, renders it under the wrong kind, or drifts from the table's wording reddens here, and no
// amount of internal consistency can hide it.
//
// Run:
//   node --test plugin/test/touches-parser-help-surface.test.mjs
//   scripts/test.sh plugin/test/touches-parser-help-surface.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { TOUCHES_PROBLEM_CODES, TOUCHES_READING_CODES, TOUCHES_JUDGEMENT_CODES } from "../../packages/quay/src/kernel/touches-annotation.ts";
// The promotion face (AC2). The fixture helpers are the ready-pool shards' ONE shared harness —
// ⛔ no fixture is re-declared here.
import { analyzeTasks, applyPromotions, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, os, parseTask, writeTask } from "./helpers/ready-pool-check-harness.mjs";
import { checkTouchesNotOverbroad } from "../scripts/ready-pool-check.ts";
import { checkTaskOneEntryOnePath, readOneEntryBaseline } from "../scripts/touches-one-entry-one-path-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_SHIM = path.join(REPO_ROOT, "packages", "quay", "bin", "quay.js");

/** Run the real CLI's create help once; every assertion below reads THIS stdout. */
function realCreateHelp() {
  const r = spawnSync(process.execPath, [CLI_SHIM, "task", "create", "--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(r.error, undefined, `spawning the real CLI failed: ${r.error}`);
  assert.equal(r.status, 0, `quay task create --help must exit 0 (stderr: ${r.stderr})`);
  assert.ok(r.stdout.length > 0, "quay task create --help must print to stdout");
  return r.stdout;
}

/** Parse `code [problem|reading]` pairs out of raw help stdout — no knowledge of the tables. */
function parseCodesFromHelp(stdout) {
  const out = [];
  const re = /\b(touches-[a-z-]+)\s+\[(problem|reading)\]/g;
  let m;
  while ((m = re.exec(stdout)) !== null) out.push({ code: m[1], kind: m[2] });
  return out;
}

const stdout = realCreateHelp();
const parsed = parseCodesFromHelp(stdout);

test("AC1: the real `task create --help` stdout carries exactly the 7 codes of the two tables, item by item", () => {
  const expected = [
    ...TOUCHES_PROBLEM_CODES.map((r) => ({ code: r.code, kind: "problem" })),
    ...TOUCHES_READING_CODES.map((r) => ({ code: r.code, kind: "reading" })),
  ];

  // (a) EXACT SET EQUALITY, item by item — not "all expected are present" (an extra code that no
  //     table declares is a second, drifted naming point, and a subset check would wave it through).
  const expectedCodes = expected.map((e) => e.code).sort();
  const parsedCodes = parsed.map((p) => p.code).sort();
  assert.deepEqual(parsedCodes, expectedCodes, `help stdout codes ${JSON.stringify(parsedCodes)} != table union ${JSON.stringify(expectedCodes)}`);

  // (b) each code appears ONCE and under the kind its table declares.
  const seen = new Set();
  for (const p of parsed) {
    assert.ok(!seen.has(p.code), `${p.code} rendered more than once in the help surface`);
    seen.add(p.code);
    const want = expected.find((e) => e.code === p.code);
    assert.equal(p.kind, want.kind, `${p.code} rendered as [${p.kind}], table declares [${want.kind}]`);
  }
  assert.equal(parsed.length, 7, "AC1 names 7 codes");
});

test("AC1: each rendered line also carries its rule id and the table's meaning verbatim", () => {
  const lines = stdout.split("\n");
  for (const row of [...TOUCHES_PROBLEM_CODES, ...TOUCHES_READING_CODES]) {
    const line = lines.find((l) => l.includes(row.code));
    assert.ok(line, `${row.code} has no rendered line`);
    assert.ok(line.includes(`rule ${row.rule}`), `${row.code}'s line must name rule ${row.rule}: ${line}`);
    assert.ok(line.includes(row.meaning), `${row.code}'s line must carry the table meaning (the help is DERIVED; a hand-written second copy drifts): ${line}`);
  }
});

test("AC1 negative control: the parser would NOTICE a help surface that lost a code", () => {
  // The extractor above is the measuring instrument; prove it can read a FAILING surface, otherwise
  // "7 codes found" is indistinguishable from "the regex matches everything" (硬规则 4).
  const crippled = stdout.replace(/touches-label-delete\s+\[reading\]/, "label delete (rendered without its code)");
  const codes = parseCodesFromHelp(crippled).map((c) => c.code);
  assert.ok(!codes.includes("touches-label-delete"), "the extractor must not find a code that the surface does not render");
  assert.equal(codes.length, 6);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// task gap-touches-judgement-codes-author-surface — the JUDGEMENT codes on the author surface.
//
// THE GAP: `touches-overbroad` lived only in `task-schema-check` / `prepare-admission-check` and
// `touches-multi-path-bullet` only appeared as a promotion-rejection reason. Neither was nameable
// from any surface an author reads, so the DSI triage's Q2 ("what happens if I write `src/*`?") had
// no answer that came from a product artifact. The two codes now come from ONE kernel table
// (`TOUCHES_JUDGEMENT_CODES`) that `quay task create --help` RENDERS and that the promotion gate
// emits by reference — this section pins both halves, plus the negative arms.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Parse `code [judgement]` pairs out of raw help stdout — independent of the registry. */
function parseJudgementCodesFromHelp(text) {
  const out = [];
  const re = /\b(touches-[a-z-]+)\s+\[judgement\]/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

test("AC1 (judgement): the real `task create --help` stdout carries EXACTLY the registry's judgement codes, item by item", () => {
  const expected = TOUCHES_JUDGEMENT_CODES.map((r) => r.code).sort();
  const parsed = parseJudgementCodesFromHelp(stdout).sort();

  assert.deepEqual(
    parsed,
    expected,
    `help stdout judgement codes ${JSON.stringify(parsed)} != registry ${JSON.stringify(expected)}`,
  );
  // Named explicitly — the two codes the task is about, so a rename in the registry still reddens.
  assert.ok(parsed.includes("touches-overbroad"), "`touches-overbroad` must be nameable from --help");
  assert.ok(parsed.includes("touches-multi-path-bullet"), "`touches-multi-path-bullet` must be nameable from --help");

  // Each rendered line carries its rule id and the registry meaning verbatim (the help is DERIVED;
  // a hand-written second copy drifts).
  const lines = stdout.split("\n");
  for (const row of TOUCHES_JUDGEMENT_CODES) {
    const line = lines.find((l) => l.includes(row.code));
    assert.ok(line, `${row.code} has no rendered line in --help`);
    assert.ok(line.includes(`[judgement]`), `${row.code} must render under the [judgement] kind (it is not a parser diagnostic): ${line}`);
    assert.ok(line.includes(`rule ${row.rule}`), `${row.code}'s line must name rule ${row.rule}: ${line}`);
    assert.ok(line.includes(row.meaning), `${row.code}'s line must carry the registry meaning verbatim: ${line}`);
  }
});

test("AC1 (judgement) negative control: erasing one judgement code from stdout leaves the extractor reading N−1", () => {
  // 硬规则 4: an extractor that cannot read a FAILING surface makes "N codes found" identical to
  // "the regex matches everything". Erase one row from the SAME real stdout and re-extract.
  const n = parseJudgementCodesFromHelp(stdout).length;
  assert.ok(n >= 2, `the surface must render at least the two named codes (saw ${n})`);
  const crippled = stdout.replace(/touches-overbroad\s+\[judgement\]/, "overbroad (rendered without its code)");
  assert.notEqual(crippled, stdout, "the negative control must actually have altered the surface");
  const after = parseJudgementCodesFromHelp(crippled);
  assert.equal(after.length, n - 1, "the extractor must read exactly one fewer code");
  assert.ok(!after.includes("touches-overbroad"), "the erased code must not be found");
});

// ── AC2: the ready-pool / promotion face ─────────────────────────────────────────────────────────

test("AC2: `src/*` is overbroad, `packages/quay/**` and an exact path are NOT; no section = NOT-EVALUATED", () => {
  const flagged = (touches) => checkTouchesNotOverbroad(`## Touches\n${touches}\n`);

  // POSITIVE arm — the Q2 shape the task exists for.
  const ob = flagged("- src/*");
  assert.equal(ob.length, 1, "`src/*` must be judged overbroad");
  assert.equal(ob[0].code, "touches-overbroad", "the stable code must be emitted");
  assert.match(ob[0].what, /src\/\*/, "the detail must name the offending entry");

  // NEGATIVE arms — a ≥2-concrete-segment-anchored glob, and an exact path.
  assert.deepEqual(flagged("- packages/quay/**"), [], "`packages/quay/**` is anchored 2 segments deep ⇒ NOT overbroad");
  assert.deepEqual(flagged("- packages/quay/src/gate/*.js"), [], "a deeper-anchored glob ⇒ NOT overbroad");
  assert.deepEqual(flagged("- tasks/some-task.md"), [], "an exact path ⇒ NOT overbroad");
  assert.deepEqual(flagged("- packages/quay/src/gate/engine.js"), [], "an exact deep path ⇒ NOT overbroad");

  // NOT-EVALUATED (硬规则 3b) — "no declaration" must not share a shape with "judged clean".
  assert.deepEqual(checkTouchesNotOverbroad("## Proposal\nno touches here\n"), [],
    "a body with no ## Touches yields no rows (the empty array is NOT-EVALUATED here — the caller distinguishes it by hasSection)");
});

test("AC2 multi-path negative arm: prose separators are NOT overbroad and NOT multi-path", () => {
  // The two judgement codes are siblings on ONE surface; a prose bullet carrying 、/，/ / must trip
  // neither (the multi-path judge requires ≥2 PATH-like tokens — prose tokens never count).
  const prose = "## Touches\n- 证据：三处修复、两处回归，见 12:22:04/07/10 的读数\n";
  assert.deepEqual(checkTouchesNotOverbroad(prose), [], "prose is not an overbroad declaration");
  assert.deepEqual(checkTaskOneEntryOnePath(prose, "tasks/prose-fixture.md", new Set()), [],
    "prose separators must not be reported as a multi-path bullet");
});

test("AC2: the multi-path grandfather baseline still suppresses every file it lists (count reported)", (t) => {
  const { baseline, baselineCount } = readOneEntryBaseline(REPO_ROOT);
  let suppressed = 0;
  let wouldFlag = 0;
  for (const rel of baseline) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const body = fs.readFileSync(abs, "utf8");
    // Same judge, with the baseline REMOVED: what the checker would say without grandfathering.
    if (checkTaskOneEntryOnePath(body, rel, new Set()).length > 0) wouldFlag++;
    // Same judge, WITH the baseline: the suppression must hold for every listed file.
    assert.deepEqual(checkTaskOneEntryOnePath(body, rel, baseline), [],
      `baseline-listed ${rel} must be suppressed by the grandfather list`);
    suppressed++;
  }
  t.diagnostic(`multi-path baseline: baseline-count header=${baselineCount}, listed+present=${suppressed}, suppressed multi-path hits=${wouldFlag}`);
  assert.ok(wouldFlag >= 1,
    "the shrink-only baseline must still be suppressing REAL multi-path hits — zero would mean the list is dead weight (or the judge stopped firing)");
});

test("AC2: `analyzeTasks` puts `touches-overbroad` on the candidate — and NOT on `packages/quay/**` or an exact path", (t) => {
  const root = makeWorkspace("touches-judgement");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "real.ts"), "export const real = 1;\n");
  // Three otherwise-identical todo candidates; only the Touches declaration differs.
  writeTask(root, "gap-ob", gapTask("gap-ob", { touches: ["- src/*"] }));
  writeTask(root, "gap-anchored", gapTask("gap-anchored", { touches: ["- packages/quay/**", "- packages/quay/src/gate/*.js"] }));
  writeTask(root, "gap-exact", gapTask("gap-exact", { touches: ["- plugin/scripts/ready-pool-check.ts"] }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const byId = new Map(r.candidates.map((c) => [c.id, c]));

  const ob = byId.get("gap-ob");
  assert.ok(ob, "the overbroad candidate must be reported (a refusal is a visible outcome, 硬规则 3b)");
  assert.equal(ob.eligible, false, "an overbroad Touches candidate must not be promotion-eligible");
  assert.ok(Array.isArray(ob.touchesJudgement) && ob.touchesJudgement.length === 1,
    `the candidate must carry the NAMED judgement row (got ${JSON.stringify(ob.touchesJudgement)})`);
  assert.equal(ob.touchesJudgement[0].code, "touches-overbroad", "the stable code must be the emitted one");
  assert.match(ob.touchesJudgement[0].what, /src\/\*/, "the detail must name the offending entry");

  // NEGATIVE ARMS — the ≥2-segment-anchored glob and the exact path must carry NO overbroad row.
  for (const id of ["gap-anchored", "gap-exact"]) {
    const c = byId.get(id);
    assert.ok(c, `${id} must be reported as a candidate`);
    assert.deepEqual(
      c.touchesJudgement.filter((x) => x.code === "touches-overbroad"),
      [],
      `${id} must NOT be reported as touches-overbroad (${JSON.stringify(c.touchesJudgement)})`,
    );
  }
});

test("AC2: applyPromotions refuses a `(new)`-tagged overbroad glob — the width rule's carve-out is closed", (t) => {
  // checkTouchesNarrow SKIPS `(new)`-tagged entries, so an overbroad `- src/* (new)` is
  // promotion-eligible and DOES reach the apply loop. The guard is therefore reachable (not a
  // structurally-never-true branch, 硬规则 4) — this is the arm that proves it.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-overbroad-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "real.ts"), "export const real = 1;\n");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-ob", gapTask("gap-ob", { touches: ["- src/* (new)"] }));
  git("add", ".");
  git("commit", "-q", "-m", "init");
  assert.equal(git("status", "--porcelain"), "", "baseline clean before promotion");

  const r = applyPromotions({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const rec = r.applied_promotions.find((x) => x.id === "gap-ob");
  assert.ok(rec, "the candidate must appear in applied_promotions (a refusal is a VISIBLE outcome, 硬规则 3b)");
  assert.equal(rec.ok, false, "an overbroad Touches candidate must NOT be promoted");
  assert.equal(rec.reason, "touches-overbroad", "the stable judgement code must be the reason");
  assert.equal(rec.committed, false, "blocked ⇒ never committed");
  assert.match(rec.detail, /src\/\*/, "the detail must name the offending glob");

  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-ob.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*todo$/m, "blocked candidate must remain todo on disk");
  assert.equal(git("status", "--porcelain"), "", "no write, no commit — the tree stays clean");
});
