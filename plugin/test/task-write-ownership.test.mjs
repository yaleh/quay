// @test-group engine
// task-write-ownership.test.mjs — gap-task-file-develop-integration-drift-fan-in-conflicts, AC3:
// WRITE-OWNERSHIP SEPARATION for task files. The `status:` frontmatter is owned EXCLUSIVELY by the
// outer layer (status flips / records); the inner task agent only APPENDS body sections (AC
// checkbox ticks, Evidence, invoke records) — it never writes frontmatter. `appendBodySection`
// (task-schema.ts) is the mechanical enforcement of "Evidence 追加，不整体覆盖"
// (Contract invariant evidence_append_not_overwrite = 1):
//
//   AC1  append to a task body WITHOUT touching the frontmatter block (frontmatter byte-for-byte
//        unchanged) — a new `## Evidence` section is created at the end of the body.
//   AC2  append INTO an existing section (e.g. `## AC`) lands at the END of that section (true
//        append, not overwrite), with markdown blank-line hygiene before the next heading.
//   AC3  a file with NO frontmatter fails closed (cannot guarantee write-ownership) — it returns
//        { ok:false }, never a partial write.
//   AC4  the frontmatter block (including `status:`) is never rewritten — the appended output's
//        frontmatterRaw is byte-identical to the input's.
//
// Run: scripts/test.sh plugin/test/task-write-ownership.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendBodySection } from "../scripts/task-schema.ts";

const TASK = [
  "---",
  "id: gap-demo",
  "status: ready",
  "---",
  "",
  "## Proposal",
  "",
  "proposal body",
  "",
  "## AC",
  "",
  "- [ ] a",
  "",
  "## DoD",
  "",
  "- [ ] b",
  "",
].join("\n");

test("AC1: appendBodySection adds a new ## Evidence section WITHOUT touching frontmatter", () => {
  const r = appendBodySection(TASK, "Evidence", "invoke: `node --test ...`");
  assert.equal(r.ok, true, r.reason);
  // frontmatter block byte-identical
  const inputFm = TASK.match(/^---\r?\n([\s\S]*?)\r?\n---/)[0];
  const outFm = r.fullText.match(/^---\r?\n([\s\S]*?)\r?\n---/)[0];
  assert.equal(outFm, inputFm, "frontmatter must be byte-for-byte unchanged");
  // status: still ready (outer-owned, untouched by inner append)
  assert.match(r.fullText, /^status:\s*ready$/m);
  // evidence section present at the end with the content
  assert.match(r.fullText, /## Evidence\n\ninvoke: `node --test \.\.\.`/);
  // original body content preserved (append, not overwrite)
  assert.match(r.fullText, /- \[ \] a/);
  assert.match(r.fullText, /- \[ \] b/);
});

test("AC2: append INTO an existing section lands at the END of that section, not overwriting", () => {
  const r = appendBodySection(TASK, "AC", "- [x] a");
  assert.equal(r.ok, true, r.reason);
  const acSection = r.fullText.match(/## AC\n\n([\s\S]*?)\n\n## DoD/)[1];
  // both the original unchecked box and the newly-ticked box are present (append semantics)
  assert.match(acSection, /- \[ \] a/);
  assert.match(acSection, /- \[x\] a/);
  // the appended line is AFTER the original (true append at section end)
  assert.ok(acSection.indexOf("- [ ] a") < acSection.indexOf("- [x] a"), "append must land at section end");
  // DoD section intact and separated by a blank line
  assert.match(r.fullText, /## DoD\n\n- \[ \] b/);
  // frontmatter untouched
  assert.match(r.fullText, /^status:\s*ready$/m);
});

test("AC3: no-frontmatter input fails closed (cannot guarantee write-ownership)", () => {
  const r = appendBodySection("no frontmatter here\njust prose\n", "Evidence", "x");
  assert.equal(r.ok, false);
  assert.match(r.reason, /no frontmatter/);
});

test("AC4: frontmatter block is never rewritten (byte-identical) for both append paths", () => {
  const fmPattern = /^---\r?\n([\s\S]*?)\r?\n---/;
  const inputFm = TASK.match(fmPattern)[1];
  for (const [heading, content] of [["Evidence", "invoke: x"], ["AC", "- [x] a"], ["DoD", "- [x] b"]]) {
    const r = appendBodySection(TASK, heading, content);
    assert.equal(r.ok, true, `${heading}: ${r.reason}`);
    assert.equal(r.fullText.match(fmPattern)[1], inputFm, `frontmatter unchanged for append to ${heading}`);
  }
});
