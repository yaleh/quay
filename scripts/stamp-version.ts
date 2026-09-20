#!/usr/bin/env node --experimental-strip-types
/**
 * stamp-version — write the SINGLE SOURCE's derived version into every carrier (and, in build mode,
 * into a build artifact tree).
 *
 * (tasks/gap-version-stamp-generator-and-build-wiring, 2026-09-20; human ruling, verbatim:
 *  「a. 仍提交字面量，但写死为基础版本加 -dev，由生成器在改 VERSION 时一并更新。」
 *  「可以在 build 过程中，监测分支并加后缀，如 -dev。」)
 *
 * ── WHAT IT REPLACES ─────────────────────────────────────────────────────────────────────────────
 * Bumping the version meant hand-editing 15 literals before `version-consistency-check` went green,
 * and `packages/quay/scripts/package.sh` carried its own hand-copied three-way comparison (package.json
 * vs marketplace.json vs plugin.json) as an after-the-fact verification. Both are now this one command:
 * the carrier set is the shared table in `version-carriers.ts` (the SAME table the judge imports), and
 * package.sh's gate is this command's `--check` mode.
 *
 * ── THE TWO MODES ────────────────────────────────────────────────────────────────────────────────
 * `tracked` (default) — every committed literal, in the repo layout, == `resolveVersion(VERSION,
 *   'tracked')` (`X.Y.Z-dev`, always, on every branch). This is the mode a version bump runs.
 * `build` — a build artifact tree's carriers (the `plugin/`-prefixed members of the shared table,
 *   projected by dropping that prefix — see `buildCarriers`) == `resolveVersion(VERSION, 'build')`.
 *   `X.Y.Z` iff HEAD is exactly at tag `vX.Y.Z` or the branch is `release/*`; `X.Y.Z-dev` otherwise.
 *   Run by `sync-vendor.sh` / `publish-dist-branch.sh` after they produce their tree, so the released
 *   artifact carries the released version while every committed literal stays `X.Y.Z-dev` (the human
 *   ruling: the tag commit no longer self-describes, so a release needs no de-suffixing bump commit).
 *   `--root` names the tree to stamp; `--git-root` names the CHECKOUT whose branch/tags decide the
 *   suffix (a staged/dist tree is not a checkout — resolve-version.ts reads git from `--git-root`).
 *
 * ── THREE-VALUED, NEVER BOOLEAN (hard rule 3b) ───────────────────────────────────────────────────
 * If the mode cannot be judged (`build` on a detached HEAD with no version tag), this exits 3 and
 * writes NOTHING. Stamping a guess would put a wrong version into a release artifact while every
 * downstream check read it as "a version" — the exact shape (could not read ⇒ looks like a pass) this
 * repo has been burned by. A carrier that cannot be read or whose anchors disagree is an ERROR and
 * aborts the whole run: a partially stamped tree is worse than an unstamped one, because it reads as
 * "the generator ran".
 *
 * Usage:
 *   node --experimental-strip-types scripts/stamp-version.ts [--mode tracked|build] [--root <dir>]
 *     [--git-root <dir>] [--check] [--json]
 *     --mode      tracked (default) | build
 *     --root      the tree whose carriers are read/written (default: this script's repo root)
 *     --git-root  the checkout whose branch/tags/VERSION decide the target (default: --root in
 *                 tracked mode, this script's repo root in build mode)
 *     --check     report only — never write. Exit 1 when any carrier differs (or cannot be read).
 *     --json      emit a machine-readable summary on stdout (the verdict, not the prose)
 *
 * Exit codes:
 *   0 = every carrier already equals the target (check mode), or every carrier was written (write mode)
 *   1 = DRIFT (check mode: at least one carrier differs) or ERROR (a carrier is unreadable/unanchored)
 *   2 = usage error
 *   3 = NOT-EVALUATED — `build` mode could not judge the target; nothing was written
 *
 * ⛔ Node-FLOOR NOTE: this file is source-form `.ts`, which needs Node >= 22.6
 * (`--experimental-strip-types`). Two of its three callers (`packages/quay/scripts/package.sh`, which
 * ci.yml's dist-verify-node-floor job runs on Node 20; and `plugin/scripts/sync-vendor.sh`, whose
 * npm-postinstall caller is on the declared floor `engines: >=20`) must keep working there, so they
 * reach THIS source through the Node-20-safe `scripts/stamp-version.mjs` entry (esbuild-bundles this
 * file — the same TS parser the floor-safe dist build already uses). One implementation, two ways in.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaseVersion, resolveVersion, readGitContext, type ResolveMode } from './resolve-version.ts';
import {
  VERSION_CARRIERS,
  buildCarriers,
  readCarrierVersion,
  stampedContent,
  type VersionCarrier,
} from './version-carriers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, '..');

/** The prefix a build artifact tree drops: its root IS the plugin root (see `buildCarriers`). */
export const BUILD_TREE_PREFIX = 'plugin';

export interface StampEntry {
  label: string;
  path: string;
  /** the version the carrier holds now ('' when unreadable) */
  before: string;
  /** the version it must hold */
  after: string;
  changed: boolean;
  error?: string;
  /** true iff this run actually wrote the file */
  wrote: boolean;
}

export interface StampReport {
  mode: ResolveMode;
  /** false ⇒ nothing was judged and nothing was written (build mode's NOT-EVALUATED) */
  evaluated: boolean;
  reason: string;
  /** the bare source read from `VERSION` ('' when unevaluable) */
  base: string;
  /** `resolveVersion(base, mode)` — what every carrier must equal ('' when unevaluable) */
  expected: string;
  /** the tree the carriers were read/written in */
  root: string;
  entries: StampEntry[];
  errors: StampEntry[];
  drift: StampEntry[];
  /** files actually written this run (deduped, repo-relative to `root`) */
  written: string[];
}

/**
 * The judgment + (optionally) the write, over one carrier tree. Pure with respect to `write`: pass
 * `write: false` and nothing touches disk. Errors abort the WHOLE run — see the header.
 */
export function stamp(opts: {
  root: string;
  carriers: VersionCarrier[];
  expected: string;
  mode: ResolveMode;
  evaluated: boolean;
  reason: string;
  base: string;
  write: boolean;
}): StampReport {
  const entries: StampEntry[] = [];
  const errors: StampEntry[] = [];
  const drift: StampEntry[] = [];
  const written: string[] = [];

  if (!opts.evaluated) {
    // No judgment is possible. Report the reason and touch nothing (hard rule 3b).
    return {
      mode: opts.mode,
      evaluated: false,
      reason: opts.reason,
      base: opts.base,
      expected: '',
      root: opts.root,
      entries,
      errors,
      drift,
      written,
    };
  }

  // PASS 1 — judge EVERY carrier before writing ANY. A single-pass write would leave a PARTIALLY
  // stamped tree when a later carrier turns out to be unreadable, and a partial stamp is strictly worse
  // than no stamp: every downstream reader sees "the generator ran" (the whole-run abort below is what
  // makes that claim true, so it cannot be an after-the-fact check).
  const pairs: { carrier: VersionCarrier; entry: StampEntry }[] = [];
  for (const carrier of opts.carriers) {
    const reading = readCarrierVersion(opts.root, carrier);
    const entry: StampEntry = {
      label: carrier.label,
      path: carrier.path,
      before: reading.version,
      after: opts.expected,
      changed: reading.version !== opts.expected,
      wrote: false,
    };
    if (reading.error) {
      entry.error = reading.error;
      errors.push(entry);
    } else if (entry.changed) {
      drift.push(entry);
    }
    pairs.push({ carrier, entry });
    entries.push(entry);
  }

  // PASS 2 — only reached when EVERY carrier is judgeable, so a write can never produce a partially
  // stamped tree.
  if (errors.length === 0 && opts.write) {
    for (const { carrier, entry } of pairs) {
      if (!entry.changed) continue;
      const abs = resolve(opts.root, carrier.path);
      const raw = readFileSync(abs, 'utf-8');
      writeFileSync(abs, stampedContent(raw, carrier, opts.expected));
      entry.wrote = true;
      if (!written.includes(carrier.path)) written.push(carrier.path);
    }
  }

  return {
    mode: opts.mode,
    evaluated: true,
    reason: opts.reason,
    base: opts.base,
    expected: opts.expected,
    root: opts.root,
    entries,
    errors,
    drift,
    written,
  };
}

export function usage(): string {
  return (
    'usage: node --experimental-strip-types scripts/stamp-version.ts [--mode tracked|build] ' +
    '[--root <dir>] [--git-root <dir>] [--check] [--json]'
  );
}

/**
 * The CLI, as a function of argv returning an exit code — NOT a top-level `process.exit` script.
 * `stamp-version.mjs` (the Node-20-safe entry) bundles this file and CALLS `main`, so the bundled copy
 * needs a real entry point: a bundle whose only way in is an `import.meta`/`argv[1]` main-guard would
 * load, match nothing, and exit 0 having done nothing — a runner that reads as "the generator ran"
 * while nothing ran at all (measured: the first version of this file did exactly that).
 *
 * `env.repoRoot` exists for the same caller: a BUNDLE lives in a temp directory, so the `repoRoot`
 * derived from `import.meta.url` above is the temp dir, not this checkout. The runner passes the real
 * root in, instead of the CLI growing a `--repo-root` flag no human would ever type (measured: without
 * it the bundled run looked for `/tmp/VERSION`).
 */
export function main(argv: string[], env: { repoRoot?: string } = {}): number {
  const base = env.repoRoot ?? repoRoot;
  let mode: ResolveMode = 'tracked';
  let root: string | null = null;
  let gitRoot: string | null = null;
  let checkOnly = false;
  let jsonMode = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') {
      const v = argv[++i];
      if (v !== 'tracked' && v !== 'build') {
        console.error(`stamp-version: --mode must be tracked|build (got ${JSON.stringify(v)})`);
        return 2;
      }
      mode = v;
    } else if (a === '--root') {
      const v = argv[++i];
      if (!v) {
        console.error('stamp-version: --root requires a directory');
        return 2;
      }
      root = resolve(v);
    } else if (a === '--git-root') {
      const v = argv[++i];
      if (!v) {
        console.error('stamp-version: --git-root requires a directory');
        return 2;
      }
      gitRoot = resolve(v);
    } else if (a === '--check') {
      checkOnly = true;
    } else if (a === '--json') {
      jsonMode = true;
    } else if (a === '-h' || a === '--help') {
      console.log(usage());
      return 0;
    } else {
      console.error(`stamp-version: unknown arg: ${a}\n${usage()}`);
      return 2;
    }
  }

  // tracked: the tree that holds VERSION is the tree being stamped (default: this repo).
  // build:   the tree being stamped is an ARTIFACT (not a checkout) — it defaults to this repo's
  //          `plugin/` (the tree the repo's own build produces), and VERSION + the git state come from
  //          the checkout this script lives in unless --git-root says otherwise.
  const targetRoot = root ?? (mode === 'build' ? resolve(base, BUILD_TREE_PREFIX) : base);
  const sourceRoot = gitRoot ?? (mode === 'build' ? base : targetRoot);

  const src = readBaseVersion(sourceRoot);
  const carriers = mode === 'build' ? buildCarriers(BUILD_TREE_PREFIX) : VERSION_CARRIERS;

  /** Print and hand the exit code back to the caller — `main` returns, it never exits the process. */
  const fail = (payload: Record<string, unknown>, text: string, code: number): number => {
    if (jsonMode) console.log(JSON.stringify(payload, null, 2));
    else console.error(text);
    return code;
  };

  if (src.error) {
    // The single source is unreadable/malformed: there is no target to stamp toward, and inventing one
    // would be worse than doing nothing (hard rule 3b).
    return fail(
      { evaluated: false, mode, root: targetRoot, sourceRoot, base: '', reason: src.error, error: true },
      `STAMP-VERSION: ERROR — ${src.error}`,
      1,
    );
  }

  const ctx = mode === 'build' ? { mode, ...readGitContext(sourceRoot) } : { mode };
  let resolved: { evaluated: boolean; version: string; reason: string };
  try {
    resolved = resolveVersion(src.base, ctx);
  } catch (e: any) {
    return fail(
      {
        evaluated: false,
        mode,
        root: targetRoot,
        sourceRoot,
        base: src.base,
        reason: e?.message ?? String(e),
        error: true,
      },
      `STAMP-VERSION: ERROR — ${e?.message ?? String(e)}`,
      1,
    );
  }

  const report = stamp({
    root: targetRoot,
    carriers,
    expected: resolved.version,
    mode,
    evaluated: resolved.evaluated,
    reason: resolved.reason,
    base: src.base,
    write: !checkOnly && resolved.evaluated,
  });

  if (!resolved.evaluated) {
    if (jsonMode) {
      console.log(JSON.stringify({ ...report, expected: '', error: true }, null, 2));
    } else {
      console.error(`STAMP-VERSION: NOT-EVALUATED — ${resolved.reason}`);
      console.error('  nothing was written.');
    }
    return 3;
  }

  if (report.errors.length > 0) {
    if (jsonMode) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(`STAMP-VERSION: ERROR — ${report.errors.length} carrier(s) could not be judged; nothing was written.`);
      for (const e of report.errors) console.error(`  ${e.path}: ${e.error}`);
    }
    return 1;
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return checkOnly && report.drift.length > 0 ? 1 : 0;
  }

  const head =
    `STAMP-VERSION: mode=${mode} root=${targetRoot} source=${sourceRoot}/VERSION = ${src.base} ` +
    `=> every carrier must == ${report.expected}`;
  console.error(head);

  if (checkOnly) {
    if (report.drift.length === 0) {
      console.log(`STAMP-VERSION: OK — all ${report.entries.length} carriers == ${report.expected}`);
      console.log(`  (${report.entries.length} carriers over ${new Set(report.entries.map((e) => e.path)).size} files)`);
      return 0;
    }
    // The drift report is stdout, not stderr: it is a gate's verdict, and a caller grepping the
    // command's stdout must see what differs (a `2>&1` capture sees the same bytes either way).
    console.log(`STAMP-VERSION: DRIFT — ${report.drift.length} of ${report.entries.length} carriers != ${report.expected}`);
    for (const e of report.drift) {
      console.log(`  ${e.path}  (${e.label}): ${e.before} -> ${e.after}`);
    }
    console.log('  run `node --experimental-strip-types scripts/stamp-version.ts` (no --check) to update them all');
    return 1;
  }

  if (report.drift.length === 0) {
    console.log(`STAMP-VERSION: OK — all ${report.entries.length} carriers already == ${report.expected}; wrote nothing`);
    return 0;
  }
  console.log(`STAMP-VERSION: wrote ${report.written.length} file(s), ${report.drift.length} carrier(s):`);
  for (const e of report.drift) console.log(`  ${e.path}  (${e.label}): ${e.before} -> ${e.after}`);
  console.log(`  files changed: ${report.written.join(', ')}`);
  return 0;
}

// ── direct-run guard ───────────────────────────────────────────────────────────────────
// Only when THIS file is the entry point (not when `stamp-version.mjs` bundles and calls `main`).
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('stamp-version.ts') || process.argv[1].endsWith('stamp-version'));
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
