// @test-group product
// DIR-039 AC/DoD: "Single-source: grep confirms both import paths write
// through the ONE native-write function (no duplicated task-writing
// logic)". This test makes that a machine-checked invariant instead of a
// prose claim (ADR-004: hard checks over prose) — it greps src/migrate.js
// itself (the ONE module both `quay migrate --from github --to native`
// (DIR-039-A) and `quay migrate --from backlog --to native` (DIR-039-B)
// funnel through — both are just different `--from` provider ids consumed
// by the SAME migrateTasks()/writeOneTask() pair) and asserts there is
// exactly one `taskWrite(` call site in the whole file.
//
// RED->GREEN (ADR-001): this test would fail the moment a second,
// parallel task-writing code path were added anywhere in src/migrate.js
// (e.g. a Backlog.md-specific write branch bypassing writeOneTask()).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrateSrc = path.join(__dirname, "..", "src", "migrate.ts");

test("src/migrate.js has exactly ONE taskWrite(...) call site (single-source native-write)", () => {
  const content = fs.readFileSync(migrateSrc, "utf8");
  const matches = content.match(/\btarget\.taskWrite\(/g) || [];
  assert.equal(matches.length, 1, `expected exactly one target.taskWrite(...) call site in migrate.js, found ${matches.length}`);
});

test("writeOneTask is exported and migrateTasks is the only CODE caller of it in this file", () => {
  const content = fs.readFileSync(migrateSrc, "utf8");
  assert.match(content, /export async function writeOneTask/);
  // Strip line/block comments before counting call sites, so doc-comment
  // mentions of "writeOneTask(" don't inflate the count — only real code
  // tokens matter here.
  const codeOnly = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const callSites = codeOnly.match(/\bwriteOneTask\(/g) || [];
  // One definition-site match ("function writeOneTask(") + exactly one real
  // call site inside migrateTasks() -- i.e. exactly 2 occurrences of the
  // token in actual code, never a second independent call site.
  assert.equal(callSites.length, 2, `expected exactly 2 code occurrences of writeOneTask( (1 definition + 1 call), found ${callSites.length}`);
});

test("no OTHER src file in packages/quay/src re-implements a bulk taskList->taskWrite copy loop that bypasses migrate.js", () => {
  // Every *.js file under packages/quay/src EXCEPT migrate.js itself must
  // not itself call taskWrite() in a LOOP over a taskList() result (that
  // shape -- iterate every task from one source, write each to another --
  // is specifically the bulk-migration-writer pattern this task requires
  // to be single-sourced). Core's own src/mcp-server.js legitimately
  // implements single, independent task_list and task_write MCP TOOL
  // handlers (one call in, one call out, never a source->target copy loop)
  // -- a real, pre-existing, unrelated use of both method names that must
  // NOT be flagged. The actual single-source signal is a `for`/`.map`/
  // `for...of` loop construct whose body calls `.taskWrite(` — that is
  // what would indicate a second, parallel bulk-copier.
  const srcDir = path.join(__dirname, "..", "src");
  const offenders = [];
  const LOOP_WRITE_RE = /(for\s*\([^)]*\)|\.map\(|for\s*\(\s*const\s+\w+\s+of\s+)[^;]*?\{[^}]*?\.taskWrite\(/s;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".js") && !entry.name.endsWith(".ts")) continue;
      if (full === migrateSrc) continue;
      const content = fs.readFileSync(full, "utf8");
      if (LOOP_WRITE_RE.test(content)) {
        offenders.push(full);
      }
    }
  }
  walk(srcDir);
  assert.deepEqual(offenders, [], `found a file besides migrate.js with a loop-construct calling taskWrite (possible duplicated bulk migration writer): ${offenders.join(", ")}`);
});
