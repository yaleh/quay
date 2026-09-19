// @test-group engine
// sh-census-check.test.mjs — the two-way control for plugin/scripts/sh-census-check.ts
// (tasks/gap-arch-sh-census-check, AC1–AC6).
//
// WHY A TWO-WAY CONTROL AND NOT JUST A GREEN RUN: a checker that can only ever print PASS is not a
// check (CLAUDE.md 硬规则 3b — a structurally-always-green check is more expensive than no check,
// because the record makes it look like the obligation is being executed). So every RED fixture below
// is a REAL tree on disk, and the assertions are on the READING (which file, which interpreter, which
// pair), never on a boolean.
//
// TWO FAMILIES OF ASSERTION:
//   · FIXTURES (hermetic temp trees, `git init` + `git add` so `git ls-files` is the real data source):
//     each proves one judgment BITES on a defect it claims to catch, plus the negative controls that it
//     does NOT bite on the correct form (comment/string mentions; `node --test`; a symlink).
//   · THE REAL REPO: AC2/AC3/AC4/AC5 are readings on THIS repository, so they are asserted here — the
//     script count is compared against an INDEPENDENT shell pipeline (the AC2 command itself, not a
//     frozen literal), and the ratchet axes are compared against the committed baseline file (not a
//     literal pin, which would fight the ratchet's own reason to exist: when Phase 1/5 shrink the
//     shell layer, the baseline is lowered and these assertions follow it automatically).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  BASELINE_FILE_REL,
  EXCEPTIONS_FILE_REL,
  buildFixture,
  checkBaselineShrinkOnly,
  countCodeLines,
  decide,
  extractEmbeddedInterpreters,
  judge,
  measuredOf,
  parseExceptions,
  readCensus,
  scanCopies,
} from "../scripts/sh-census-check.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The real-repo census, read ONCE for all the AC assertions below. Reading it costs ~4s (it walks
 *  the 50MB reference corpus); five independent readings would make this file the slowest in the
 *  scoped gate for no extra information — the tree does not change between the tests in one run. */
let realCensusCache = null;
const realCensus = () => (realCensusCache ??= readCensus(REPO_ROOT));

/** Run `fn(root)` on a fresh hermetic git fixture and remove it afterwards. */
function withFixture(files, opts = {}, fn) {
  const root = buildFixture(files, opts);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const GLUE = '#!/usr/bin/env bash\nset -eu\ngit -C "$1" merge --ff-only develop\nkill -TERM "$pid"\n';

// ── the position judgment (硬规则 2) — the core of the 口径 ──────────────────────────────────────────

test("a python3 heredoc IS an embedded interpreter (its `python3` is a command word)", () => {
  const src = '#!/usr/bin/env bash\nx="$(python3 - "$1" <<\'PY\'\nprint(1)\nPY\n)"\necho "$x"\n';
  assert.deepEqual(extractEmbeddedInterpreters(src).map((h) => h.interpreter), ["python3"]);
});

test("pure git/process glue has NO embedded interpreter (the AC3 negative direction)", () => {
  assert.deepEqual(extractEmbeddedInterpreters(GLUE), []);
});

test("a comment or a string mentioning python3/node is NOT a command position (硬规则 2 negative control)", () => {
  const src = [
    "#!/usr/bin/env bash",
    "# this script does NOT run python3 itself",
    'hint="use python3 or node --experimental-strip-types here"',
    "echo \"$hint\"",
  ].join("\n");
  assert.deepEqual(extractEmbeddedInterpreters(src), []);
});

test("a heredoc BODY containing `python3` does not count; the declaring command DOES", () => {
  const bodyOnly = "#!/usr/bin/env bash\ncat <<'NOTE' > /dev/null\nrun python3 to do it\nNOTE\necho done\n";
  assert.deepEqual(extractEmbeddedInterpreters(bodyOnly), []);
  const declared = "#!/usr/bin/env bash\npython3 - <<'PY'\nprint(1)\nPY\n";
  assert.deepEqual(extractEmbeddedInterpreters(declared).map((h) => h.interpreter), ["python3"]);
});

test("`$( … )` inside DOUBLE QUOTES is still a command position (the repo's dominant embedding form)", () => {
  // This is the shape that made the naive reading wrong: develop-deliver-tgz.sh / capability-catalog.sh
  // both embed python3 inside `x="$(python3 - <<'PY' …)"`. Masking double quotes wholesale would zero
  // the reading — a constant-zero quantity indistinguishable from "everything is fine" (硬规则 4).
  const src = '#!/usr/bin/env bash\nout="$(python3 - "$x" <<\'PY\'\nprint(1)\nPY\n)"\n';
  assert.deepEqual(extractEmbeddedInterpreters(src).map((h) => h.interpreter), ["python3"]);
});

test("`node` counts only with --experimental-strip-types / -e / --eval / a .ts argument", () => {
  const run = (l) => extractEmbeddedInterpreters(`#!/usr/bin/env bash\n${l}\n`).map((h) => h.interpreter);
  assert.deepEqual(run('node --no-warnings --experimental-strip-types "${SCRIPT_DIR}/x.ts"'), ["node"]);
  assert.deepEqual(run('exec node --experimental-strip-types "$SELF_DIR/y.ts"'), ["node"]);
  assert.deepEqual(run("node -e 'console.log(1)'"), ["node"]);
  assert.deepEqual(run('node --test "plugin/test/**/*.test.mjs"'), []); // the test runner is not an embedded program
  assert.deepEqual(run('node "${tmp}/stub.mjs" "$scenario" > "${portfile}"'), []); // plain .mjs without a flag
});

test("a `node:*)` case pattern is not a command word (the `\\b` trap)", () => {
  // `\bnode\b` matches inside `node:*)` — the `:` is a non-word char. That line is a CASE PATTERN, not
  // a command, and counting it would inflate the census (measured: develop-deliver-tgz.sh:438).
  const src = "#!/usr/bin/env bash\ncase \"$1\" in\n  node:*) continue ;;\nesac\n";
  assert.deepEqual(extractEmbeddedInterpreters(src), []);
});

test("a multi-line single-quoted string stays masked, and a heredoc resumes the cmdsub it started in", () => {
  const src = [
    "#!/usr/bin/env bash",
    "msg='line one",
    "python3 is not run here",
    "line three'",
    'out="$(python3 - <<\'PY\'',
    "print('inner')",
    "PY",
    ')"',
    "echo \"$msg$out\"",
  ].join("\n");
  const hits = extractEmbeddedInterpreters(src);
  assert.deepEqual(hits.map((h) => h.interpreter), ["python3"]);
  assert.equal(hits[0].line, 5);
});

test("countCodeLines drops blank lines and pure-comment lines (including the shebang)", () => {
  // Only `set -eu` and `echo hi` are code: the shebang is a comment line, blank/whitespace-only
  // lines are dropped, and an indented `#` comment is still a comment.
  assert.equal(countCodeLines("#!/usr/bin/env bash\n\n# a comment\nset -eu\n   \n  # indented comment\necho hi\n"), 2);
});

// ── the exception list ──────────────────────────────────────────────────────────────────────────────

test("parseExceptions reads `<path>  # <reason>` and rejects a line with no reason", () => {
  const ok = parseExceptions("# header comment\n\nplugin/scripts/a.sh  # a reason here\n");
  assert.deepEqual(ok, [{ path: "plugin/scripts/a.sh", reason: "a reason here" }]);
  assert.equal(parseExceptions("plugin/scripts/a.sh\n"), null, "a line with no `#` reason is unparseable");
  assert.equal(parseExceptions("plugin/scripts/a.sh  #\n"), null, "an EMPTY reason is unparseable");
  assert.deepEqual(parseExceptions("  # a full-line comment is fine\n"), [], "a leading-`#` line is a comment, not a broken entry");
});

// ── the copier scan ─────────────────────────────────────────────────────────────────────────────────

test("byte-identical non-symlink copies are duplicates; a symlink is NOT (it is counted separately)", () => {
  withFixture(
    {
      "plugin/scripts/dup.sh": GLUE,
      "experiments/exp/scripts/dup.sh": GLUE,
      "plugin/scripts/linked.sh": GLUE,
      "plugin/scripts/other.sh": GLUE,
      "experiments/exp/scripts/other.sh": "#!/usr/bin/env bash\necho different\n",
    },
    { symlinks: { "experiments/exp/scripts/linked.sh": "../../../plugin/scripts/linked.sh" } },
    (root) => {
      const tracked = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
      const scan = scanCopies(root, tracked);
      assert.deepEqual(scan.duplicates, [{ experimentsPath: "experiments/exp/scripts/dup.sh", pluginPath: "plugin/scripts/dup.sh" }]);
      assert.equal(scan.symlinked.length, 1);
      assert.equal(scan.symlinked[0].experimentsPath, "experiments/exp/scripts/linked.sh");
      // same name, DIFFERENT bytes — reported, but counted as neither a duplicate nor a symlink.
      assert.deepEqual(scan.differingSameName, [{ experimentsPath: "experiments/exp/scripts/other.sh", pluginPath: "plugin/scripts/other.sh" }]);
    },
  );
});

// ── the ratchet judgment ────────────────────────────────────────────────────────────────────────────

test("checkBaselineShrinkOnly: equal and lower pass, a raise is caught, absent HEAD is labelled bootstrap", () => {
  const head = { embeddedInterpreterLines: 8666, duplicateCopies: 38 };
  assert.deepEqual(checkBaselineShrinkOnly({ ...head }, head), { raised: [], bootstrap: false });
  assert.deepEqual(checkBaselineShrinkOnly({ embeddedInterpreterLines: 0, duplicateCopies: 0 }, head), { raised: [], bootstrap: false });
  assert.deepEqual(checkBaselineShrinkOnly({ ...head, duplicateCopies: 39 }, head), { raised: ["duplicateCopies"], bootstrap: false });
  assert.deepEqual(checkBaselineShrinkOnly({ embeddedInterpreterLines: 9, duplicateCopies: 9 }, null), { raised: [], bootstrap: true });
});

test("judge reds on EITHER axis and on a raised baseline, and greens only when all three hold", () => {
  const base = { embeddedInterpreterLines: 100, duplicateCopies: 5 };
  assert.equal(judge({ embeddedInterpreterLines: 100, duplicateCopies: 5 }, base, base, base).ok, true);
  assert.deepEqual(judge({ embeddedInterpreterLines: 101, duplicateCopies: 5 }, base, base, base).over, ["embeddedInterpreterLines"]);
  assert.deepEqual(judge({ embeddedInterpreterLines: 100, duplicateCopies: 6 }, base, base, base).over, ["duplicateCopies"]);
  assert.deepEqual(judge({ embeddedInterpreterLines: 0, duplicateCopies: 0 }, base, { ...base, duplicateCopies: 6 }, base).baselineRaised, ["duplicateCopies"]);
});

// ── the NOT-EVALUATED paths (硬规则 3b) ─────────────────────────────────────────────────────────────

test("a repo with no .sh, and a non-git directory, both report evaluated:false with exit 2 — never exit 0", () => {
  withFixture({ "README.md": "# nothing\n" }, {}, (root) => {
    const d = decide(root);
    assert.equal(d.reading.evaluated, false);
    assert.equal(d.code, 2);
  });
  withFixture({ "plugin/scripts/a.sh": GLUE }, { git: false }, (root) => {
    const d = decide(root);
    assert.equal(d.reading.evaluated, false);
    assert.equal(d.code, 2);
  });
});

test("an unparseable exception list is NOT-EVALUATED, not a reading that silently dropped the entry", () => {
  withFixture(
    {
      "plugin/scripts/a.sh": GLUE,
      [EXCEPTIONS_FILE_REL]: "plugin/scripts/a.sh\n",
      "plugin/sh-census-baseline.json": JSON.stringify({ embeddedInterpreterLines: 0, duplicateCopies: 0 }),
    },
    {},
    (root) => {
      const d = decide(root);
      assert.equal(d.reading.evaluated, false);
      assert.equal(d.code, 2);
    },
  );
});

// ── the REAL REPO (AC2/AC3/AC4/AC5/AC6) ─────────────────────────────────────────────────────────────

test("AC2: the census is read from the real repo and totals.scripts equals the INDEPENDENT shell count", () => {
  const reading = realCensus();
  assert.equal(reading.evaluated, true, reading.reason ?? "");
  const independent = Number(
    execFileSync(
      "bash",
      ["-c", "git -C \"$1\" ls-files '*.sh' | grep -v 'checker-mutation-cases/' | grep -v '^archive/' | wc -l", "_", REPO_ROOT],
      { encoding: "utf8" },
    ).trim(),
  );
  assert.equal(reading.totals.scripts, independent, "the census set must equal the independent AC2 command's output");
  assert.ok(independent > 100, `expected a real census, got ${independent}`);
  // The `find` pollution this task exists to prevent: `.claude/worktrees/*` copies must appear ZERO times.
  assert.equal(reading.files.filter((f) => f.path.includes(".claude/worktrees/")).length, 0);
});

test("AC3: two known program-shells have a non-empty `embedded`; two known pure-glue shells have an empty one", () => {
  const reading = realCensus();
  const by = new Map(reading.files.map((f) => [f.path, f]));
  for (const p of ["plugin/scripts/develop-deliver-tgz.sh", "plugin/scripts/capability-catalog.sh"]) {
    assert.ok((by.get(p)?.embedded.length ?? 0) > 0, `${p} must read as an embedded-interpreter program`);
  }
  for (const p of ["plugin/scripts/os-anchor-install.sh", "plugin/scripts/dead-loop-check.sh"]) {
    assert.deepEqual(by.get(p)?.embedded, [], `${p} is known pure glue and must NOT be counted`);
  }
  assert.ok(reading.totals.embeddedInterpreterScripts > 0, "a reading of 0 embedded scripts means the checker is broken, not that the tree is clean");
  assert.ok(reading.totals.embeddedInterpreterLines > 0);
});

test("AC4: the byte-identical gate-script-base.ts pair is a duplicate, and symlinkedCopies >= 1", () => {
  const reading = realCensus();
  const pair = reading.duplicates.find(
    (d) => d.experimentsPath === "experiments/quay-perpetual-stream/scripts/gate-script-base.ts" && d.pluginPath === "plugin/scripts/gate-script-base.ts",
  );
  assert.ok(pair, "gate-script-base.ts must be reported as a byte-identical non-symlink duplicate pair");
  assert.ok(reading.totals.symlinkedCopies >= 1, "the experiments→plugin symlink copies must be counted separately");
  assert.equal(reading.totals.duplicateCopies, reading.duplicates.length);
  assert.equal(reading.totals.symlinkedCopies, reading.symlinked.length);
});

test("AC5: exception-listed files still APPEAR in files[] (exception:true) and are summed into exceptionLines", () => {
  const reading = realCensus();
  const by = new Map(reading.files.map((f) => [f.path, f]));
  for (const p of ["plugin/scripts/verify-deliver-coldstart.sh", "plugin/scripts/supervisor-deliver.sh"]) {
    assert.equal(by.get(p)?.exception, true, `${p} must be marked exception:true`);
  }
  assert.ok(reading.totals.exceptionLines > 0, "exception lines must be reported separately (they are excluded from the ratchet, not from visibility)");
  assert.deepEqual(reading.exceptionMissing, [], "every exception-listed path must exist in the track set");
  // The excluded file's lines must be in exceptionLines and OUT of the ratchet axis.
  const excl = reading.files.filter((f) => f.exception);
  assert.equal(
    reading.totals.exceptionLines,
    excl.reduce((n, f) => n + f.codeLines, 0),
  );
  // The ratchet axis is EXACTLY the non-exception embedded files' lines — recomputed from files[],
  // so an exception file silently leaking back into the axis is caught here.
  assert.equal(
    reading.totals.embeddedInterpreterLines,
    reading.files.filter((f) => !f.exception && f.embedded.length > 0).reduce((n, f) => n + f.codeLines, 0),
    "embeddedInterpreterLines must be the non-exception embedded files' lines and nothing else",
  );
  assert.equal(reading.orphanMethod, "static-basename-match", "the orphan reading must be labelled a static candidate");
});

test("AC6: the committed baseline EXISTS and equals the live reading on both ratchet axes", () => {
  const reading = realCensus();
  const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, BASELINE_FILE_REL), "utf8"));
  assert.deepEqual(measuredOf(reading), {
    embeddedInterpreterLines: raw.embeddedInterpreterLines,
    duplicateCopies: raw.duplicateCopies,
  });
  // And the gate itself is GREEN on the real tree (the reading is ≤ the baseline it just recorded).
  assert.equal(decide(REPO_ROOT).code, 0);
});
