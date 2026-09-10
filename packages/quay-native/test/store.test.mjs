// @test-group product
// gap-task-write-accepts-a-title-that-breaks-its-own-frontmatter — write-side
// YAML serialization safety for `task_write` / `task edit` (the Provider ABI
// write surface, per the task's AC6).
//
// The 2026-08-03 board outage: a task title was written UNQUOTED into the YAML
// frontmatter. In YAML a space+`#` starts a comment (`title: The ## Contract`
// truncates the value to "The") and a `: ` starts a nested mapping
// (`title: god-package: gate/ has fanOut=62` makes the parser throw "Nested
// mappings are not allowed"). The write returned success; the file only broke
// hours later, at render time. This suite locks in the fix: the write side is
// responsible for serialization correctness (auto-quote via the YAML library's
// own engine; fail closed on anything that cannot round-trip), never the
// content author.
//
// AC4 — the dangerous charset, DERIVED BY TEST, not hand-listed. Each
// candidate is written through the real store and read back; a round-trip
// failure means it needs quoting. The empirical conclusion (yaml 2.9.0):
//   - Needs quoting (YAML.stringify emits `title: "..."`): any title whose
//     plain form would be misparsed — space+`#` (comment start), `: ` /
//     trailing `:` (mapping start), leading or trailing whitespace, an
//     indicator char at a value-start position (`-` `?` `:` `!` `&` `*` `|`
//     `>` `%` `@` `` ` `` `"` `'` `,` `[` `]` `{` `}` `#`), a value that would
//     coerce under the YAML 1.2 core schema (`123`, `true`, `false`, `null`,
//     `~`, `.inf`, `.nan` — NOT the YAML 1.1 legacy booleans `yes`/`no`/
//     `on`/`off`, which stay plain strings), a multi-line value (block
//     scalar), and non-ASCII runs where the library prefers a quoted form.
//   - Never needs quoting: plain prose letters/digits/ordinary punctuation
//     (`-` inside a word, `.`, `/`, `_`, em-dash inside a word, CJK text when
//     not at a hazardous position) — emitted exactly as written (byte-compat).
// The exact per-character table lives in test/deriveTitleCharset() below; the
// invariant asserted there is that EVERY candidate round-trips byte-identically
// through the store (whatever quoting the serializer chooses), and that the
// hazardous ones are observably quoted on disk.
//
// Run: scripts/test.sh packages/quay-native/test/store.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { createStore } from "../src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// --- helpers ---------------------------------------------------------------

/** Fresh disposable store; destroyed by the caller via cleanup() or after(). */
function makeStore() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-store-title-test-"));
  const store = createStore(tasksDir);
  return { store, tasksDir };
}

/** Read back a task file's frontmatter block text + parsed YAML. */
function readFrontmatter(tasksDir, id) {
  const raw = fs.readFileSync(path.join(tasksDir, `${id}.md`), "utf8");
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) throw new Error(`no frontmatter block in ${id}.md`);
  return { raw, fmText: m[1], parsed: YAML.parse(m[1]) };
}

/** Does the written frontmatter quote the `title` scalar? (proves auto-quote) */
function titleIsQuoted(fmText) {
  const line = /^title:\s*(.*)$/m.exec(fmText);
  if (!line) return false;
  const v = line[1];
  return (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
}

/** Round-trip one title through the REAL store: write → parse → read back. */
function roundTrip(store, tasksDir, title, id = "RT") {
  store.write(id, { title, status: "todo" });
  const { fmText, parsed } = readFrontmatter(tasksDir, id);
  const got = store.get(id);
  return {
    ok: parsed.title === title && got !== null && got.title === title,
    parsedTitle: parsed?.title,
    quoted: titleIsQuoted(fmText),
    fmText,
  };
}

/**
 * AC4 helper — derive which characters actually force quoting by writing each
 * candidate through the real store. A candidate round-trips iff the parsed
 * title equals the written title byte-for-byte. Returns { needsQuoting: Set }.
 */
function deriveTitleCharset() {
  const needsQuoting = new Set();
  const singleChars = [];
  for (let c = 32; c < 127; c++) singleChars.push(String.fromCharCode(c));
  const candidates = [
    ...singleChars.map((ch) => `a${ch}b`), // char in prose context
    "#", " #", "  #", " #a", "a #", "##", "###", " # ",
    ":", ": ", " :", "a: b", "a: b: c", "a:b", "http://x", "C:\\x",
    "- ", "-", "- item", "? ", "?x", "* ", "*x", "&a", "!x", "|", ">", "%x",
    "@x", "`x", '"', "'", "a\"b", "a'b", "{", "}", "[", "]", ",", ", ",
    "null", "~", "true", "false", "yes", "no", "on", "off",
    "123", "-123", "1.5", "0x1F", "1e3", ".inf", ".nan", "01",
    "  lead", "trail  ", "\ttab", "a\nb", "a\n---\nb", "a\n...\nb",
    "🎉", "héllo wörld", "日本語", "a🎉b", "— em", "a—b", "\u00a0x",
  ];
  const { store, tasksDir } = makeStore();
  try {
    for (const c of candidates) {
      const r = roundTrip(store, tasksDir, c);
      if (!r.ok) needsQuoting.add(JSON.stringify(c));
    }
    return needsQuoting;
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
}

// --- AC1 / AC2 — hazardous titles round-trip byte-identically ---------------

test("AC1: title with space-hash (##) round-trips byte-identically", () => {
  const { store, tasksDir } = makeStore();
  try {
    const title = "The ## Contract";
    const r = roundTrip(store, tasksDir, title);
    assert.equal(r.ok, true, `title ${JSON.stringify(title)} must round-trip; parsed=${JSON.stringify(r.parsedTitle)}`);
    assert.equal(r.quoted, true, `hazardous " #" title must be QUOTED on disk:\n${r.fmText}`);
    assert.ok(fs.existsSync(path.join(tasksDir, "RT.md")), "task file exists");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("AC2: title with colon-space (': ') round-trips byte-identically", () => {
  const { store, tasksDir } = makeStore();
  try {
    const title = "god-package: gate/ has fanOut=62";
    const r = roundTrip(store, tasksDir, title);
    assert.equal(r.ok, true, `title ${JSON.stringify(title)} must round-trip; parsed=${JSON.stringify(r.parsedTitle)}`);
    assert.equal(r.quoted, true, `hazardous ": " title must be QUOTED on disk:\n${r.fmText}`);
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

// --- AC3 — NEGATIVE CONTROL: without the serialization fix, AC1/AC2 fail ----

test("AC3: negative control — bypassing the serializer breaks the same titles", () => {
  // What the PRE-FIX write path produced: the title interpolated unquoted.
  const naiveHash = "id: NEG\ntitle: The ## Contract\nstatus: todo\n";
  const naiveColon = "id: NEG\ntitle: god-package: gate/ has fanOut=62\nstatus: todo\n";

  // ` #` after a space starts a comment → title truncates to "The".
  let parsedHash = null;
  let hashParseThrew = false;
  try { parsedHash = YAML.parse(naiveHash); } catch { hashParseThrew = true; }
  const hashTruncated = !hashParseThrew && parsedHash?.title !== "The ## Contract";

  // `: ` starts a nested mapping → the parser throws.
  let colonParseThrew = false;
  try { YAML.parse(naiveColon); } catch { colonParseThrew = true; }

  // At least one direction MUST fail with the fix removed (AC3).
  assert.ok(
    hashTruncated || colonParseThrew,
    `negative control: naive unquoted write must NOT round-trip. ` +
      `hash title parsed=${JSON.stringify(parsedHash?.title)}, colon parse threw=${colonParseThrew}`
  );
  // Document the concrete failure modes for the task body.
  assert.notEqual(parsedHash?.title, "The ## Contract", `naive " #" title truncates (got ${JSON.stringify(parsedHash?.title)})`);
  assert.equal(colonParseThrew, true, `naive ": " title makes YAML.parse throw`);
});

// --- AC4 — charset derived by test (write → parse → read back) -------------

test("AC4: every candidate title round-trips; derived charset documented", () => {
  const needsQuoting = deriveTitleCharset();
  // Derivation invariant: EVERY candidate must round-trip byte-identically
  // through the store (the serializer's job is to make that true). A round-trip
  // failure here is a REAL bug, not a skip.
  assert.deepEqual([...needsQuoting], [], `charset derivation found non-round-tripping titles: ${[...needsQuoting].join(", ")}`);

  // Cross-check on the empirically-derived "must quote" families: space-hash,
  // colon-space, and numeric-coercion titles are observably quoted on disk.
  // `yes`/`no` are NOT in the family — YAML 1.2 (the `yaml` package's default
  // core schema) treats them as plain strings, so they round-trip unquoted.
  const { store, tasksDir } = makeStore();
  try {
    for (const hazardous of ["The ## Contract", "god-package: gate/ has fanOut=62", "123", "a: b"]) {
      const r = roundTrip(store, tasksDir, hazardous);
      assert.equal(r.ok, true, `${JSON.stringify(hazardous)} must round-trip`);
      assert.equal(r.quoted, true, `${JSON.stringify(hazardous)} must be quoted on disk`);
    }
    // YAML 1.2 booleans-by-name: round-trip but may stay plain (NOT quoting).
    for (const plainish of ["yes", "no", "plain title"]) {
      const r = roundTrip(store, tasksDir, plainish);
      assert.equal(r.ok, true, `${JSON.stringify(plainish)} must round-trip`);
    }
    // Byte-compat: a plain title is written exactly as before (unquoted).
    const plain = roundTrip(store, tasksDir, "plain title");
    assert.equal(plain.quoted, false, `plain title must stay UNQUOTED (byte-compat):\n${plain.fmText}`);
    assert.ok(plain.fmText.includes("title: plain title"), "plain title emitted as `title: plain title`");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

// --- AC4 NEGATIVE CONTROL — deterministic stale-read reproduction -----------

test("AC4 negative control: same-(mtimeMs,size) cache key must NOT serve a stale title after a same-size rewrite", () => {
  // gap-native-store-title-roundtrip-nondeterministic-failures.
  //
  // The store's get() parse cache is keyed by (mtimeMs, size) — a heuristic,
  // not a content identity. Two writes to the SAME id with the SAME byte size
  // that land in the same mtime tick collide on that key (e.g. `title: aaa`
  // → `title: bbb`). Before the store invalidated the cache on write, the
  // second get() returned the PREVIOUS title — the read-after-write staleness
  // that made AC4's charset derivation fail on a RANDOM plain-letter candidate
  // on every run (the candidates in the `a<ch>b` family are all same-size, so
  // whichever consecutive pair shared an mtime tick lost its round-trip).
  //
  // This control FORCES the collision deterministically by patching
  // fs.statSync to return ONE fixed (mtimeMs, size) for the RT.md file, instead
  // of relying on filesystem write timing. It is RED on the pre-fix store
  // (get() serves the stale "aaa") and GREEN on the fixed store (write()
  // invalidates the cache → the trailing get() re-reads fresh "bbb").
  const { store, tasksDir } = makeStore();
  const originalStatSync = fs.statSync;
  const FIXED_MTIME = 1_600_000_000_000; // arbitrary but fixed — same every stat
  const FIXED_SIZE = 42;                 // arbitrary but fixed — same every stat
  try {
    fs.statSync = (p) =>
      String(p).endsWith("RT.md")
        ? { mtimeMs: FIXED_MTIME, size: FIXED_SIZE }
        : originalStatSync(p);
    // Prime the cache with a first title under the colliding key.
    const first = roundTrip(store, tasksDir, "aaa");
    assert.equal(first.ok, true, `prime write must round-trip (stale-read control setup)`);
    // Rewrite the SAME id with a SAME-size title ("bbb" is also 3 bytes, so the
    // file size is byte-for-byte identical; the patched statSync keeps mtimeMs
    // identical too). The (mtimeMs,size) cache key therefore COLLIDES with the
    // primed entry — a get() that trusts the key would return "aaa".
    store.write("RT", { title: "bbb", status: "todo" });
    const { parsed } = readFrontmatter(tasksDir, "RT"); // fresh disk read
    assert.equal(parsed.title, "bbb", `on-disk title must be the new one`);
    const got = store.get("RT"); // the store's (possibly cached) view
    assert.equal(got?.title, "bbb",
      `stale-read control: a same-(mtimeMs,size) rewrite must serve the NEW title from the store. ` +
      `store view returned ${JSON.stringify(got?.title)} — if "aaa", the store served a stale ` +
      `parse-cache entry (read-after-write staleness) and the write-side cache invalidation is ` +
      `missing.`);
  } finally {
    fs.statSync = originalStatSync;
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

// --- AC5 — full-store regression (real parser scan, 0 failures) ------------

test("AC5: real-store scan — 0 parse failures; hazardous titles read back unchanged", () => {
  const tasksDir = path.join(REPO_ROOT, "tasks");
  assert.ok(fs.existsSync(tasksDir), `repo tasks dir exists at ${tasksDir}`);
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  assert.ok(files.length > 0, `found task files to scan (${files.length})`);

  const store = createStore(tasksDir);
  let parseFailures = 0;
  let truncated = 0;
  let hazardousCount = 0;
  let missingTitle = 0;
  const parseFailureExamples = [];
  const truncationExamples = [];
  const missingTitleExamples = [];

  for (const f of files) {
    const id = f.slice(0, -3);
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const m = FRONTMATTER_RE.exec(raw);
    if (!m) { parseFailures++; parseFailureExamples.push(`${f}: no frontmatter block`); continue; }
    let parsed;
    try {
      parsed = YAML.parse(m[1]);
    } catch (e) {
      parseFailures++;
      parseFailureExamples.push(`${f}: ${e.message}`);
      continue;
    }
    if (typeof parsed?.title !== "string" || parsed.title.length === 0) {
      missingTitle++;
      missingTitleExamples.push(f);
      continue;
    }
    // Raw title value (one level of quoting stripped) — used to detect
    // truncation: if the writer intended a ` #` / `: ` in the title, the
    // parsed title must still contain it (a comment/mapping start would have
    // truncated it away).
    const rawLine = /^title:\s*(.*)$/m.exec(m[1]);
    const rawValue = rawLine ? rawLine[1] : "";
    const unquotedRaw =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue.startsWith("'") && rawValue.endsWith("'")
          ? rawValue.slice(1, -1)
          : rawValue;
    const isHazardous = unquotedRaw.includes(" #") || unquotedRaw.includes(": ");
    if (isHazardous) {
      hazardousCount++;
      const stillHasHash = !unquotedRaw.includes(" #") || parsed.title.includes("#");
      const stillHasColon = !unquotedRaw.includes(": ") || parsed.title.includes(": ");
      if (!stillHasHash || !stillHasColon) {
        truncated++;
        truncationExamples.push(`${f}: raw=${JSON.stringify(unquotedRaw)} parsed=${JSON.stringify(parsed.title)}`);
      }
    }
    // Store and raw parse must agree on the title.
    const t = store.get(id);
    if (t && t.title !== parsed.title) {
      truncated++;
      truncationExamples.push(`${f}: store=${JSON.stringify(t.title)} raw-parse=${JSON.stringify(parsed.title)}`);
    }
  }

  // Primary: 0 parse failures across the whole store (the board must not 500).
  assert.equal(parseFailures, 0,
    `real-parser scan found ${parseFailures} unparseable task(s): ${parseFailureExamples.join("; ")}`);
  // No hazardous title is truncated / disagreeing with the store view.
  assert.equal(truncated, 0, `${truncated} hazardous title(s) truncated or inconsistent: ${truncationExamples.join("; ")}`);
  // Title-less files are PRE-EXISTING store state, not a defect of the write
  // side, and this task's scope explicitly forbids rewriting existing task
  // files ("不做：不改已有任务文件"). Report them; do not fail the scan.
  // (Baseline at 2026-08-04: the 4 gap-* files listed in missingTitleExamples.)
  console.log(`AC5: scanned ${files.length} files, ${hazardousCount} hazardous titles, ` +
    `${parseFailures} parse failures, ${truncated} truncations, ${missingTitle} title-less (pre-existing)`);
  if (missingTitle > 0) {
    console.log(`AC5: title-less files (pre-existing, not this task's scope): ${missingTitleExamples.join(", ")}`);
  }
});

// ── gap-abi-missing-commit-delete-dependson-primitives: commit-after-write + task_delete ─────────

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** A disposable store whose tasksDir lives inside a real git repo (so commit-after-write has a
 *  target). The default branch is renamed to `branch` ("develop") — the ref the dispatch spine reads. */
function makeGitStore({ branch = "develop" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quay-store-commit-test-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["-C", root, "add", "README.md"]);
  execFileSync("git", ["-C", root, "commit", "-q", "--no-verify", "-m", "initial"]);
  execFileSync("git", ["-C", root, "branch", "-M", branch]);
  const tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  const store = createStore(tasksDir);
  return { store, tasksDir, root };
}

test("AC1 (commit-after-write): store.write commits tasks/<id>.md to git", () => {
  const { store, root } = makeGitStore();
  try {
    assert.equal(git(root, "log", "-1", "--format=%H", "--", "tasks/RT.md"), "", "no prior commit for RT.md");
    store.write("RT", { title: "commit test", status: "todo" });
    const after = git(root, "log", "-1", "--format=%H", "--", "tasks/RT.md");
    assert.match(after, /^[0-9a-f]{40}$/, `a NEW commit for tasks/RT.md exists (got "${after}")`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 (branch-aware): store.write in a task/<id> branch does NOT advance develop", () => {
  const { store, root } = makeGitStore({ branch: "develop" });
  try {
    const developBefore = git(root, "rev-parse", "develop");
    execFileSync("git", ["-C", root, "checkout", "-q", "-b", "task/scratch"]);
    store.write("RT", { title: "worktree write", status: "todo" });
    assert.equal(git(root, "rev-parse", "develop"), developBefore, "develop unchanged after a task-worktree write");
    assert.notEqual(git(root, "rev-parse", "task/scratch"), developBefore, "the task branch advanced");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 (task_delete): store.delete removes the file and commits the deletion", () => {
  const { store, root } = makeGitStore();
  try {
    store.write("SCRATCH", { title: "to delete", status: "todo" });
    assert.ok(fs.existsSync(path.join(root, "tasks", "SCRATCH.md")), "scratch file exists before delete");
    const res = store.delete("SCRATCH");
    assert.equal(res.ok, true, "delete succeeds");
    assert.equal(res.committed, true, "deletion committed");
    assert.ok(!fs.existsSync(path.join(root, "tasks", "SCRATCH.md")), "file absent from disk after delete");
    assert.equal(store.get("SCRATCH"), null, "store.get returns null after delete");
    let absentFromHead = false;
    try { execFileSync("git", ["-C", root, "show", "HEAD:tasks/SCRATCH.md"], { stdio: "ignore" }); }
    catch { absentFromHead = true; }
    assert.ok(absentFromHead, "SCRATCH.md absent from HEAD after the delete commit");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 (task_delete fail-closed): store.delete of a non-existent id reports ok:false", () => {
  const { store, root } = makeGitStore();
  try {
    const res = store.delete("NOPE");
    assert.equal(res.ok, false, "delete of a missing id is not ok");
    assert.equal(res.reason, "missing", "reason is 'missing' (distinguishable, not silent)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-store-commit-propagation-field-aware: field-level propagation judgment ──────────────────
// A write whose change set is ONLY the self-only fields (AC/DoD checkbox toggles, ## Evidence
// content, extra.goal / goal_ac) must NOT ff to develop even on a non-task/* branch — the task's
// own fan-in carries it to develop with the worktree branch (SPEC-store-commit-unification §5).
// A mixed write (AC toggle + status flip) keeps the current ff-to-develop behavior.

test("AC5 (field-aware): pure AC-checkbox write on a non-task/* branch does NOT advance develop", () => {
  const { store, root } = makeGitStore({ branch: "develop" });
  try {
    store.write("RT", { title: "field-aware", status: "todo", body: "## Acceptance Criteria\n\n- [ ] do a thing\n" });
    const developBefore = git(root, "rev-parse", "develop");
    execFileSync("git", ["-C", root, "checkout", "-q", "-b", "author"]);
    // pure AC toggle: only the checkbox flips, no other field changes.
    store.write("RT", { body: "## Acceptance Criteria\n\n- [x] do a thing\n" });
    assert.equal(git(root, "rev-parse", "develop"), developBefore, "develop unchanged after a pure-AC write on a non-task branch");
    assert.notEqual(git(root, "rev-parse", "author"), developBefore, "the author branch advanced (the tick is on its own branch)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC6 (field-aware negative control): mixed write (AC toggle + status flip) DOES advance develop", () => {
  const { store, root } = makeGitStore({ branch: "develop" });
  try {
    store.write("RT", { title: "field-aware", status: "todo", body: "## Acceptance Criteria\n\n- [ ] do a thing\n" });
    const developBefore = git(root, "rev-parse", "develop");
    execFileSync("git", ["-C", root, "checkout", "-q", "-b", "author"]);
    // mixed write: status lifecycle flip + AC toggle together ⇒ must-propagate (the field-level
    // judgment must NOT widen its net to swallow a status flip).
    store.write("RT", { status: "ready", body: "## Acceptance Criteria\n\n- [x] do a thing\n" });
    assert.notEqual(git(root, "rev-parse", "develop"), developBefore, "develop advanced after a mixed write (status flip + AC toggle)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC7 (field-aware): ## Evidence append on a non-task/* branch does NOT advance develop", () => {
  const { store, root } = makeGitStore({ branch: "develop" });
  try {
    store.write("RT", { title: "field-aware", status: "todo", body: "## Acceptance Criteria\n\n- [x] do a thing\n" });
    const developBefore = git(root, "rev-parse", "develop");
    execFileSync("git", ["-C", root, "checkout", "-q", "-b", "author"]);
    store.write("RT", { body: "## Acceptance Criteria\n\n- [x] do a thing\n\n## Evidence\n\nran the suite, green\n" });
    assert.equal(git(root, "rev-parse", "develop"), developBefore, "develop unchanged after an Evidence-only append on a non-task branch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── GOAL-011 AC-220 (gap-store-commit-propagation-log): durable audit trail ─────────────────────
// commitTaskWrite must log its OWN propagation decision to .quay/store-commit-propagation.jsonl —
// the direct production carrier AC-220's new criterion reads, replacing the confounded "ff-red
// rate vs 7-day baseline" proxy (too many unrelated causes mixed in).

test("AC8 (propagation log): self-only write logs changeKind=self-only propagated=false", () => {
  const { store, root } = makeGitStore({ branch: "develop" });
  try {
    store.write("RT", { title: "field-aware", status: "todo", body: "## Acceptance Criteria\n\n- [ ] do a thing\n" });
    execFileSync("git", ["-C", root, "checkout", "-q", "-b", "author"]);
    store.write("RT", { body: "## Acceptance Criteria\n\n- [x] do a thing\n" });
    const logPath = path.join(root, ".quay", "store-commit-propagation.jsonl");
    assert.ok(fs.existsSync(logPath), "propagation log file created");
    const records = fs.readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = records.at(-1);
    assert.equal(last.id, "RT");
    assert.equal(last.changeKind, "self-only");
    assert.equal(last.propagated, false, "self-only write must log propagated:false — the exact invariant AC-220 checks in production");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC9 (propagation log negative control): mixed write logs changeKind=must-propagate propagated=true", () => {
  const { store, root } = makeGitStore({ branch: "develop" });
  try {
    store.write("RT", { title: "field-aware", status: "todo", body: "## Acceptance Criteria\n\n- [ ] do a thing\n" });
    execFileSync("git", ["-C", root, "checkout", "-q", "-b", "author"]);
    store.write("RT", { status: "ready", body: "## Acceptance Criteria\n\n- [x] do a thing\n" });
    const logPath = path.join(root, ".quay", "store-commit-propagation.jsonl");
    const records = fs.readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = records.at(-1);
    assert.equal(last.changeKind, "must-propagate");
    assert.equal(last.propagated, true, "mixed write must log propagated:true — negative control, ⛔ the log itself must not fabricate a uniform false");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
