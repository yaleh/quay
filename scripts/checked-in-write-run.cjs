// checked-in-write-run.cjs — load ONE input file under the write guard, and say whether its module
// evaluation completed. Called by `checked-in-write-check.ts` (gap-fixture-dir-write-races-whole-tree-copy).
//
// WHY THIS EXISTS — 硬规则 3b, the case that a plain green would hide: a test file that FAILS TO LOAD
//   performs no writes, so a judge that only counts writes reports it clean. It is not clean, it is
//   UNREAD. Observing "the file was opened" is not enough either — the loader opens a module before
//   it evaluates it, so a broken import still looks opened (measured: an input whose import threw
//   still produced a moduleOpened record and a green verdict). The signal that actually separates
//   the two is completion of module evaluation, and that is only observable from the code doing the
//   importing. So the criterion imports each input itself and records which one of the two happened:
//     { "evaluated": "<path>" }                      module evaluation ran to the end
//     { "evaluationFailed": "<path>", "error": … }   it threw (missing module, syntax error, …)
//
// It is a CJS file deliberately: `plugin/scripts/*.{sh,ts,mjs}` is the capability catalog's derived
// glob, so a `.cjs` support file does not enter the catalog as an undeclared capability. The two
// shipped capabilities of this mechanism are `checked-in-write-guard.cjs` (the runtime judge) and
// `checked-in-write-check.ts` (the criterion that declares its question).
//
// This process is the ENTRY, so `node:test`'s implicit root runner still executes the tests a
// `*.test.mjs` registers at import time — measured: importing
// plugin/test/workflow-replay.test.mjs from here runs all 21 of its tests. The criterion does not
// read test outcomes; it reads the guard log. Test outcomes remain the suite's business.
"use strict";

const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const INPUT = process.env.QUAY_WRITE_GUARD_INPUT || "";
const LOG = process.env.QUAY_WRITE_GUARD_LOG || "";

function note(obj) {
  if (!LOG) return;
  try { fs.appendFileSync(LOG, JSON.stringify(obj) + "\n"); } catch { /* best-effort */ }
}

if (!INPUT) {
  note({ evaluationFailed: "<none>", error: "QUAY_WRITE_GUARD_INPUT unset" });
  process.exitCode = 2;
} else {
  import(pathToFileURL(INPUT).href).then(
    () => note({ evaluated: INPUT }),
    (err) => {
      note({ evaluationFailed: INPUT, error: String((err && err.message) || err) });
      process.exitCode = 1;
    },
  );
}
