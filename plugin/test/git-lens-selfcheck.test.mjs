// @test-group lowconc
// git-lens-selfcheck.test.mjs — tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked
//
// WHAT THIS FILE PINS (the defect is a 硬规则-3b shape, so the test is written as NEGATIVE controls,
// not as "the script exits 0"):
//
//   ① The selfcheck is THREE-VALUED. On the real repo it exits **2** — every L_D/L_G fixture PASSes
//      and both L_S cases are NOT-EVALUATED(axis-retired…). Exit 0 would mean "every axis was
//      judged", which is false while L_S has no living product-code instrument; exit 1 would mean
//      an instrument disagreed with its fixture, which must not happen here.
//   ② NO FAKE PASS. The old script ran `node scripts/git-lens-l-*.ts`; those files are archived, and
//      MODULE_NOT_FOUND is exit 1 — the expected code of the three "must be detected" fixtures — so
//      it printed PASS for three fixtures it never measured. The real run must contain **zero**
//      `MODULE_NOT_FOUND` strings, and an axis whose probe entry is missing must print
//      `NOT-EVALUATED(probe-not-loaded…)` with **no** PASS line for that axis (shadow copy with the
//      probe file removed — the same experiment AC1 performs by hand).
//   ③ "No moduleGraph" is NOT "0 cycles". A fixture whose arch.json lacks
//      `extensions.tsAnalysis.moduleGraph` must read NOT-EVALUATED, never PASS-with-0 (shadow copy).
//
// The shadow copies are built under os.tmpdir() and cleaned by ONE after() hook (the documented
// carrier-array pattern the isolation checks trace). The real checkout is only ever READ.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXPERIMENT_REL = "experiments/quay-perpetual-stream";
const SELFCHECK = path.join(REPO_ROOT, EXPERIMENT_REL, "scripts", "git-lens-selfcheck.sh");
const FIXTURES = path.join(REPO_ROOT, EXPERIMENT_REL, "fixtures", "git-lens");

const TMP_DIRS = [];
after(() => {
  for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function runSelfcheck(script) {
  const r = spawnSync("bash", [script], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A shadow of the two dirs the selfcheck resolves relative to its own location:
 *  `<root>/experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` +
 *  `fixtures/git-lens/`, and — when `withProbes` — `<root>/plugin/scripts/{phase-declare,
 *  archguard-runner,gate-script-base}.ts`. Producing the shadow by COPYING is what lets a test
 *  rename/remove a probe without touching the checkout. */
function makeShadow({ withProbes = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-lens-selfcheck-"));
  TMP_DIRS.push(root);
  const scriptsDir = path.join(root, EXPERIMENT_REL, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(SELFCHECK, path.join(scriptsDir, "git-lens-selfcheck.sh"));
  fs.cpSync(FIXTURES, path.join(root, EXPERIMENT_REL, "fixtures", "git-lens"), { recursive: true });
  if (withProbes) {
    const pluginScripts = path.join(root, "plugin", "scripts");
    fs.mkdirSync(pluginScripts, { recursive: true });
    for (const f of ["phase-declare.ts", "archguard-runner.ts", "gate-script-base.ts"]) {
      fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", f), path.join(pluginScripts, f));
    }
  }
  return root;
}

function shadowSelfcheck(root) {
  return path.join(root, EXPERIMENT_REL, "scripts", "git-lens-selfcheck.sh");
}

const PASS_LD = ["l-d/prose-heavy", "l-d/code-heavy", "l-d/empty"];
const PASS_LG = ["l-g/cycle-repo", "l-g/clean-repo"];

test("the real repo's selfcheck is three-valued: 5 PASS, 2 NOT-EVALUATED(axis-retired), exit 2", () => {
  const r = runSelfcheck(SELFCHECK);
  assert.equal(r.status, 2, `expected exit 2 (no FAIL, ≥1 NOT-EVALUATED); stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  for (const id of [...PASS_LD, ...PASS_LG]) {
    assert.match(r.stdout, new RegExp(`^PASS: ${id.replace(/[/.]/g, "\\$&")} —`, "m"), `missing PASS for ${id}:\n${r.stdout}`);
  }
  // The cycle reading must NAME its members (a count alone is not the reading AC3 asks for).
  assert.match(r.stdout, /^PASS: l-g\/cycle-repo .*cycle-a\.ts -> .*cycle-b\.ts/m);
  // Both L_S cases are retired-axis readings, and NEITHER is allowed to be a PASS.
  assert.equal((r.stdout.match(/NOT-EVALUATED\(axis-retired:/g) ?? []).length, 2, r.stdout);
  assert.ok(!/^PASS: l-s\//m.test(r.stdout), "the retired L_S axis must never print PASS");
  assert.ok(!/^FAIL:/m.test(r.stdout), `no instrument disagreed on the real repo:\n${r.stdout}`);
  assert.equal(r.stdout.includes("MODULE_NOT_FOUND"), false, "the archived probes must not be invoked any more");
  // The last line must carry the discriminator: runAcceptance's bounded failure excerpt keeps the
  // TAIL of stdout, and ADR-007's routine classifies exit 2 by it.
  assert.match(r.stdout.trimEnd().split("\n").slice(-2).join("\n"), /NOT-EVALUATED/);
});

test("a probe that cannot be loaded prints NOT-EVALUATED(probe-not-loaded…), never a PASS for that axis", () => {
  // AC1's experiment, mechanised: the L_D probe entry is ABSENT in the shadow copy. The old script
  // would have printed `PASS: l-d/prose-heavy` here (MODULE_NOT_FOUND is also exit 1).
  const root = makeShadow({ withProbes: false });
  const r = runSelfcheck(shadowSelfcheck(root));
  assert.equal(r.status, 2, `probe-not-loaded is NOT-EVALUATED, not a red and not a green:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^NOT-EVALUATED\(probe-not-loaded: .*phase-declare\.ts\) l-d\/prose-heavy$/m);
  assert.match(r.stdout, /^NOT-EVALUATED\(probe-not-loaded: .*archguard-runner\.ts\) l-g\/cycle-repo$/m);
  assert.ok(!/^PASS: l-d\//m.test(r.stdout), `no L_D PASS may survive a missing probe:\n${r.stdout}`);
  assert.ok(!/^PASS: l-g\//m.test(r.stdout), `no L_G PASS may survive a missing probe:\n${r.stdout}`);
  assert.ok(!/^FAIL:/m.test(r.stdout), "an unloadable probe is not a FAIL either (that is what hid the rot)");
});

test("an unreadable moduleGraph reads NOT-EVALUATED, not PASS-with-0-cycles", () => {
  const root = makeShadow();
  const archFile = path.join(
    root, EXPERIMENT_REL, "fixtures", "git-lens", "l-g-archguard", "cycle", "query", "fixture01", "arch.json",
  );
  const arch = JSON.parse(fs.readFileSync(archFile, "utf8"));
  delete arch.extensions.tsAnalysis.moduleGraph;
  fs.writeFileSync(archFile, JSON.stringify(arch, null, 2) + "\n", "utf8");

  const r = runSelfcheck(shadowSelfcheck(root));
  assert.equal(r.status, 2, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /^NOT-EVALUATED\(reading-unavailable: .*moduleGraph.*\) l-g\/cycle-repo/m);
  assert.ok(!/^PASS: l-g\/cycle-repo/m.test(r.stdout), `"could not read" must not look like "0 cycles":\n${r.stdout}`);
  // The CLEAN fixture still reads (0 cycles) — the shadow only removed ONE artifact.
  assert.match(r.stdout, /^PASS: l-g\/clean-repo —/m);
});
