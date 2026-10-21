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
// THE SAME DEFECT ON THE PROCESS-LIFECYCLE SIDE, fixed 2026-10-15
// (gap-lwa-crit-fixture-sleep300-child-not-reaped-forces-aborted-on-clean-suite): the seven files
// that need a REAL fixture process (`spawnNotAServe`) also carried byte-identical copies of
// `killAndReap` + `withFixture`, and of the spawner itself. Those three now have ONE definition each
// too — which is where the leak this task repairs actually lived: `spawnNotAServe` forked a
// grandchild its teardown could not reach. See the block comment above the lifecycle section below.
//
// WHAT CHANGED BECAUSE THE DERIVATION MOVED INTO A HELPER. The criteria no longer read the carrier
// themselves — they call `plugin/scripts/live-web-address.ts` — so a temp root in which a criterion
// runs must CARRY that script, exactly as the real root does. `installLiveWebAddressHelper(root)`
// materialises it (a byte copy of the real file, ⛔ not a re-implementation), and `mkRoot` calls it
// so every root the shared factory hands out is a root the criterion can actually run in.
//
// ⛔ NO RE-IMPLEMENTATION of the derivation lives here: this module only builds carriers and runs
// shell text. The single definition point for the derivation is the helper .ts.

import { spawn, spawnSync, execFileSync } from "node:child_process";
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
 *      which synthesizes the standard `web` + `control` pair `packages/quay/src/serve/serve.ts` writes.
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

// ── the fixture's process lifecycle: ONE definition each ─────────────────────────────────────────
// gap-lwa-crit-fixture-sleep300-child-not-reaped-forces-aborted-on-clean-suite.
//
// MEASURED 2026-10-15: a full-suite round that was COMPLETE and had NO failing test — `plannedFiles
// == terminalFiles == 584`, `completeness:"complete"`, `oomKill:0`, `# fail 0` — was still recorded
// `state:"red" reason:"aborted"`, `notEvaluated:"leaked-processes (2)"`. The two survivors were
// `sleep 300` processes whose cwd was an `lwa-crit-* (deleted)` temp root — this fixture's own.
//
// ROOT CAUSE (measured by the task's AC2 negative control, ⛔ not inferred): `spawnNotAServe` ran
// `sh -c "echo <phrase> >/dev/null; sleep 300"`. `/bin/sh` is `dash` on this host, and dash does NOT
// exec the last command of a `;`-separated list — it FORKS it. So `child.pid` was the SHELL while
// `sleep 300` was a GRANDCHILD. The teardown below SIGKILLs `child.pid` and awaits its `exit`, which
// reaches the shell only: the `sleep` was orphaned (reparented away from the shell), kept running,
// kept the by-then-removed temp root as its cwd, and was still in the suite's own process group at
// the suite-end leak sweep — which correctly called it a leak and (correctly) refused to call the
// round green.
//
// ⇒ TWO THINGS WERE *NOT* WRONG, and neither is touched by this fix:
//   · the sweep's predicate — it found a real survivor; it was right (硬规则 3b: a round with a live
//     survivor must not wear the same shape as a clean one);
//   · the fixtures' registration — every call site of every spawner pushes its child into the array
//     `withFixture` reclaims; there is no unregistered call site.
// The teardown was correct about the pid it was GIVEN and wrong about the process that had been
// CREATED. So the fix belongs at the source, and the 7 copies of that source are the cluster
// (硬规则 5b) — hence one definition here rather than seven edited in place.
//
// THE FIX, AND WHY THIS SHAPE. The shell now blocks in its OWN builtin, so the direct child IS the
// whole process and killing it leaves nothing behind. `read` is a POSIX special builtin — ⛔ it does
// not fork — and with nobody writing to the pipe it blocks indefinitely. The process's argv still
// carries `phrase` verbatim (a shell keeps the whole `-c` string in its cmdline), which is exactly
// what `pgrep -f` matches and what this fixture exists to provide; the shape under test is unchanged.
// Two properties fall out for free:
//   · killing `child.pid` is now COMPLETE — no tree walk, no process-group kill, and ⛔ no
//     `detached:true`. Detaching was the obvious alternative and is the WRONG one: a detached child
//     leaves the SUITE's process group, which is precisely the set the suite-end leak sweep
//     enumerates, so it would have moved this class of leak out of the backstop's reach — narrowing
//     the detection surface this task is required to leave intact;
//   · the child is SELF-CLEANING: the pipe's write end belongs to this process, so if the test file
//     dies without running its `finally` (node:test cancels a file by signalling its process — the one
//     path a JS `finally` cannot cover), the shell's `read` sees EOF and exits on its own. That path
//     was not the measured cause, but it is the same leak class and this shape closes it too.

/** A real child that `pgrep -f "<phrase>"` MATCHES (the phrase is in its argv) but whose argv
 *  carries no `serve` element — the shape of the acceptance runner's own `sh -c "<criterion>"`. It
 *  must be reported as a candidate that derived nothing, and must never blank another candidate's
 *  address.
 *
 *  ⛔ THE BLOCKING `read` IS LOAD-BEARING, not a stylistic choice: it keeps the shell alive as the
 *  DIRECT child so `killAndReap(child)` is a complete teardown. A FORKING command here (`sleep …`,
 *  this fixture's shape until 2026-10-15) leaves an orphan that survives that teardown and aborts an
 *  otherwise clean suite round — see the block comment above. */
export function spawnNotAServe(root, phrase = "quay.ts serve") {
  return spawn("/bin/sh", ["-c", `echo ${phrase} >/dev/null; read _`], {
    cwd: root,
    // stdin is a PIPE WE HOLD OPEN and never write to: that is what makes `read` block. Closing or
    // writing to it would end the shell immediately (`stdio: "ignore"` would too — /dev/null is
    // already at EOF).
    stdio: ["pipe", "ignore", "ignore"],
  });
}

/** SIGKILL and WAIT FOR THE REAP. An un-reaped child stays in the process table as a zombie, and
 *  `kill(pid, 0)` — the liveness probe both this fixture and the product's `pidAlive` use — reports a
 *  zombie as ALIVE. Waiting for the `exit` event lets node reap it, so "dead" means dead here. */
export function killAndReap(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    try {
      child.kill("SIGKILL");
    } catch {
      resolve();
    }
  });
}

/** Run `body` with a fresh root and guaranteed teardown of every child/server/temp dir. The `children`
 *  and `servers` arrays are the caller's (it pushes into them as it spawns), so a body that throws
 *  half-way still tears down everything it registered before the throw. */
export async function withFixture(children, servers, body) {
  const root = mkRoot();
  try {
    return await body(root);
  } finally {
    for (const c of children) await killAndReap(c);
    for (const s of servers) await killAndReap(s);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
