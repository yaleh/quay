// @test-group lowconc
// ac249-complete-change-record.test.mjs — GOAL-016-AC-249 producer
// (gap-ac249-complete-change-code-doc-same-task-record).
//
// AC-249 asks for a record in `.quay/productization-verification.jsonl` proving that ONE task quay's
// drivers drove to done produced a COMPLETE change: its `commit_files` — **the union of every commit
// filed under that one task_id**, attributed BY POSITION (the `task/<id>` branch, the commits touching
// `tasks/<id>.md`, and those merges' right arms) — must carry BOTH a code path (`src/`|`scripts/`
// prefix) AND an ADR-007 doc path (contains `ADR-007` or starts with `docs/adr`). ONE SIDE ALONE DOES
// NOT COUNT.
//
// The defect this pins is NOT "a producer that never ran" — it is that the pre-existing selector
// `ac207_select_implementation_commit` returns **a single** "newest implementation commit". A task that
// splits its code fix and its doc sync into two commits is therefore seen as HALF a change in BOTH
// directions (pick the doc commit ⇒ the code predicate is false; pick the code commit ⇒ the doc
// predicate is false) — a structurally-unfalsifiable red on a fully qualified task (硬规则 4c: the
// quantity the criterion names cannot survive a "take only one" middle layer).
//
// What this file pins (the live cross-host run is AC4's job and is recorded in the task, not here):
//
//   ① CRITERION ↔ PRODUCER FIELD PARITY + NO LITERAL DEFAULTS: the goal's criterion filters carrier
//      lines on a fixed set of top-level fields and the producer is `write_ac249_record`; nothing
//      forces the two to stay in sync. The writer's body must carry no `build_sha` literal (the ONE
//      anchor choke point is `ac89_append_goal009`) and must not reach for the single-commit selector.
//   ② THE CRITERION TAKES ALL THREE OF ITS VALUES against the REAL extracted payload: exit 0 (a
//      qualifying record), exit 1 (a record failing ANY ONE filter — including both "one side alone"
//      shapes and the `./src/…` path form), exit 3 (carrier absent).
//   ③ THE UNION IS A UNION (AC2): against a REAL temp git repo whose code commit comes FIRST and
//      whose doc commit comes LAST, `ac249_union_files` yields BOTH sides while the pre-existing
//      single-commit selector picks only the doc commit — whose file list alone the writer REFUSES.
//      ⛔ Without this control a "newest commit only" implementation would pass every positive case.
//   ④ THE STEP IS POSITIONED on the union: `step_ac249_complete_change` must call the union helpers and
//      must NOT call the single-commit selector to build `commit_files`.
//
// Run:
//   node --test plugin/test/ac249-complete-change-record.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "verify-deliver-coldstart.sh");

/** The AC-249 goal file (name carries CJK, so match by prefix rather than by literal name). */
function goalFilePath() {
  const dir = path.join(REPO_ROOT, "goals");
  const hit = fs.readdirSync(dir).find((f) => f.startsWith("AC-249") && f.endsWith(".md"));
  assert.ok(hit, "goals/AC-249-*.md must exist — this test reads the criterion from it, never a copy");
  return path.join(dir, hit);
}

/** Extract the embedded `python3 - <<'P' … P` payload of the criterion block (the REAL judge).
 *
 *  ⚠️ The block is a YAML `>-` FOLDED scalar, so its semantics are NOT "join the lines": consecutive
 *  lines at the block's own indentation fold into ONE line separated by a space, blank lines become
 *  newlines, and MORE-indented lines keep their line breaks. A plain join reproduces source line
 *  breaks inside a `"…"` literal and yields a PYTHON SYNTAX ERROR — which exits 1 and therefore looks
 *  exactly like "the criterion ran and found no qualifying record" (measured on 2026-09-12 by the
 *  sibling AC-247 test). The folding is done here so the payload is what a YAML parser would hand to
 *  python. */
function foldBlockScalar(lines) {
  let out = "";
  let prev = ""; // "" | "blank" | "more" | "normal"
  for (const line of lines) {
    if (line.trim() === "") { out += "\n"; prev = "blank"; continue; }
    const moreIndented = /^[ \t]/.test(line);
    if (out === "") out += line;
    else if (prev === "blank") out += line;
    else if (moreIndented || prev === "more") out += "\n" + line;
    else out += " " + line;
    prev = moreIndented ? "more" : "normal";
  }
  return out.replace(/^\n+/, "");
}

function criterionPython() {
  const lines = fs.readFileSync(goalFilePath(), "utf8").split("\n");
  const start = lines.findIndex((l) => /^criterion:\s*>[-+]?\s*$/.test(l));
  assert.ok(start >= 0, "the goal must declare `criterion: >-`");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(lines[i])) { end = i; break; }
  }
  const block = lines.slice(start + 1, end).map((l) => (l.startsWith("  ") ? l.slice(2) : l));
  const folded = foldBlockScalar(block).split("\n");
  const hStart = folded.findIndex((l) => l.includes("python3 - <<"));
  assert.ok(hStart >= 0, "the criterion must embed `python3 - <<'P'`");
  let hEnd = folded.length;
  for (let i = hStart + 1; i < folded.length; i++) {
    if (/^P\s*$/.test(folded[i])) { hEnd = i; break; }
  }
  const py = folded.slice(hStart + 1, hEnd).join("\n");
  assert.ok(py.includes("GOAL-016-AC-249"), "the extracted criterion must be the AC-249 one");
  // A syntax error would make every assertion below meaningless (it exits non-zero for a reason that
  // has nothing to do with the record), so fail loudly instead of mis-reading it as a verdict.
  const chk = spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: py, encoding: "utf8" });
  assert.equal(chk.status, 0, `the extracted criterion must be valid python (folding bug?):\n${chk.stderr}\n---\n${py}`);
  return py;
}

/** Run the real criterion in a scratch dir; returns the spawnSync result.
 *
 *  ⚠️ The criterion resolves "本仓库" as `os.path.realpath(".")` **of its own cwd**, and "本机" as
 *  `socket.gethostname()`. Both are therefore properties of WHERE IT RUNS, not of the record — so the
 *  scratch dir stands in for the production root, and `makeLines` is handed that dir (plus the real
 *  hostname) to build the records it needs. Hard-coding `REPO_ROOT` here would make the
 *  "project_root ∈ 本仓库" filter untestable (it would never match) and the assertion vacuous. */
function runCriterion(py, makeLines) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ac249-crit-"));
  try {
    if (makeLines !== null) {
      const lines = makeLines({ here: fs.realpathSync(ws), hereRaw: ws, host: os.hostname() });
      fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
      fs.writeFileSync(path.join(ws, ".quay", "productization-verification.jsonl"),
        lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
    }
    const pyFile = path.join(ws, "criterion.py");
    fs.writeFileSync(pyFile, py);
    return spawnSync("python3", [pyFile], { cwd: ws, encoding: "utf8" });
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

/** Every top-level field name the criterion reads off a carrier record. */
function criterionFields(py) {
  const names = new Set();
  for (const m of py.matchAll(/r\.get\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)) names.add(m[1]);
  return [...names].sort();
}

function bashFunctionSource(src, name) {
  const i = src.indexOf(`${name}() {`);
  assert.ok(i >= 0, `${name} must exist in verify-deliver-coldstart.sh`);
  return src.slice(i, src.indexOf("\n}", i) + 2);
}

/** Extract a top-level single-quoted declaration verbatim. The choke point now reads AC_RECORD_SCHEMA,
 *  which lives OUTSIDE every function body, so a harness built from bodies alone leaves it unset and
 *  dies under `set -u` — again reading REFUSED for every input. Read from the product script, ⛔ never
 *  a copy pasted into the fixture: a second copy of the field list is the exact defect this pins. */
function bashDeclarationSource(src, name) {
  const start = src.indexOf(`\n${name}='`);
  assert.ok(start >= 0, `${name} must be a single-quoted top-level declaration in verify-deliver-coldstart.sh`);
  const end = src.indexOf("'\n", start + name.length + 3);
  assert.ok(end > start, `${name} must be a closed single-quoted scalar`);
  return src.slice(start + 1, end + 2);
}

function writerBody() {
  return bashFunctionSource(fs.readFileSync(SCRIPT, "utf8"), "write_ac249_record");
}

function stepBody() {
  return bashFunctionSource(fs.readFileSync(SCRIPT, "utf8"), "step_ac249_complete_change");
}

/** Drive a REAL product function (the union, or the writer) through bash — never a JS re-implementation
 *  of the judging logic (硬规则 4 推论三: a criterion only the fixture can satisfy is not under test). */
function runBash(fnNames, body, env = {}) {
  const src = fs.readFileSync(SCRIPT, "utf8");
  let harness = 'set -uo pipefail\nVC_NODE="${VC_NODE:-node}"\n';
  for (const fn of fnNames) harness += bashFunctionSource(src, fn) + "\n";
  harness += bashDeclarationSource(src, "AC_RECORD_SCHEMA") + "\n";
  harness += body + "\n";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac249-bash-"));
  try {
    const r = spawnSync("bash", ["-c", harness], {
      encoding: "utf8",
      env: { ...process.env, AC89: path.join(tmp, "carrier.jsonl"),
        BUILD_SHA: "0123456789abcdef0123456789abcdef01234567", TS: "2026-09-12T00:00:00Z", ...env },
    });
    const carrierPath = path.join(tmp, "carrier.jsonl");
    const lines = fs.existsSync(carrierPath)
      ? fs.readFileSync(carrierPath, "utf8").trim().split("\n").filter(Boolean)
      : [];
    return { stdout: r.stdout, stderr: r.stderr, status: r.status, lines };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const UNION_FNS = ["ac207_commit_files", "ac207_select_implementation_commit", "ac207_is_bookkeeping_commit",
  "ac249_is_code_path", "ac249_is_adr_doc_path", "ac249_union_commit_shas", "ac249_union_files"];

/** The REST of the write path's transitive closure, i.e. everything `ac89_append_goal009` reaches for.
 *
 *  ⚠️ `runBash` materializes a function list BY HAND, so it is a hand-maintained model of the writer's
 *  dependency graph and goes stale the moment that graph grows: since
 *  gap-ac-record-schema-duplicated-between-criterion-and-writer, `ac89_append_goal009` (the ONE anchor
 *  choke point) also enforces `AC_RECORD_SCHEMA` at production time. Left unlisted, the extracted
 *  writer dies with `ac_record_schema_validate_fragment: command not found` ⇒ non-zero ⇒ `|| return 1`
 *  ⇒ the verdict reads REFUSED **for every input**. That failure mode is the dangerous direction: it
 *  turns ③/④'s negative controls vacuously green (they assert REFUSED) while only the positive
 *  controls — "the union must be accepted" — go red. Listed here so the refusal under test is the
 *  product's real verdict, not a missing-symbol artifact. */
const WRITE_PATH_FNS = ["ac_record_schema_validate_fragment", "ac_record_fragment_ac",
  "ac_record_carrier_root", "ac_record_finalize"];

// Every temp dir this file creates is registered here and removed by ONE `after()` hook — the
// static isolation check (R6 mkdtemp-no-cleanup) traces mkdtemp results to a cleanup path, and a
// value RETURNED inside an object literal is not traceable; the documented carrier-array pattern
// (`_createdDirs` + `after(() => … rmSync)`) is.
const TMP_DIRS = [];
after(() => { for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true }); });

/** A real temp git repo: registration on develop, then a code commit FIRST and a doc commit LAST on
 *  `task/T-1` (the shape that makes a "newest commit only" selector see HALF a complete change). */
function makeRepo({ code = true, doc = true, dotSlash = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ac249-repo-"));
  TMP_DIRS.push(d);
  const git = (...a) => {
    const r = spawnSync("git", ["-C", d, ...a], { encoding: "utf8" });
    assert.equal(r.status, 0, `git ${a.join(" ")} failed: ${r.stderr}`);
  };
  git("init", "-q", "-b", "develop");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.mkdirSync(path.join(d, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(d, "tasks", "T-1.md"), "id: T-1\n");
  git("add", "-A"); git("commit", "-qm", "tasks: T-1 registration");
  git("checkout", "-q", "-b", "task/T-1");
  if (code) {
    fs.mkdirSync(path.join(d, "src"), { recursive: true });
    fs.writeFileSync(path.join(d, "src", "a.ts"), "code\n");
    git("add", "-A"); git("commit", "-qm", "fix: code side first");
  }
  if (doc) {
    fs.mkdirSync(path.join(d, "quay-adr"), { recursive: true });
    fs.writeFileSync(path.join(d, "quay-adr", "ADR-007.md"), "doc\n");
    git("add", "-A"); git("commit", "-qm", "docs: doc side last");
  }
  git("checkout", "-q", "develop");
  return { dir: d, git: (...a) => git(...a) };
}

/** The POST-FAN-IN shape: `merge --ff-only` the task branch into develop, then delete the branch —
 *  exactly what the reaper leaves behind. The implementation commits are still in develop's history,
 *  but they do NOT touch `tasks/T-1.md`, so the task-file-only anchors cannot see them; only the
 *  task-file EXISTENCE SPAN (registration → the driver's 翻-done bookkeeping commit) recovers them. */
function reapBranch(repo) {
  repo.git("checkout", "-q", "develop");
  repo.git("merge", "-q", "--ff-only", "task/T-1");
  repo.git("branch", "-D", "task/T-1");
}

/** The driver's landing bookkeeping commit — it TOUCHES the task file, so it is the span's right end. */
function finalize(repo, taskFile = "tasks/T-1.md") {
  fs.appendFileSync(path.join(repo.dir, taskFile), "\ndone\n");
  repo.git("add", "-A");
  repo.git("commit", "-qm", "tasks: 翻 T-1 done（driver 机械 fan-in）");
}

test("① the goal's criterion fields are ALL emitted by write_ac249_record (parity + negative control)", () => {
  const py = criterionPython();
  const fields = criterionFields(py);
  // The criterion reads exactly these five — no `commit_sha`, no `task_status`, no `build_sha`. The
  // anchor is still written (through the shared choke point), but this AC's judge does not filter on
  // it, and this list says so out loud.
  assert.deepEqual(fields, ["ac", "commit_files", "host", "project_root", "task_id"],
    "the criterion must read exactly these top-level fields — a change here is a change to the AC");

  const rawBody = writerBody();
  assert.ok(rawBody.includes("GOAL-016-AC-249"), "the writer must emit the ac value the criterion filters on");
  // The fragment is shell-escaped (`\"host\":\"$host\"`), so unescape before matching field names —
  // ⛔ otherwise every key misses and the loop fails for the wrong reason.
  const body = rawBody.replace(/\\"/g, '"');
  for (const f of fields) {
    if (f === "ac") continue;
    assert.ok(new RegExp(`"${f}"`).test(body),
      `the producer must emit top-level "${f}" — the criterion reads it, so a producer without it makes the AC unsatisfiable`);
  }
  // Negative control (硬规则 4: a量 that cannot take false is not a measurement).
  const mutated = body.replace('"commit_files"', '"commit_files_renamed"');
  assert.notEqual(mutated, body, "the negative control must actually change the fragment");
  assert.ok(!/"commit_files"/.test(mutated), "the negative control must remove the field the criterion reads");
});

test("①b the write path carries NO literal default and never reaches for the single-commit selector", () => {
  const body = writerBody();
  assert.ok(!body.includes("build_sha"),
    "write_ac249_record must NOT write its own build_sha literal — ac89_append_goal009 is the single anchor choke point");
  assert.ok(/ac89_append_goal009\s+"/.test(body), "the record must be appended through ac89_append_goal009");
  assert.ok(!/ac207_select_implementation_commit/.test(body),
    "the write path must not build commit_files through the SINGLE-commit selector — that is this task's defect face");
  // The two path predicates must be the criterion's own two: a `./src/…` form has to be able to fail,
  // so the writer cannot normalise paths before judging (AC3).
  assert.ok(!/normalize|realpath|\.replace\(\/\^\\\.\//.test(body),
    "the writer must not rewrite the paths it is judging — the criterion's startswith sees them verbatim");
});

test("② the REAL criterion takes 0 / 1 / 3, and every filter — including both one-sided shapes — can reject", () => {
  const py = criterionPython();

  // exit 3 — carrier absent is NOT-EVALUATED, distinct from both pass and fail (硬规则 3b).
  assert.equal(runCriterion(py, null).status, 3, "carrier absent ⇒ exit 3");

  // A record built the way the producer builds it: host on another machine, project_root outside this
  // repo, a non-empty task_id, and a commit_files UNION carrying BOTH sides.
  const good = {
    build_sha: "0123456789abcdef0123456789abcdef01234567",
    ts: "2026-09-12T00:00:00Z",
    ac: "GOAL-016-AC-249",
    host: "instance-20221019-1509",
    project_root: "/home/yale/work/archguard",
    task_id: "TASK-89",
    commit_files: ["scripts/check-adr.ts", "tests/unit/scripts/check-adr.test.ts",
      "quay-adr/ADR-007.md", "tasks/TASK-89.md"],
  };
  assert.equal(runCriterion(py, () => [good]).status, 0, "a complete-change record must pass");

  const impostors = [
    ["host == this machine", ({ host }) => ({ ...good, host })],
    ["host empty", () => ({ ...good, host: "" })],
    ["project_root == this repo", ({ here }) => ({ ...good, project_root: here })],
    ["project_root under this repo", ({ here }) => ({ ...good, project_root: path.join(here, "sub") })],
    ["task_id empty", () => ({ ...good, task_id: "" })],
    ["commit_files empty", () => ({ ...good, commit_files: [] })],
    ["commit_files not a list", () => ({ ...good, commit_files: "scripts/check-adr.ts" })],
    // The two shapes this AC exists for: ONE SIDE ALONE.
    ["code side only", () => ({ ...good, commit_files: ["scripts/check-adr.ts", "tests/unit/scripts/check-adr.test.ts"] })],
    ["doc side only", () => ({ ...good, commit_files: ["quay-adr/ADR-007.md", "tasks/TASK-89.md"] })],
    // AC3: the path prefix must be the repo-relative form the criterion's `startswith` sees.
    ["dot-slash code path", () => ({ ...good, commit_files: ["./scripts/check-adr.ts", "quay-adr/ADR-007.md"] })],
    ["absolute code path", () => ({ ...good, commit_files: ["/abs/scripts/check-adr.ts", "quay-adr/ADR-007.md"] })],
    // A carrier holding ONLY a different ac is not this AC's evidence either.
    ["a different ac", () => ({ ...good, ac: "GOAL-016-AC-248" })],
  ];
  for (const [label, rec] of impostors) {
    assert.equal(runCriterion(py, (ctx) => [rec(ctx)]).status, 1, `${label} must be rejected with exit 1`);
  }
  // Positive control for the ALTERNATIVE doc branch: `docs/adr` alone satisfies the doc predicate.
  assert.equal(runCriterion(py, () => [{ ...good, commit_files: ["src/x.ts", "docs/adr/007-cli-parity.md"] }]).status, 0,
    "docs/adr must be accepted as the doc side — the criterion has two doc branches, not one");
});

test("③ the union is a UNION: two commits (code first, doc last) — the single-commit selector sees only half", () => {
  const repo = makeRepo();
  try {
    const union = runBash(UNION_FNS,
      `mapfile -t F < <(ac249_union_files '${repo.dir}' T-1); printf '%s\\n' "\${F[@]}"`);
    const files = union.stdout.trim().split("\n").filter(Boolean).sort();
    assert.deepEqual(files, ["quay-adr/ADR-007.md", "src/a.ts", "tasks/T-1.md"].sort(),
      "the union must carry BOTH sides (and the task file the registration commit touched)");

    // The pre-existing selector picks exactly ONE commit — the newest one, which is the DOC commit.
    const sel = runBash(UNION_FNS,
      `sha="$(ac207_select_implementation_commit '${repo.dir}' || true)"; ` +
      `echo "SHA=$sha"; if [ -n "$sha" ]; then ac207_commit_files '${repo.dir}' "$sha"; fi`);
    const selFiles = sel.stdout.trim().split("\n").filter((l) => l && !l.startsWith("SHA="));
    assert.deepEqual(selFiles, ["quay-adr/ADR-007.md"],
      "the single-commit selector must see ONLY the newest (doc) commit — that is the defect this AC fixes");
    assert.ok(!selFiles.some((f) => f.startsWith("src/") || f.startsWith("scripts/")),
      "…and therefore its file list has NO code side — a producer built on it would report a fully qualified task as incomplete");

    // And the writer really does refuse that half-list while accepting the union (two readings, side by side).
    const WRITER_FNS = ["ac89_append_goal009", ...WRITE_PATH_FNS,
      ...UNION_FNS.filter((f) => f !== "ac207_select_implementation_commit"),
      "write_ac249_record"];
    const half = runBash(WRITER_FNS,
      `if write_ac249_record hostX-arm /home/other/proj T-1 '["quay-adr/ADR-007.md"]' 2>/dev/null; then echo WROTE; else echo REFUSED; fi`);
    assert.equal(half.stdout.trim(), "REFUSED", "the half-list must be refused");
    assert.equal(half.lines.length, 0, "…and must leave the carrier with ZERO records");

    const whole = runBash(WRITER_FNS,
      `if write_ac249_record hostX-arm /home/other/proj T-1 '${JSON.stringify(files)}' 2>/dev/null; then echo WROTE; else echo REFUSED; fi`);
    assert.equal(whole.stdout.trim(), "WROTE", "the union must be accepted");
    assert.equal(whole.lines.length, 1, "…and must write exactly one record");
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("④ every one-sided union is refused by the writer, and an unreadable union writes NOTHING", () => {
  const WRITER_FNS = ["ac89_append_goal009", ...WRITE_PATH_FNS, "ac249_is_code_path", "ac249_is_adr_doc_path",
    "write_ac249_record"];
  const cases = [
    ["code only", '["scripts/check-adr.ts","src/a.ts"]'],
    ["doc only", '["quay-adr/ADR-007.md","docs/adr/007.md"]'],
    ["dot-slash form", '["./scripts/check-adr.ts","quay-adr/ADR-007.md"]'],
    ["empty list", "[]"],
    ["unreadable/empty json", '""'],
    ["empty host", '["scripts/a.ts","quay-adr/ADR-007.md"]'],
  ];
  for (const [label, cf] of cases) {
    const args = label === "empty host"
      ? `"" /home/other/proj T-1 '${cf}'`
      : `hostX-arm /home/other/proj T-1 '${cf}'`;
    const r = runBash(WRITER_FNS,
      `if write_ac249_record ${args} 2>/dev/null; then echo WROTE; else echo REFUSED; fi`);
    assert.equal(r.stdout.trim(), "REFUSED", `${label} must be refused`);
    assert.equal(r.lines.length, 0, `${label} must leave the carrier with ZERO records (未测量 ≠ 不合格)`);
  }
  // The positive control for the same function — so the refusals above are not vacuous.
  const ok = runBash(WRITER_FNS,
    `if write_ac249_record hostX-arm /home/other/proj T-1 '["scripts/a.ts","quay-adr/ADR-007.md"]' 2>/dev/null; then echo WROTE; else echo REFUSED; fi`);
  assert.equal(ok.stdout.trim(), "WROTE", "the same writer must accept a complete-change union");
  assert.equal(ok.lines.length, 1, "…writing exactly one record");
});

test("④b the STEP is positioned on the union and never uses the single-commit selector", () => {
  const body = stepBody().replace(/#.*/g, "");
  assert.ok(/ac249_union_files|ac249_union_commit_shas/.test(body),
    "the step must build commit_files from the UNION helpers");
  assert.ok(!/ac207_select_implementation_commit/.test(body),
    "the step must NOT build commit_files through the single-commit selector (AC2)");
  assert.ok(/write_ac249_record/.test(body), "the step must write through the product writer");
  // The union function itself must exclude merge commits positionally — `git show --name-only` on a
  // merge prints nothing, which would read "the task changed nothing" as an empty union (硬规则 3b).
  const unionBody = bashFunctionSource(fs.readFileSync(SCRIPT, "utf8"), "ac249_union_commit_shas");
  assert.ok(unionBody.includes("--no-merges"),
    "the union must exclude merge commits — a merge commit's `git show --name-only` is empty");
});

test("③b the SPAN source recovers the union AFTER the task branch is reaped (the post-fan-in shape)", () => {
  // ⚠️ This is the shape the AC is actually measured in: fan-in ff-merges the task branch into
  // develop and the reaper deletes the branch. At that moment the branch source (A) yields NOTHING,
  // and the task-file source (B) yields only `tasks/T-1.md` — because the implementation commits do
  // NOT touch the task file. Without the span source the union would collapse to a one-file list and
  // the AC would read a fully qualified task as INCOMPLETE forever (硬规则 4c: the quantity the
  // criterion names cannot be reached through a layer that drops it).
  const repo = makeRepo();
  reapBranch(repo);
  finalize(repo);
  const union = runBash(UNION_FNS,
    `mapfile -t F < <(ac249_union_files '${repo.dir}' T-1); printf '%s\\n' "\${F[@]}"`);
  const files = union.stdout.trim().split("\n").filter(Boolean).sort();
  assert.deepEqual(files, ["quay-adr/ADR-007.md", "src/a.ts", "tasks/T-1.md"].sort(),
    "after the branch is reaped the union must STILL carry both sides (via the task-file existence span)");
  const span = runBash(UNION_FNS, `ac249_span_state '${repo.dir}' T-1`);
  assert.match(span.stdout.trim(), /^span [45] (-|[0-9a-f]{40})$/,
    "the span source must be the one that fired (registration → 翻-done), and it must be within the bound");
});

test("③c the span source FAILS CLOSED past its bound instead of swallowing history", () => {
  // A task file touched once at creation and again many commits later would otherwise pull an
  // arbitrary slice of history into "this task's changes" — a union that makes the criterion
  // near-unfalsifiable. Past the bound the span source contributes NOTHING (it does not error the
  // whole step: A/B/C still stand).
  const repo = makeRepo();
  reapBranch(repo);
  for (let i = 0; i < 55; i++) {
    fs.writeFileSync(path.join(repo.dir, `noise-${i}.txt`), `${i}\n`);
    repo.git("add", "-A");
    repo.git("commit", "-qm", `chore: noise ${i}`);
  }
  finalize(repo);
  const span = runBash(UNION_FNS, `ac249_span_state '${repo.dir}' T-1`);
  assert.match(span.stdout.trim(), /^too-long \d+ (-|[0-9a-f]{40})$/,
    "past the bound the span source must report too-long and contribute nothing");
  const union = runBash(UNION_FNS,
    `mapfile -t F < <(ac249_union_files '${repo.dir}' T-1); printf '%s\\n' "\${F[@]}"`);
  const files = union.stdout.trim().split("\n").filter(Boolean);
  assert.deepEqual(files, ["tasks/T-1.md"],
    "…so the union falls back to the task-file anchor alone (a fail-CLOSED reading, never a false green)");
});
