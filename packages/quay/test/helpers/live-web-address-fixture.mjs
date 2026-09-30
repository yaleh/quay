// @test-group product
// live-web-address-fixture.mjs — the ONE fixture cluster shared by the 17
// `ac<NNN>-criterion-address-derivation.test.mjs` files
// (gap-criterion-live-web-address-derivation-17-copies-to-one, P3).
//
// WHY THIS FILE EXISTS. Each of the 17 files used to carry its OWN copy of `writeCarrier` /
// `mkRoot` / `runSh` / `derive` — 5 distinct `writeCarrier` bodies, 14 `mkRoot` bodies that differed
// only in a temp-dir prefix, 4 `runSh` bodies and 2 `derive` bodies. That is the same
// cluster-of-copies defect the task removes on the criterion side, one level down (硬规则 5b: the
// defects are clustered; fixing the one that was reported is not fixing them). The four functions
// now have ONE definition each and the 17 files import them; the BEHAVIOUR each case asserts is
// unchanged (this is a characterization migration, ⛔ not a semantics change).
//
// WHAT CHANGED BECAUSE THE DERIVATION MOVED INTO A HELPER. The criteria no longer read the carrier
// themselves — they call `plugin/scripts/live-web-address.ts` — so a temp root in which a criterion
// runs must CARRY that script, exactly as the real root does. `installLiveWebAddressHelper(root)`
// materialises it (a byte copy of the real file, ⛔ not a re-implementation), and `mkRoot` calls it
// so every root the shared factory hands out is a root the criterion can actually run in.
//
// ⛔ NO RE-IMPLEMENTATION of the derivation lives here: this module only builds carriers and runs
// shell text. The single definition point for the derivation is the helper .ts.

import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `packages/quay/test/helpers/` → the repo root (four levels up). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** The single definition point, by absolute path — copied into each temp root below. */
export const LIVE_WEB_ADDRESS_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "live-web-address.ts");

/** Put the real derivation helper where a criterion run with `cwd = root` will find it:
 *  `<root>/plugin/scripts/live-web-address.ts`. A byte copy of the shipped file — the criterion's
 *  behaviour under test is then the SHIPPED one, ⛔ never a fixture re-statement of it. */
export function installLiveWebAddressHelper(root) {
  const dir = path.join(root, "plugin", "scripts");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(LIVE_WEB_ADDRESS_SCRIPT, path.join(dir, "live-web-address.ts"));
}

/** A git-initialised temp root (the criteria resolve `$root` with `git rev-parse --show-toplevel`),
 *  carrying the derivation helper. The `mkdtempSync` binding is returned, never cleaned here: each
 *  caller captures it and removes it in its own cleanup region (the shape `tmp-leak-pairing-check`'s
 *  capture-and-clean allowance accepts). */
export function mkRoot(prefix = "lwa-crit-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  installLiveWebAddressHelper(dir);
  return dir;
}

/** Write a carrier into `root` — ONE implementation, three call forms, because the 17 files had
 *  three real conventions and folding them into one is the point of this module:
 *
 *    · `writeCarrier(root, { pid, services })`               — the raw carrier (13 files);
 *    · `writeCarrier(root, pid, services)`                    — AC-179's positional form;
 *    · `writeCarrier(root, { pid, host, port, up?, dropWeb? })` — the convenience form (AC-289/291),
 *      which synthesizes the standard `web` + `control` pair `packages/quay/src/serve.ts` writes.
 *
 *  The third arm is a convenience, ⛔ not a second carrier writer: all three build the same envelope
 *  and hand it to the same `fs.writeFileSync` below. */
export function writeCarrier(root, spec, positionalServices) {
  let state;
  if (positionalServices !== undefined) {
    state = { pid: spec, services: positionalServices };
  } else if (spec && Array.isArray(spec.services)) {
    state = spec;
  } else {
    const { pid, host, port, up = true, dropWeb = false } = spec ?? {};
    const services = [];
    if (!dropWeb) services.push({ name: "web", pid, host, port, up });
    services.push({ name: "control", pid, host: "127.0.0.1", port: 1, up: true });
    state = { pid, services };
  }
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "server.json"),
    JSON.stringify({ schemaVersion: 1, startedAt: new Date().toISOString(), ...state }, null, 2),
  );
}

/** The bound a fixture uses so a hung script is reported AS a harness bound, not as an opaque
 *  `status === null` that every `assert.equal(r.code, …)` would render as a confusing mismatch. */
export const RUNSH_TIMEOUT_MS = 60000;

/** Run shell text with `cwd = root`. Returns `{code, stdout, stderr, pid}` — the pid is returned for
 *  every caller (a superset of what the old per-file copies returned) so a test that needs it does
 *  not force a second copy of this function. */
export function runSh(script, root, opts = {}) {
  const timeout = opts.timeout ?? RUNSH_TIMEOUT_MS;
  const r = spawnSync("/bin/sh", ["-c", script], { cwd: root, encoding: "utf8", timeout });
  if (r.status === null && r.signal) {
    throw new Error(
      `script did not finish within ${timeout}ms (killed by ${r.signal}) — this is the fixture's ` +
        `harness bound, not an assertion about the script`,
    );
  }
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", pid: r.pid };
}

/** Run an extracted derivation block and echo the readings the per-AC assertions read. `block` is
 *  passed in (⛔ not re-extracted here): each file keeps its OWN `derivationBlock()` extractor,
 *  because the markers it asserts on are the file's own subject. */
export function derive(root, block) {
  const script =
    `${block}\n` +
    `echo "DERIVED_ADDR=$addr"\n` +
    `echo "DERIVED_SRC=$src"\n` +
    `echo "NSERVE=$nserve"\n` +
    `echo "NCAND=$ncand"\n` +
    `echo "NDERIVED=$nderived"\n` +
    `echo "REPORT:$rep"\n` +
    `exit 0\n`;
  return runSh(script, root);
}
