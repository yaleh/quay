// @test-group product
//
// ac912-criterion-discriminates-shim-deletion.test.mjs — the durability fixture for
// `goals/AC-912-*.md`'s criterion (gap-ac912-criterion-discriminates-shim-deletion).
//
// WHAT THIS FILE IS FOR. AC-912 exists because AC-911 is BLIND to the thing GOAL-907's exit
// condition ② actually asks for. AC-911 counts the files that still carry a `FORWARDING re-export`
// header comment:
//
//     n=$(grep -rln 'FORWARDING re-export' packages/quay/src/*.ts | wc -l)
//
// Delete the header but leave the file in place, still forwarding to `core/`, and AC-911 reads 2
// and goes GREEN — while the 10 named shims are all still there. AC-912 asks the file-existence
// question instead, so a tree that only lost its comments is still RED under it. That
// discrimination is the whole value of AC-912, and until this file it existed only as prose in the
// goal record's `expect` field — i.e. as something a future edit could silently paraphrase away
// (硬规则 4: prose gets paraphrased away; 硬规则 4b: a reading produced by the same machinery
// that is supposed to be checked is not a reading).
//
// THE UNIT UNDER TEST IS THE SHIPPED CRITERION, NOT A COPY OF IT. Both criterion texts are
// extracted VERBATIM from the goal records' YAML frontmatter and executed with the production
// shell — the same text `quay goal gate AC-911` / `quay goal gate AC-912` runs. Re-implementing
// either predicate here would be an ECHO of the criterion rather than a MEASUREMENT of it: it
// would stay green while the shipped text rotted, which is precisely the failure this task exists
// to prevent. Following `ac354-negative-control-falsifiable.test.mjs`, a missing goal file FAILS
// the test rather than skipping it — "could not evaluate" must never wear the same shape as
// "evaluated and fine" (硬规则 3b).
//
// THE FOUR ARMS, and what each one would catch:
//
//   A (production carrier)  The shipped AC-912 criterion, run in THIS tree, is exit 0 with its
//                           `OK: 10 internal shims deleted` echo, AND each of the 10 paths is
//                           absent from disk. The green reading comes from the real tree, not from
//                           a fixture (硬规则 4 推论三: a criterion only a fixture can satisfy
//                           proves "can produce", not "has produced").
//   B (discriminating negative control — the core of this file)
//                           A scratch root carrying the 10 forwarding files WITHOUT the header
//                           comment, plus the two surviving public-ABI files copied from this tree
//                           (headers intact). In ONE run: header count = 2, AC-911 exit 0 reading
//                           `2`, AC-912 exit 1 naming all 10 in fixed order. That is the
//                           "already green under AC-911, still red under AC-912" claim, executed
//                           rather than asserted in prose.
//   C (idle-spin guard / mutation)
//                           One directed mutation of the shipped AC-912 text — drop `adr-store`
//                           from the `for m in …` list — must change the text's sha256, and on a
//                           scratch root holding ONLY `adr-store.ts` the shipped text must be RED
//                           (naming `adr-store`) while the mutated text is GREEN. If the
//                           extraction/execution path ever stopped reaching the criterion, the
//                           mutation would stop flipping the outcome and this arm would red.
//
// ⛔ This file does NOT re-implement either predicate, does NOT write the expected outcomes as
// boolean constants, and does NOT read AC-911 from a constant copied into the test: every reading
// below is an executed criterion text.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root of THIS checkout (a task worktree during dispatch, `develop` during fan-in). */
const REPO = path.resolve(HERE, "..", "..", "..");

/** A harness bound: a hung criterion reports AS a bound instead of as an opaque `code === null`
 *  that `assert.equal(r.code, 0)` would render as a confusing mismatch. The criteria below are
 *  file-existence predicates over a handful of paths — sub-second — so 60s is far above cost. */
const RUN_TIMEOUT_MS = 60_000;

/** The 10 internal shims AC-912 names, IN THE SHIPPED ORDER. The order is part of the reading:
 *  the criterion builds `$still` by appending in list order, so the stderr line it emits is
 *  order-pinned, and arm B asserts that exact line rather than "all ten names appear somewhere". */
const SHIM_NAMES = [
  "adr-store",
  "branch-model",
  "contract-validator",
  "criterion-fidelity",
  "document-store",
  "frontmatter-store-base",
  "goal-store",
  "plugin-root",
  "store-commit",
  "worktree-namespace",
];

/** The two src-root files AC-911 is supposed to keep: the permanent public ABI surface. Their
 *  header comment is intact in the real tree, which is what makes the scratch tree in arm B a
 *  "comments erased, files still forwarding" tree rather than an "empty directory" tree. */
const PUBLIC_SURFACE = ["abi.ts", "config.ts"];

/**
 * The criterion text AS STORED — the goal record's frontmatter block scalar, parsed back to a
 * string. Resolved by id prefix so a rename that keeps the id still resolves; a missing file or a
 * missing/ non-string `criterion` FAILS (never skips): an arm that silently evaluated nothing would
 * be indistinguishable from an arm that evaluated and passed.
 */
function criterionFor(id) {
  const dir = path.join(REPO, "goals");
  assert.ok(fs.existsSync(dir), `no goals/ directory at ${dir} — cannot reach ${id}'s criterion`);
  const name = fs.readdirSync(dir).find((n) => n.startsWith(`${id}-`) && n.endsWith(".md"));
  assert.ok(name, `no goals/${id}-*.md under ${dir}`);
  const raw = fs.readFileSync(path.join(dir, name), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(fm, `goals/${name} has no YAML frontmatter`);
  const doc = YAML.parse(fm[1]);
  assert.equal(typeof doc.criterion, "string", `goals/${name} has no criterion string`);
  assert.equal(doc.id, id, `goals/${name} declares id ${JSON.stringify(doc.id)}, expected ${id}`);
  return doc.criterion;
}

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Run `script` with `/bin/sh -c` in `cwd` — the same shell the acceptance runner uses
 * (`spawnSync(command, { shell: true })` is `/bin/sh -c <script>`). The text goes through argv, not
 * a temp file, so nothing of this fixture leaks into a shared path.
 */
function runSh(script, cwd) {
  const r = spawnSync("/bin/sh", ["-c", script], { cwd, encoding: "utf8", timeout: RUN_TIMEOUT_MS });
  assert.ok(r.error?.code !== "ETIMEDOUT", `the criterion did not finish within ${RUN_TIMEOUT_MS}ms — a harness bound, not a verdict`);
  assert.equal(r.error ?? null, null, `spawning /bin/sh failed: ${r.error?.message}`);
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** The line the criterion emits on failure, located by ITS OWN prefix and compared exactly. */
function stillPresentLine(stderr) {
  const line = stderr.split("\n").find((l) => l.startsWith("internal shims still present:"));
  assert.ok(line, `the criterion printed no "internal shims still present:" line:\n${stderr}`);
  return line.trim();
}

/** Count the files under `<root>/packages/quay/src` whose first line carries the header comment.
 *  This is a DIRECT reading of the scratch tree's shape (not a re-run of AC-911), used to assert
 *  the fixture really is what arm B claims it is before the criteria run on it. */
function headerBearingCount(root) {
  const src = path.join(root, "packages", "quay", "src");
  return fs
    .readdirSync(src)
    .filter((n) => n.endsWith(".ts"))
    .filter((n) => fs.readFileSync(path.join(src, n), "utf8").includes("FORWARDING re-export")).length;
}

/**
 * A scratch root shaped like the repo root, whose `packages/quay/src` holds the 10 shims in their
 * PRE-DELETION forwarding form — `export * from "./core/<name>.ts";` with NO header comment — plus
 * a real copy of the two public-ABI files taken from THIS tree (headers intact).
 *
 * The shim bodies are written from the name list rather than recovered from `fb1c1a240^`: a
 * historical commit is an anchor that a shallow clone or a rewritten history can remove, and a
 * fixture that cannot be built must not quietly become "nothing to compare" (硬规则 4c).
 *
 * ⚠️ The `mkdtempSync` binding is RETURNED and its call sites remove it in a `finally` — the
 * capture-and-clean shape `tmp-leak-pairing-check`'s detector accepts (see ac196's `mkRoot`).
 */
function mkStrippedHeaderTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ac912-strip-"));
  const src = path.join(root, "packages", "quay", "src");
  fs.mkdirSync(src, { recursive: true });
  for (const name of SHIM_NAMES) {
    fs.writeFileSync(path.join(src, `${name}.ts`), `export * from "./core/${name}.ts";\n`, "utf8");
  }
  for (const keep of PUBLIC_SURFACE) {
    fs.copyFileSync(path.join(REPO, "packages", "quay", "src", keep), path.join(src, keep));
  }
  return root;
}

/** A scratch root holding ONLY one forwarding shim — the smallest tree on which the shipped AC-912
 *  text is still red, used by arm C to make the mutation's outcome flip legible. */
function mkSingleShimTree(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ac912-single-"));
  const src = path.join(root, "packages", "quay", "src");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, `${name}.ts`), `export * from "./core/${name}.ts";\n`, "utf8");
  return root;
}

/** The anchor arm C replaces: the start of AC-912's `for m in …` word list. */
const MUTATION_ANCHOR = "for m in adr-store ";

/**
 * Apply ONE directed mutation to the shipped AC-912 text: drop `adr-store` from the word list, so
 * a tree holding `adr-store.ts` alone flips from RED to GREEN. Fails closed when the anchor is
 * absent or ambiguous, and asserts the bytes actually changed — a mutation that did not apply must
 * never be indistinguishable from one that applied and was accepted (硬规则 3b).
 */
function mutateDropAdrStore(text) {
  const hits = text.split(MUTATION_ANCHOR).length - 1;
  assert.equal(hits, 1, `the \`for m in\` word list must start with adr-store exactly once in the shipped AC-912 text, found ${hits}`);
  const mutated = text.replace(MUTATION_ANCHOR, "for m in ");
  assert.notEqual(mutated, text, "the mutation must actually change the criterion text");
  assert.notEqual(sha256(mutated), sha256(text), "the mutation must change the text's sha256 (a same-bytes 'mutation' is an echo, not a control)");
  return mutated;
}

// ── the extraction is the real criterion, in the shape every arm below depends on ─────────────

test("both criteria are extracted verbatim from the shipped goal records", () => {
  const ac912 = criterionFor("AC-912");
  const ac911 = criterionFor("AC-911");

  // AC-912: the file-existence predicate. The word list is asserted IN FULL AND IN ORDER — an
  // extraction that quietly lost a name would make arm B's "all 10 named" assertion pass on nine.
  assert.ok(
    ac912.includes(`for m in ${SHIM_NAMES.join(" ")}; do`),
    `shipped AC-912 must still test exactly these 10 names in this order:\n${ac912}`,
  );
  assert.ok(ac912.includes('[ -e "packages/quay/src/$m.ts" ]'), "shipped AC-912 must ask whether the FILE exists, not whether it carries a comment");
  assert.ok(ac912.includes('echo "OK: 10 internal shims deleted"'), "shipped AC-912 lost its PASS echo");

  // AC-911: the header-comment predicate the discrimination is measured against. If this ever
  // stopped being a grep for the header, "AC-911 stays green" would stop meaning what arm B says.
  assert.ok(
    ac911.includes("grep -rln 'FORWARDING re-export' packages/quay/src/*.ts"),
    `shipped AC-911 must still count header-bearing files:\n${ac911}`,
  );
  assert.ok(ac911.includes('echo "OK: src-root shim count = 2"'), "shipped AC-911 lost its PASS echo");

  // Non-vacuous in the other direction too: two DIFFERENT predicates (a file-existence test and a
  // comment-content count) — if they were ever collapsed into one, the discrimination this file
  // exists to pin would be gone.
  assert.notEqual(sha256(ac912), sha256(ac911), "AC-911 and AC-912 must remain two distinct predicates");
});

// ── arm A: the production carrier ─────────────────────────────────────────────────────────────

test("arm A — the shipped AC-912 criterion is TRUE on this tree and the 10 files are really gone", () => {
  const r = runSh(criterionFor("AC-912"), REPO);
  assert.equal(r.code, 0, `the shipped AC-912 criterion must pass on this tree, got exit ${r.code}: ${r.stderr}`);
  assert.match(r.stdout, /OK: 10 internal shims deleted/, `AC-912 printed no PASS echo:\n${r.stdout}`);

  // The same reading by a direct route: the criterion says the files are absent, and the
  // filesystem must agree. A criterion that passed while a file was still on disk would be the
  // "criterion and tree disagree" failure this whole task family is about.
  for (const name of SHIM_NAMES) {
    const p = path.join(REPO, "packages", "quay", "src", `${name}.ts`);
    assert.equal(fs.existsSync(p), false, `packages/quay/src/${name}.ts must be absent (AC-912), but it exists`);
  }

  // …and the public ABI surface it was never supposed to delete is still here.
  for (const keep of PUBLIC_SURFACE) {
    const p = path.join(REPO, "packages", "quay", "src", keep);
    assert.ok(fs.existsSync(p), `packages/quay/src/${keep} is the permanent public surface — it must still exist`);
  }
});

// ── arm B: the discriminating negative control (the core of this file) ────────────────────────

test("arm B — a comment-erased, still-forwarding tree is GREEN under AC-911 and RED under AC-912 in the same run", () => {
  const root = mkStrippedHeaderTree();
  try {
    // The fixture is what arm B claims before anything runs on it: 10 header-less forwarding files
    // + 2 header-bearing public surface files.
    assert.equal(headerBearingCount(root), 2, "the scratch tree must carry exactly 2 header-bearing files (abi.ts + config.ts)");
    for (const name of SHIM_NAMES) {
      const body = fs.readFileSync(path.join(root, "packages", "quay", "src", `${name}.ts`), "utf8");
      assert.equal(body, `export * from "./core/${name}.ts";\n`, `${name}.ts must be the header-less forwarding form`);
    }

    // AC-911 — this is the reading that makes the file worth writing: the blind predicate is GREEN.
    const a911 = runSh(criterionFor("AC-911"), root);
    assert.equal(a911.code, 0, `the shipped AC-911 criterion must be GREEN on the header-erased tree, got exit ${a911.code}: ${a911.stderr}`);
    assert.match(a911.stdout, /OK: src-root shim count = 2\b/, `AC-911 must report its 2-shim reading:\n${a911.stdout}`);

    // AC-912 — the same tree, the file-existence predicate, RED and naming all ten in shipped order.
    const a912 = runSh(criterionFor("AC-912"), root);
    assert.equal(a912.code, 1, `the shipped AC-912 criterion must be RED on the header-erased tree, got exit ${a912.code}:\n${a912.stdout}`);
    assert.equal(
      stillPresentLine(a912.stderr),
      `internal shims still present: ${SHIM_NAMES.join(" ")}`,
      "AC-912 must name all 10 residual files, in the order its word list declares",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── arm C: the idle-spin guard ───────────────────────────────────────────────────────────────

test("arm C — a directed mutation of the shipped text flips the verdict, so the extraction is not an idle spin", () => {
  const shipped = criterionFor("AC-912");
  const mutated = mutateDropAdrStore(shipped);
  assert.ok(!mutated.includes("adr-store"), "the mutated text must no longer test adr-store");

  const root = mkSingleShimTree("adr-store");
  try {
    // The shipped predicate sees the one file that IS there.
    const rShipped = runSh(shipped, root);
    assert.equal(rShipped.code, 1, `the shipped criterion must be RED on a tree holding adr-store.ts, got exit ${rShipped.code}:\n${rShipped.stdout}`);
    assert.equal(stillPresentLine(rShipped.stderr), "internal shims still present: adr-store");

    // Remove that one name from the word list and the SAME tree becomes green: the verdict
    // followed the criterion TEXT, which is what makes the extraction a measurement.
    const rMutated = runSh(mutated, root);
    assert.equal(rMutated.code, 0, `the mutated criterion must be GREEN once adr-store is no longer tested, got exit ${rMutated.code}: ${rMutated.stderr}`);
    assert.match(rMutated.stdout, /OK: 10 internal shims deleted/, `the mutated criterion printed no PASS echo:\n${rMutated.stdout}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
