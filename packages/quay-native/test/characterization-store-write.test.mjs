// @test-group product
// @load-sensitive child-spawn
//
// characterization-store-write — the BEHAVIOUR-EQUIVALENCE baseline for quay-native's
// `createStore().write()` serialization + concurrency, taken before the planned store
// refactors (createStore/createGoalStore closure split, Task-section parsing hardening).
//
// WHY this file exists (task gap-characterization-baseline-serve-routes-and-concurrent-writes):
// the planned refactors have no evidence that "behaviour did not change". This file supplies it
// in the two shapes that a pure unit test cannot:
//
//   ① WRITE-BYTE GOLDEN — a fixed input sequence (create / status / body / extra+labels /
//      children, with a Chinese + fenced-code body) is written through the REAL store, and the
//      resulting on-disk FILE BYTES are compared to a checked-in golden. A refactor that changes
//      serialization ORDER, quoting, or whitespace reds here even if every parsed field still
//      round-trips (a parsed-equality assertion would pass — see the negative control in the
//      task's Evidence).
//   ② MULTI-PROCESS WRITE RACE — ≥4 real child processes write the SAME id concurrently under
//      `expectedStatus` CAS (exactly one winner, the rest ConflictError) and DIFFERENT ids
//      concurrently (all land). The parent asserts on real exit codes + stdout, never on an
//      in-process simulation.
//
// ⛔ NOT a duplicate of the existing coverage: cas-write.test.mjs proves the TOCTOU closure by
// SEQUENCING an interloper process BEFORE the CAS writer (real wall-clock ordering, zero
// contention); lock.test.mjs / concurrent-writer.mjs patch ONE field (labels) on one id to prove
// the advisory lock serializes writers. Neither exercises SIMULTANEOUSLY-STARTED CAS writers
// racing for one id, nor cross-id concurrent creation. Those are the two arms added here.
//
// ⛔ Test-only. No production source is touched by this task.
//
// Run (scoped):
//   scripts/test.sh packages/quay-native/test/characterization-store-write.test.mjs
// Regenerate the golden:
//   UPDATE_SNAPSHOT=1 node --test packages/quay-native/test/characterization-store-write.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createStore } from "../src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, "fixtures", "characterization", "store-write.golden.json");

// ── child mode ────────────────────────────────────────────────────────────────────────────────────
// The concurrency arms spawn THIS file as a real child process (no extra helper file to keep in
// sync: the writer logic lives beside the assertions that consume its stdout). `process.exit()`
// below runs before any `test()` registration, so the child never enters the node:test runner.
const CHILD_ARGS = process.argv.slice(2);
if (CHILD_ARGS[0] === "--writer-child") {
  runWriterChild(CHILD_ARGS.slice(1));
}

/** One write per process, outcome reported as a single JSON line on stdout + a distinct exit code
 *  (2 = ConflictError, 1 = any other error) — the shape cas-writer-helper.mjs established. */
function runWriterChild([tasksDir, id, mode]) {
  const store = createStore(tasksDir);
  try {
    if (mode === "cas-ready-to-done") {
      const t = store.write(id, { status: "done", expectedStatus: "ready" });
      process.stdout.write(`${JSON.stringify({ mode, outcome: "success", status: t.status })}\n`);
      process.exit(0);
    }
    if (mode === "create-fresh") {
      const t = store.write(id, { title: `concurrent ${id}`, status: "todo", labels: ["concurrent"] });
      process.stdout.write(`${JSON.stringify({ mode, outcome: "success", id: t.id, status: t.status })}\n`);
      process.exit(0);
    }
    throw new Error(`unknown child mode: ${mode}`);
  } catch (err) {
    const isConflict = err && err.name === "ConflictError";
    process.stdout.write(
      `${JSON.stringify({ mode, outcome: isConflict ? "conflict" : "error", message: err && err.message })}\n`,
    );
    process.exit(isConflict ? 2 : 1);
  }
}

// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────

/** A throwaway tasks dir OUTSIDE any git repo (os.tmpdir()), so `commitTaskWrite` takes its
 *  documented "not-in-git" no-op and the bytes under test are the serializer's alone. */
function makeTasksDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "quay-char-store-"));
}

/** Spawn one writer child and resolve with { code, out } — never rejects on a non-zero exit (the
 *  conflict exit code IS the reading under test). */
function spawnWriter(tasksDir, id, mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--writer-child", tasksDir, id, mode], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let errOut = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (errOut += c));
    child.on("error", reject);
    child.on("close", (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(out.trim().split("\n").pop());
      } catch {
        /* a malformed child line is reported by the caller as a null reading */
      }
      resolve({ code, out, errOut, parsed });
    });
  });
}

// ── ① the fixed input sequence (the golden's subject) ─────────────────────────────────────────────

/** The exact bodies the golden pins. Kept here (not read from the golden) so a golden regenerated
 *  by a careless `UPDATE_SNAPSHOT=1` cannot silently redefine the INPUT — only the output bytes. */
const BODY_V1 = [
  "## Proposal",
  "",
  "中文段落：这是一段用于特征化基线的说明，包含标点、全角字符（括号）与数字 123。",
  "",
  "```js",
  "const answer = 42; // fenced code inside the body",
  "```",
  "",
].join("\n");

const BODY_V2 = [
  "## Proposal",
  "",
  "第二版正文：状态翻转之后的 body。",
  "",
  "## Plan",
  "",
  "```sh",
  "echo 'still fenced';",
  "```",
  "",
  "结尾行。",
  "",
].join("\n");

const STEPS = [
  {
    name: "01-create",
    id: "CHAR-1",
    write: { title: "Characterization task", status: "todo", labels: ["alpha", "beta"], body: BODY_V1 },
  },
  { name: "02-status", id: "CHAR-1", write: { status: "ready" } },
  { name: "03-body", id: "CHAR-1", write: { body: BODY_V2 } },
  {
    name: "04-extra-labels",
    id: "CHAR-1",
    write: { extra: { acceptance: "true", depends_on: ["CHAR-0"] }, labels: ["beta", "gamma"] },
  },
  { name: "05-children", id: "CHAR-1", write: { children: ["CHAR-2", "CHAR-3"] } },
];

/** Run the fixed sequence against a fresh store and return `{ steps: [{name,id,file,bytes}] }`. */
function buildGolden() {
  const tasksDir = makeTasksDir();
  try {
    const store = createStore(tasksDir);
    const steps = [];
    for (const step of STEPS) {
      store.write(step.id, step.write);
      const file = `${step.id}.md`;
      steps.push({ name: step.name, id: step.id, file, bytes: fs.readFileSync(path.join(tasksDir, file), "utf8") });
    }
    return { steps };
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
}

function readGolden() {
  return JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
}

// ── ① the golden assertion ────────────────────────────────────────────────────────────────────────

test("store-write golden: the fixed input sequence serializes to the checked-in file bytes", () => {
  const actual = buildGolden();
  if (process.env.UPDATE_SNAPSHOT === "1") {
    fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
    fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    console.log(`[characterization] golden regenerated: ${GOLDEN_PATH}`);
    return;
  }
  const expected = readGolden();
  assert.equal(
    actual.steps.length,
    expected.steps.length,
    `the golden must cover every step of the fixed input sequence (${expected.steps.length} expected, ${actual.steps.length} written)`,
  );
  for (let i = 0; i < expected.steps.length; i++) {
    const e = expected.steps[i];
    const a = actual.steps[i];
    assert.equal(a.name, e.name, `step ${i} is the same step (${e.name})`);
    assert.equal(
      a.bytes,
      e.bytes,
      `step ${e.name} (${e.file}) wrote different bytes than the golden — a serialization-order / quoting / whitespace change. ` +
        `Re-run with UPDATE_SNAPSHOT=1 only after confirming the change is intended.`,
    );
  }
});

test("store-write golden: the golden is byte-distinguishable per step (a golden that cannot red is not a baseline)", () => {
  const golden = readGolden();
  const seen = new Map();
  for (const step of golden.steps) {
    if (seen.has(step.bytes)) {
      assert.fail(
        `steps ${seen.get(step.bytes)} and ${step.name} produced IDENTICAL bytes — the step would not detect a change confined to it`,
      );
    }
    seen.set(step.bytes, step.name);
  }
  // The Chinese + fenced-code body must survive verbatim (its bytes are not escaped/mangled).
  const created = golden.steps.find((s) => s.name === "01-create");
  assert.ok(created.bytes.includes("中文段落"), "the Chinese body text is written verbatim");
  assert.ok(created.bytes.includes("```js"), "the fenced code block is written verbatim");
  assert.ok(created.bytes.includes("const answer = 42;"), "the code line inside the fence survives verbatim");
});

// ── ② multi-process write race ────────────────────────────────────────────────────────────────────

test("concurrent CAS writers on ONE id: exactly one winner, every other process a ConflictError", async () => {
  const tasksDir = makeTasksDir();
  try {
    const store = createStore(tasksDir);
    store.write("CHAR-RACE", { title: "race target", status: "ready" });

    const N = 4;
    const results = await Promise.all(
      Array.from({ length: N }, () => spawnWriter(tasksDir, "CHAR-RACE", "cas-ready-to-done")),
    );

    const winners = results.filter((r) => r.code === 0 && r.parsed && r.parsed.outcome === "success");
    const conflicts = results.filter((r) => r.code === 2 && r.parsed && r.parsed.outcome === "conflict");
    assert.equal(winners.length, 1, `exactly ONE of ${N} concurrent CAS writers wins (got ${winners.length})`);
    assert.equal(
      conflicts.length,
      N - 1,
      `the other ${N - 1} processes observe a real ConflictError with exit code 2 (got ${conflicts.length})`,
    );
    assert.equal(
      results.filter((r) => r.parsed === null).length,
      0,
      `every child reported a parseable JSON outcome on stdout (stderr sample: ${results[0].errOut.slice(0, 200)})`,
    );

    // The winner's write is durable and readable through the store's own parser.
    const final = store.get("CHAR-RACE");
    assert.equal(final.status, "done", "the final on-disk status is the winner's write");
    // A loser's rollback path (validateWrittenYaml → restore/replace) must never leave a torn file:
    // one frontmatter block, opening and closing delimiters, and the winner's status inside it.
    const raw = fs.readFileSync(path.join(tasksDir, "CHAR-RACE.md"), "utf8");
    assert.ok(raw.startsWith("---\n"), "the final file still opens its frontmatter block");
    assert.equal((raw.match(/^---$/gm) || []).length, 2, "the final file has exactly one frontmatter block (no torn/duplicated write)");
    assert.ok(raw.endsWith("---\n"), "the final file closes with the frontmatter delimiter (no half write)");
    assert.ok(raw.includes("status: done"), "the winner's status is the one on disk");

    // No half-written or lock artefacts survive the race.
    const leftovers = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".lock") || f.endsWith(".tmp") || f.includes(".md.tmp"));
    assert.deepEqual(leftovers, [], `no lock/tmp artefacts survive (found ${JSON.stringify(leftovers)})`);
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("concurrent writers on DIFFERENT ids: every id lands, every file parses, no half-written file", async () => {
  const tasksDir = makeTasksDir();
  try {
    const ids = ["CHAR-D1", "CHAR-D2", "CHAR-D3", "CHAR-D4", "CHAR-D5"];
    const results = await Promise.all(ids.map((id) => spawnWriter(tasksDir, id, "create-fresh")));

    assert.equal(
      results.filter((r) => r.code === 0 && r.parsed && r.parsed.outcome === "success").length,
      ids.length,
      `all ${ids.length} distinct-id writers succeed (codes: ${results.map((r) => r.code).join(",")})`,
    );

    const store = createStore(tasksDir);
    for (const id of ids) {
      const p = path.join(tasksDir, `${id}.md`);
      assert.ok(fs.existsSync(p), `${id}.md landed on disk`);
      const raw = fs.readFileSync(p, "utf8");
      assert.ok(raw.endsWith("\n") || raw.endsWith("---\n"), `${id}.md is a complete document (no half write)`);
      const parsed = store.get(id);
      assert.equal(parsed.title, `concurrent ${id}`, `${id}.md parses back through the store with its own title`);
    }
    const leftovers = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".lock") || f.includes(".tmp"));
    assert.deepEqual(leftovers, [], `no lock/tmp artefacts survive concurrent creation (found ${JSON.stringify(leftovers)})`);
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});
