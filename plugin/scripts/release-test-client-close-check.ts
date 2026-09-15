#!/usr/bin/env node
// release-test-client-close-check.ts — for every test file the RELEASE job actually runs, assert that
// each MCP client it opens is closed on EVERY exit path (inside a `finally`), not only the happy one.
// (tasks/gap-release-run-tests-hangs-on-shared-mcp-client-leak, GOAL-020 AC-266; Requested action 5)
//
// THE DEFECT THIS EXISTS FOR (measured, not hypothesised): the release job's `Run tests` step runs a
// hand-scoped glob and deliberately sets no GH_TOKEN. `packages/quay/test/mcp-server.test.mjs` opened a
// shared `quay mcp` client and closed it on the HAPPY PATH only; a block that threw (the live-GitHub
// block, with no credentials) skipped the close, the `quay mcp` child — and that child's own provider
// subprocess — stayed alive, the stdio handle held the event loop open, and `node --test` never
// exited. Measured in the release channel: 30m21s (v0.6.2) and 30m17s (v0.6.3) against
// `timeout-minutes: 30`, 26 of those minutes with zero output — the job's gate degraded from "can
// report red" to "reports nothing at all". Reproduced locally by emulating CI's unauthenticated `gh`
// (GH_CONFIG_DIR → an empty dir): exit 124, `pass 0 / fail 0 / cancelled 1`, 149946 ms.
//
// WHY A FILE-LEVEL CHECK RATHER THAN A SUITE RUN: the hang IS the failure mode, so a check that
// discovers it by running the suite would take 30 minutes and only fire where the credentials happen
// to be absent. This asks the structural question directly and costs milliseconds.
//
// THE PREDICATE (position-based — hard rule 2; `//` comments are stripped before every decision, so
// prose describing the rule can never satisfy it):
//   for each binding of the form
//       const { client: X, ... } = await connectStdio( … )     (or the shorthand `{ client, … }`)
//   the file must contain `X.close()` INSIDE A `finally` BLOCK.
// The binding sites are derived from the file; the glob set is derived from the workflow — neither is
// hardcoded here, because a hardcoded list is a copy that drifts from the thing it copies.
//
// ⛔ WHAT THIS DOES **NOT** COVER — declared, not silently skipped (hard rule 3b):
//   (a) A client obtained WITHOUT the destructuring form (`let core; core = await connectStdio(…)`,
//       or `const nativeClient = await connectStdio(…)`) is NOT a binding this checker judges. Those
//       are counted and PRINTED as `skippedForm` on every run, so the blind spot has a number and
//       cannot be read as "clean". A bare count of `skippedForm > 0` is not a violation — widening
//       the predicate to cover it is a separate decision with its own blast radius (it would red
//       files whose teardown is exception-safe by a different mechanism, e.g. node:test's `after()`).
//   (b) Exception-safety achieved by `after()` hooks is not recognised here. That is deliberate:
//       `after()` runs on the throwing path, so files using it are not defective, and a checker that
//       demanded a literal `finally` from them would be a false-positive generator. The two files
//       this defect actually lived in used neither `finally` nor `after()`.
//   (c) Only the release job's glob is judged. The full suite (scripts/test.sh) has a wider glob;
//       this checker's object is the RELEASE surface named in its title.
//
// THREE-STATE OUTPUT (hard rule 3b — "could not read the input" must never render as "clean"):
//   0 = PASS — every destructured client binding is closed in a `finally`; the denominators (files
//       scanned, bindings checked) are printed alongside, so a pass always carries what it covered.
//   1 = FAIL — at least one binding is not closed on the throwing path; each is named file:line.
//   3 = NOT-EVALUATED — the release workflow or its `Run tests` glob cannot be read, the glob matches
//       ZERO files, or a file with a `connectStdio` call cannot be brace-parsed. NOT conflated with
//       exit 0: `0 bindings checked` is a reading, but it is NOT a pass, because nothing was checked.
//   2 = usage/environment error.
//
// Run:
//   node --experimental-strip-types plugin/scripts/release-test-client-close-check.ts [--root <dir>] [--json]

import fs from "node:fs";
import path from "node:path";
import { emitPass, emitFail, emitNotEvaluated, isDirectEntry } from "./gate-script-base.ts";

/** The workflow whose `Run tests` step defines the release surface this checker judges. */
export const WORKFLOW_REL = ".github/workflows/release.yml";

/** The step name that identifies the release job's test invocation. */
export const STEP_NAME = "Run tests";

export interface Binding {
  /** The client variable name bound by the destructuring pattern. */
  name: string;
  /** 1-based line of the `const { client: X } = await connectStdio(` binding. */
  line: number;
}

export interface FileReport {
  file: string;
  bindings: Binding[];
  /** Bindings NOT closed inside any `finally` block — the violations. */
  unclosed: Binding[];
  /** `connectStdio` call sites that are not destructured client bindings (blind spot, reported). */
  skippedForm: number;
}

/** Strip a `//` line comment. Everything a decision is made on goes through this first (hard rule 2):
 *  the file that motivated this checker contains prose describing the very rule being checked. */
export function stripLineComment(line: string): string {
  const i = line.indexOf("//");
  return i === -1 ? line : line.slice(0, i);
}

/** Extract the client-binding names from one destructuring pattern's inner text.
 *  Handles `client: X` and the shorthand `client`; ignores every other property (`transport: T`). */
export function clientNamesFromPattern(inner: string): string[] {
  const out: string[] = [];
  for (const part of inner.split(",")) {
    const p = part.trim();
    if (p === "client") {
      out.push("client");
      continue;
    }
    const m = /^client\s*:\s*([A-Za-z_$][\w$]*)$/.exec(p);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Find every `const { … } = await connectStdio(` destructured client binding, by position. */
export function findBindings(lines: string[]): { bindings: Binding[]; callSites: number } {
  const bindings: Binding[] = [];
  let callSites = 0;
  for (let i = 0; i < lines.length; i++) {
    const code = stripLineComment(lines[i]);
    if (!/\bawait\s+connectStdio\s*\(/.test(code)) continue;
    callSites++;
    const m = /const\s*\{([^}]*)\}\s*=\s*await\s+connectStdio\s*\(/.exec(code);
    if (!m) continue; // a non-destructuring binding — counted as skippedForm by the caller
    for (const name of clientNamesFromPattern(m[1])) bindings.push({ name, line: i + 1 });
  }
  return { bindings, callSites };
}

/** Indentation (count of leading spaces) of a line; tab counts as one column. */
function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].length : 0;
}

/** Is the `X.close()` on line `closeIdx` (0-based) DIRECTLY inside a `finally` block?
 *
 *  This walks UP from the close call to the NEAREST enclosing block terminator — the first line above
 *  it that is indented LESS than the close call and whose code begins with `}` — and asks whether that
 *  terminator is a `finally`. In this repo's uniformly 2-space-indented sources that terminator is
 *  exactly the `}` that closes the enclosing block, so no brace counting is needed. That matters:
 *  a global brace counter over arbitrary JS/TS text is defeated by braces inside string and template
 *  literals (measured: 31 of the release glob's 250 files, including the very file this checker
 *  exists for, came back unbalanced) — and a parser that silently mis-parses is worse than one that
 *  refuses (hard rule 3b).
 *
 *  The single-line form `} finally { await x.close(); }` is accepted by the first test. */
export function isClosedInsideFinally(lines: string[], closeIdx: number): boolean {
  const own = stripLineComment(lines[closeIdx]);
  if (/\bfinally\b/.test(own)) return true; // same-line form
  const ind = indentOf(lines[closeIdx]);
  for (let i = closeIdx - 1; i >= 0; i--) {
    const code = stripLineComment(lines[i]);
    if (code.trim() === "") continue;
    if (indentOf(lines[i]) >= ind) continue;
    if (!code.trim().startsWith("}")) continue;
    return /\bfinally\b/.test(code);
  }
  return false;
}

/** Judge ONE file's source text. Pure: the mutation case and any companion test drive this directly. */
export function checkFileText(file: string, text: string): FileReport {
  const lines = String(text).split(/\r?\n/);
  const { bindings, callSites } = findBindings(lines);
  const unclosed = bindings.filter((b) => {
    const re = new RegExp(`\\b${b.name}\\s*\\.\\s*close\\s*\\(`);
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(stripLineComment(lines[i]))) continue;
      if (isClosedInsideFinally(lines, i)) return false;
    }
    return true; // no close at all, or every close sits on a non-finally path
  });
  return { file, bindings, unclosed, skippedForm: callSites - bindings.length };
}

/** Expand a shell-style single-`*`-per-segment glob under `root`. Returns [] when nothing matches. */
export function expandGlob(root: string, pattern: string): string[] {
  const segs = pattern.split("/").filter((s) => s !== "");
  let dirs = [root];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const next: string[] = [];
    for (const dir of dirs) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      if (seg.includes("*")) {
        const re = new RegExp("^" + seg.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
        for (const e of entries) {
          if (!re.test(e.name)) continue;
          const full = path.join(dir, e.name);
          if (last ? e.isFile() : e.isDirectory()) next.push(full);
        }
      } else {
        const full = path.join(dir, seg);
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (last ? st.isFile() : st.isDirectory()) next.push(full);
      }
    }
    dirs = next;
  }
  return dirs.sort();
}

/** Derive the release job's test globs from the workflow text. Returns null when it cannot be read
 *  (⇒ NOT-EVALUATED): the step, its `run:`, or its globs were not found. */
export function globsFromWorkflow(text: string): string[] | null {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith(`- name: ${STEP_NAME}`));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*-\s+name:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const step = lines.slice(start + 1, end);
  const runIdx = step.findIndex((l) => /^\s*run:/.test(l));
  if (runIdx === -1) return null;
  let command = step[runIdx].replace(/^\s*run:\s*/, "");
  if (command.trim() === "" || command.trim() === "|") {
    // block scalar: take the following, more-indented, non-comment lines
    const parts: string[] = [];
    for (let i = runIdx + 1; i < step.length; i++) {
      const l = step[i];
      if (l.trim() === "") continue;
      if (!/^\s{8,}/.test(l)) break;
      parts.push(l);
    }
    command = parts.join("\n");
  }
  const tokens = command
    .split("\n")
    .map((l) => l.split("#", 1)[0])
    .join(" ")
    .split(/\s+/)
    .filter((t) => t.includes("*"));
  return tokens.length > 0 ? tokens : null;
}

function usage(): string {
  return [
    "usage: release-test-client-close-check.ts [--root <dir>] [--json]",
    "",
    "Judges the test glob the release workflow's `Run tests` step actually runs:",
    "every `const { client: X } = await connectStdio( … )` binding must have X.close()",
    "inside a `finally` block, so a throwing block cannot leak the `quay mcp` child.",
  ].join("\n");
}

function main(argv: string[]): number {
  let root = process.cwd();
  const json = argv.includes("--json");
  const rootIdx = argv.indexOf("--root");
  if (rootIdx !== -1) {
    const v = argv[rootIdx + 1];
    if (!v) return emitFail("--root requires a directory argument", undefined, { json });
    root = path.resolve(v);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }

  const wfPath = path.join(root, WORKFLOW_REL);
  if (!fs.existsSync(wfPath)) {
    return emitNotEvaluated(
      `NOT-EVALUATED — no release workflow at ${wfPath}; this checker's object is the release job's own glob, so it cannot judge anything here (⛔ not "all clients are closed")`,
      undefined,
      { json },
    );
  }
  const globs = globsFromWorkflow(fs.readFileSync(wfPath, "utf8"));
  if (globs === null) {
    return emitNotEvaluated(
      `NOT-EVALUATED — could not read a \`${STEP_NAME}\` step with a glob-bearing run command out of ${wfPath}; the release surface moved and this checker would be judging the wrong file set (⛔ not "clean")`,
      undefined,
      { json },
    );
  }

  const files = globs.flatMap((g) => expandGlob(root, g));
  if (files.length === 0) {
    return emitNotEvaluated(
      `NOT-EVALUATED — the release globs [${globs.join(" ")}] matched ZERO files under ${root}; nothing was read, so this is not a pass (⛔ not "all clients are closed")`,
      { globs },
      { json },
    );
  }

  const reports: FileReport[] = [];
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    reports.push(checkFileText(rel, fs.readFileSync(abs, "utf8")));
  }

  const bindings = reports.reduce((n, r) => n + r.bindings.length, 0);
  const skippedForm = reports.reduce((n, r) => n + r.skippedForm, 0);
  const violations = reports.filter((r) => r.unclosed.length > 0);
  const scanned = `files scanned ${files.length} (globs ${globs.join(" ")}), bindings checked ${bindings}, non-destructuring connectStdio call sites NOT judged ${skippedForm}`;

  if (bindings === 0) {
    return emitNotEvaluated(
      `NOT-EVALUATED — ${scanned}; ZERO destructured client bindings were found, so nothing was actually judged (⛔ not "all clients are closed")`,
      { files: files.length, bindings, skippedForm, globs },
      { json },
    );
  }

  if (violations.length === 0) {
    return emitPass(
      `every destructured connectStdio client binding in the release glob is closed inside a finally — ${scanned}`,
      { files: files.length, bindings, skippedForm, globs },
      { json },
    );
  }

  const detail = violations
    .map((r) => `${r.file}: ${r.unclosed.map((b) => `'${b.name}' bound at line ${b.line} is never closed inside a finally`).join("; ")}`)
    .join("\n  ");
  return emitFail(
    `release-glob client leak — a throwing block would skip the close, leaving the MCP child alive and \`node --test\` unable to exit (AC-266: measured 30m21s / 30m17s against a 30m job timeout):\n  ${detail}\n  (${scanned})`,
    { violations: violations.map((r) => ({ file: r.file, unclosed: r.unclosed })), files: files.length, bindings, skippedForm },
    { json },
  );
}

if (isDirectEntry(import.meta, process.argv[1], "release-test-client-close-check")) {
  process.exit(main(process.argv.slice(2)));
}
