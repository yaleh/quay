// measure-suite-reporter.mjs — custom node:test reporter for per-file duration capture.
//
// Task: gap-suite-cost-model-is-wrong-optimizations-buy-nothing (AC1)
//
// node's --test runs every file (custom-harness scripts AND node:test files) as a
// child process and emits a FILE-LEVEL `test:complete` event whose `name` equals the
// file's basename and whose `details.duration_ms` is the file's wall duration in the
// concurrent run. This reporter forwards exactly those events, one line per file:
//
//   __PERFILE__ <basename> <duration_ms> <passed>
//
// on the reporter destination (stderr), which measure-suite.mjs parses.
//
// The reporter is a measurement instrument only — it never touches test files or
// assertions.
import path from "node:path";

export default async function* perFileReporter(source) {
  for await (const e of source) {
    if (e.type !== "test:complete" || !e.data || !e.data.file) continue;
    const d = e.data;
    // File-level complete: node labels it with the path string AS PASSED on the CLI
    // (relative when given relative, absolute when given absolute), so it resolves to
    // the same file as d.file. Individual test() calls carry the file path too but
    // their name is the test title, which never resolves to a real file.
    if (path.resolve(d.name) === d.file) {
      // Emit the FULL path (not basename) so duplicate basenames across packages
      // (cli.test.mjs in packages/quay|quay-github/test, etc.) cannot collide.
      console.error(
        `__PERFILE__ ${d.file} ${d.details?.duration_ms ?? 0} ${d.details?.passed === true}`
      );
    }
  }
}
