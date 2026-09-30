// criterion-carrier-inline-check.ts — NO goal criterion may INLINE the live-host carrier path.
//
// THE DEFECT IT PREVENTS (gap-criterion-live-web-address-derivation-17-copies-to-one, P4).
// "Read this root's live web address" was inlined in 17 goal criteria, and the copies had already
// drifted into THREE different semantics (a missing `up` field was read as pass, as fail and as
// unusable in different files; one copy used `require()` and had lost the schemaVersion gate). The
// single definition point is now `plugin/scripts/live-web-address.ts`, and every criterion CALLS it.
// A criterion that still names the carrier is, by construction, an 18th copy — so this checker makes
// the recurrence impossible instead of waiting to count it again in a week (硬规则 5b: the defects
// are clustered; the one that gets reported is not the one that matters).
//
// PREDICATE (positional, 硬规则 2). It reads the CRITERION TEXT of every goal record — the executable
// block — and reports any occurrence of the carrier's file name there. ⛔ It deliberately does NOT
// scan the surrounding prose (`origin` / `expect`, the revision notes after the frontmatter): the
// property under test is about the EXECUTABLE STEP, and a document that *talks about* the carrier is
// not a second implementation of reading it. (The repository-wide `grep` that the task's AC1 uses is
// a different, wider measurement; this checker owns only the criterion position.)
//
// FAIL-CLOSED, and the "cannot evaluate" case is DISTINCT (硬规则 3b): an unreadable goals directory
// is exit 2 with a CAUSE, never exit 0 with an empty violation list that reads as "everything is
// fine".
//
// Usage:
//   node --no-warnings --experimental-strip-types criterion-carrier-inline-check.ts [--root <dir>]
// Exit codes: 0 = every criterion is clean; 1 = >=1 criterion inlines the carrier; 2 = usage/env.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { helpExit } from "./gate-script-base.ts";

/** `--help` prints usage FIRST and exits 0, side-effect-free — the `-check.ts` contract pinned by
 *  plugin/test/help-contract-incompatible-behaviors.test.mjs. ⛔ Not optional: a `-check.ts` that
 *  rejects `--help` reads as a harness failure, and one that silently runs would be worse. */
const USAGE = `criterion-carrier-inline-check — no goal criterion may inline the live-host carrier path.

Usage:
  node --no-warnings --experimental-strip-types criterion-carrier-inline-check.ts [--root <dir>]

Reads every <root>/goals/*.md record and reports any whose CRITERION text names the live-host
carrier file — an inlined copy of the derivation plugin/scripts/live-web-address.ts owns.
⛔ Only the criterion position is read; origin/expect prose is never scanned.

Exit codes:
  0  every criterion is clean
  1  >=1 criterion inlines the carrier (named, with its goal file)
  2  usage error, or the goals dir cannot be read (NOT-EVALUATED, ⛔ never an empty pass)
`;

/** The file name a criterion must NOT name itself. Any occurrence — in an inline `node -e` payload,
 *  in a shell variable assignment, even in a `#` comment — is reported: the criterion is executable
 *  text, so a mention there is a step someone wrote down, not prose about one. */
export const CARRIER_LITERAL = "server.json";

export interface InlineViolation {
  /** Goal file basename, so the report names the carrier a reader can open. */
  file: string;
  /** The record's `id` when the frontmatter carries one (falls back to the file name). */
  id: string;
}

/** TRUE ⇔ this criterion text names the carrier itself. Exported so the RED/GREEN test can drive the
 *  predicate directly, the same way every other checker in this repo exposes its judgment. */
export function criterionInlinesCarrier(criterion: unknown): boolean {
  return typeof criterion === "string" && criterion.includes(CARRIER_LITERAL);
}

/** Every violation under `<goalDir>/*.md`. Files whose frontmatter cannot be read are REPORTED as a
 *  violation rather than skipped: "I could not read this record" must not look like "this record is
 *  clean" (硬规则 3b). */
export function scanGoalDir(goalDir: string): InlineViolation[] {
  const out: InlineViolation[] = [];
  for (const name of fs.readdirSync(goalDir).sort()) {
    if (!name.endsWith(".md")) continue;
    const raw = fs.readFileSync(path.join(goalDir, name), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    if (!fm) {
      out.push({ file: name, id: `${name} (no YAML frontmatter — cannot evaluate)` });
      continue;
    }
    let doc: unknown;
    try {
      doc = parseYaml(fm[1]);
    } catch (e) {
      out.push({ file: name, id: `${name} (frontmatter unreadable: ${(e as Error).message})` });
      continue;
    }
    if (doc === null || typeof doc !== "object") continue;
    const rec = doc as { id?: unknown; criterion?: unknown };
    if (criterionInlinesCarrier(rec.criterion)) out.push({ file: name, id: String(rec.id ?? name) });
  }
  return out;
}

function main(argv: readonly string[]): number {
  // The `-check.ts` help contract, evaluated BEFORE any work: usage + exit 0, no side effect.
  if (argv.includes("--help") || argv.includes("-h")) helpExit(USAGE);
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      const v = argv[i + 1];
      if (!v) {
        process.stderr.write("criterion-carrier-inline-check: --root requires a directory\n");
        return 2;
      }
      root = path.resolve(v);
      i++;
    } else {
      process.stderr.write(`criterion-carrier-inline-check: unknown argument ${argv[i]}\n`);
      return 2;
    }
  }
  const goalDir = path.join(root, "goals");
  if (!fs.existsSync(goalDir) || !fs.statSync(goalDir).isDirectory()) {
    // ⛔ NOT an empty pass: a missing goals dir is an unanswerable question, not a clean one.
    process.stderr.write(
      `CAUSE=goals-dir-absent — ${goalDir} is not a directory, so "no criterion inlines the carrier" cannot be evaluated here (⛔ an empty result must not wear the shape of a pass)\n`,
    );
    return 2;
  }
  const violations = scanGoalDir(goalDir);
  if (violations.length === 0) {
    process.stdout.write(`criterion-carrier-inline-check: 0 criterion(s) inline "${CARRIER_LITERAL}" under ${goalDir}\n`);
    return 0;
  }
  process.stderr.write(
    `criterion-carrier-inline-check: ${violations.length} criterion(s) inline "${CARRIER_LITERAL}" — the address must come from plugin/scripts/live-web-address.ts, ⛔ never from a criterion's own carrier read:\n`,
  );
  for (const v of violations) process.stderr.write(`  ${v.id}  (${v.file})\n`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
