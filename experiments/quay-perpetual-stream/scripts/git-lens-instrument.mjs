#!/usr/bin/env node
// git-lens-instrument.mjs — the LIVE instrument driver behind `git-lens-selfcheck.sh`.
//
// tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked.
//
// WHY THIS IS A .mjs AND NOT AN INLINE `node -e` INSIDE THE SHELL: the selfcheck must stay GLUE.
// The repo's shell census ratchet (plugin/scripts/sh-census-check.ts) lets embedded-interpreter
// lines inside a tracked `.sh` SHRINK ONLY; a ~25-line `node -e` block would raise the ratchet.
// A program belongs in a program file — this one — and the `.sh` keeps the fixture table.
//
// It does NOT re-implement any reading (the whole point of the repair):
//   ld → plugin/scripts/phase-declare.ts's `takeLdFileReading` (parseNumstat + computeRatio — the
//        SAME rule the ADR-008 declaration takes)
//   lg → plugin/scripts/archguard-runner.ts's `readDirectoryCycleReading` — the SAME reader the
//        arch-cycle-report routine consumes (directory-level moduleGraph cycles from the persisted
//        query artifact)
//
// Usage:
//   node git-lens-instrument.mjs ld --numstat-file <file> [--json]
//   node git-lens-instrument.mjs lg --work-dir <dir> [--json]
//
// Exit (THREE-VALUED — 硬规则 3b: "could not read" must never share a value with a reading):
//   0  reading produced, NOT flagged (ld) / 0 cycles (lg)
//   1  reading produced, FLAGGED (ld) / ≥1 cycles (lg)
//   2  usage error
//   3  NOT-EVALUATED — the probe entry could not be loaded, the input could not be read, or the
//      fixture's source scope is not evaluated. ⛔ This is the value the archived-probe rot used to
//      fake: MODULE_NOT_FOUND exits 1, which EQUALS the expected code of the "must be detected"
//      fixtures. The selfcheck therefore never compares a load failure against an expected 1.

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// <repo>/experiments/quay-perpetual-stream/scripts → up three = the repo root.
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

const USAGE = `usage:
  node git-lens-instrument.mjs ld --numstat-file <file> [--json]
  node git-lens-instrument.mjs lg --work-dir <dir> [--json]`;

/** Import a `.ts` probe. Node ≥22.18 strips types by default; on an older runtime the first import
 *  throws, and we re-exec ONCE with `--experimental-strip-types` so the `.sh` caller never has to
 *  carry the flag (its embedded-interpreter lines are ratcheted). */
async function loadProbe(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  try {
    return await import(pathToFileURL(abs).href);
  } catch (e) {
    const msg = String((e && e.message) || e);
    const stripping = /ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension|strip|typescript/i.test(msg);
    if (!process.env.GIT_LENS_STRIP_RETRY && stripping) {
      const r = spawnSync(
        process.execPath,
        ["--no-warnings", "--experimental-strip-types", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
        { stdio: "inherit", env: { ...process.env, GIT_LENS_STRIP_RETRY: "1" } },
      );
      process.exit(r.status === null ? 3 : r.status);
    }
    throw e;
  }
}

function notEvaluated(reason) {
  console.log(`NOT-EVALUATED(${reason})`);
  process.exitCode = 3;
}

function readFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  return typeof v === "string" && v !== "" ? v : null;
}

async function main(argv) {
  const json = argv.includes("--json");
  const mode = argv[0];

  if (mode === "ld") {
    const numstatFile = readFlag(argv, "--numstat-file");
    if (!numstatFile) {
      console.error(`git-lens-instrument: ld needs --numstat-file\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    let probe;
    try {
      probe = await loadProbe("plugin/scripts/phase-declare.ts");
    } catch (e) {
      notEvaluated(`probe-load-failed: ${(e && e.message) || e}`);
      return;
    }
    let reading;
    try {
      reading = probe.takeLdFileReading(numstatFile);
    } catch (e) {
      notEvaluated(`reading-unavailable: ${(e && e.message) || e}`);
      return;
    }
    if (json) {
      console.log(JSON.stringify(reading, null, 2));
    } else {
      console.log(
        `docLines=${reading.docLines} codeLines=${reading.codeLines} ` +
          `ratio=${reading.ratio === null ? "n/a" : reading.ratio.toFixed(3)} verdict=${reading.verdict} flagged=${reading.flagged}`,
      );
    }
    process.exitCode = reading.flagged ? 1 : 0;
    return;
  }

  if (mode === "lg") {
    const workDir = readFlag(argv, "--work-dir");
    if (!workDir) {
      console.error(`git-lens-instrument: lg needs --work-dir\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    let probe;
    try {
      probe = await loadProbe("plugin/scripts/archguard-runner.ts");
    } catch (e) {
      notEvaluated(`probe-load-failed: ${(e && e.message) || e}`);
      return;
    }
    // The manifest's `sources` are spelled relative to the workspace root, and
    // `readDirectoryCycleReading` resolves them against process.cwd(). Running FROM the fixture
    // makes `root` and the manifest spelling agree without an absolute path in a checked-in file.
    process.chdir(path.resolve(workDir));
    const root = process.cwd();
    const reading = probe.readDirectoryCycleReading(root, root);
    // ⛔ The SIX-scope aggregate is `evaluated:false` whenever a sibling scope is absent (correctly:
    // "could not read" is not "0 cycles"). A fixture declares ONE scope, so the selfcheck reads that
    // scope's entry, not `totalCycleCount`.
    const scope = reading.scopes.find((s) => s.scope === "src");
    if (!scope || !scope.evaluated) {
      notEvaluated(`scope-not-evaluated: ${scope ? scope.reason : "no 'src' scope in the fixture manifest"}`);
      return;
    }
    const members = (scope.cycles || []).map((c) => c.modules.join(" -> "));
    if (json) {
      console.log(JSON.stringify({ scope: scope.scope, count: scope.cycleCount, members }, null, 2));
    } else {
      console.log(`count=${scope.cycleCount} members=${JSON.stringify(members)}`);
    }
    process.exitCode = (scope.cycleCount ?? 0) > 0 ? 1 : 0;
    return;
  }

  console.error(`git-lens-instrument: unknown mode ${JSON.stringify(mode ?? null)}\n${USAGE}`);
  process.exitCode = 2;
}

await main(process.argv.slice(2));
