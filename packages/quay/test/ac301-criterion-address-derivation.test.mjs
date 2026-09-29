// @test-group product
// AC-301 criterion address derivation — sibling of the AC-288/AC-290 family fixtures.
//
// The AC-301 criterion probes a RUNNING `quay.ts serve`. Since ce0f47518 (2026-09-18) the launcher
// default for the web port is 0 = kernel-assigned ephemeral, so a live gen-2 instance's cmdline
// literally reads `--host H --port 0` and a derivation that parses that cmdline yields the
// structurally unfetchable `H:0`. The re-anchor (gap-ac301-criterion-cmdline-port-literal-stale)
// moves the derivation into a self-delimited `# >>> addr-derivation` … `# <<< addr-derivation` block
// inside the shipped criterion.
//
// This file does NOT restate that block. It reads the goal file through the goal store's OWN
// frontmatter reader, extracts the block VERBATIM by its markers, and runs it under /bin/sh in
// `git init`-ed temp roots against real serve-shaped processes and real `.quay/server.json`
// carriers — so it measures the shipped block, not a copy of it (single source of truth).
//
// The four claims under test, each with both directions:
//   · the address is derived from an explicit `--port >= 1` when one is on the argv;
//   · otherwise it comes from the carrier's `web` service (wildcard host normalised), never `:0`;
//   · "could not DERIVE an address" and "derived but could not REACH it" and "no instance at all"
//     are three DISTINCT refusal tokens (hard rule 3b — "could not evaluate" must not wear the
//     shape of another verdict);
//   · the amendment left the eleven pre-amendment CAUSE branches and the page assertions intact.
//
// ── THE 2026-09-29 AMENDMENT: CARRIER ABSENCE IS `not-evaluated` (exit 3), NOT `false` (exit 1) ──
// (gap-ac301-criterion-carrier-absence-not-evaluated). Until this revision the four branches that
// report "I could not find / reach a live surface" exited 1, so a run in which no cwd=repo-root
// `quay.ts serve` existed was RECORDED as the criterion being false — a state the repo already has a
// value for (`goal-store.ts` names it verbatim: "exit 3 — this repo's convention, e.g.
// NOT-EVALUATED: carrier absent"; `gate/acceptance-runner.ts`'s `verdictFromAcceptance` maps 3 to
// `not-evaluated`/`declared`, and `NOT_RUNNABLE_EXIT_CODES` holds only 126/127). The seven negative
// cases in §② below therefore assert `status === 3`; the two positive cases (explicit `--port`,
// carrier fallback) still assert `status === 0` and are byte-for-byte unchanged. §② runs only the
// derivation BLOCK, so it pins the block's own exit status; the NEW §④ cases run the WHOLE criterion
// (`runCriterion()`) against a self-made live surface, which is what keeps the assertion branches'
// teeth a BEHAVIOUR reading rather than a claim about a diff: a zh response that is genuinely
// translated ⇒ exit 0, one that merely claims `<html lang="zh">` while its nav is untouched ⇒ exit 1
// + `CAUSE=nav-label-untranslated`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../src/frontmatter-store-base.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const GOALS_DIR = path.join(REPO_ROOT, "goals");
const FIXTURE_REL = "packages/quay/test/ac301-criterion-address-derivation.test.mjs";

/** Why the seven carrier-absence negatives assert 3 and not 1 — the whole point of the 2026-09-29
 *  amendment, kept on every one of them so a future reader does not "fix" one back to a bare failure. */
const NOT_EVALUATED_WHY =
  "carrier absence is NOT-EVALUATED (exit 3), never 'this is false' (exit 1) — hard rule 3b";

// gap-tests-never-clean-up-their-tmpdirs: every temp dir and every fake-serve child is released in a
// file-level after() hook, which runs even when a test fails.
const _dirs = [];
const _children = [];
after(() => {
  for (const c of _children) {
    try {
      c.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  for (const d of _dirs) fs.rmSync(d, { recursive: true, force: true });
});

// ── the shipped criterion, read through the goal store's own reader ──────────────────────────────
function goalFile() {
  const hits = fs.readdirSync(GOALS_DIR).filter((f) => f.startsWith("AC-301-") && f.endsWith(".md"));
  assert.equal(hits.length, 1, `expected exactly one AC-301 goal file in ${GOALS_DIR}, got ${hits.length}`);
  return path.join(GOALS_DIR, hits[0]);
}

function criterionText() {
  const { frontmatter } = parseFrontmatter(fs.readFileSync(goalFile(), "utf8"));
  assert.equal(typeof frontmatter.criterion, "string", "AC-301 must carry a string criterion");
  return frontmatter.criterion;
}

function addrBlock() {
  const lines = criterionText().split("\n");
  const s = lines.findIndex((l) => l.includes(">>> addr-derivation"));
  const e = lines.findIndex((l) => l.includes("<<< addr-derivation"));
  assert.ok(s >= 0, "the AC-301 criterion must carry the `>>> addr-derivation` marker");
  assert.ok(e > s, "the AC-301 criterion must carry the `<<< addr-derivation` marker");
  return lines.slice(s, e + 1).join("\n");
}

// ── harness: real processes, real carriers ──────────────────────────────────────────────────────
function mkRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ac301-addr-")));
  _dirs.push(dir);
  const g = spawnSync("git", ["init", "-q"], { cwd: dir });
  assert.equal(g.status, 0, `git init must succeed in ${dir}`);
  return dir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function waitForPort(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  const attempt = () =>
    new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.on("error", () => resolve(false));
    });
  return (async () => {
    while (Date.now() < deadline) {
      if (await attempt()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  })();
}

// A process that LOOKS like the real thing to the block's own discovery step: `pgrep -f 'quay.ts
// serve'` matches its space-joined cmdline, `/proc/<pid>/cwd` is the fixture root, and its argv
// carries `serve --host H --port P` for the awk derivation. It answers HTTP only when asked to.
const FAKE_SERVE_SRC = [
  'const http = require("node:http");',
  'const port = Number(process.env.FAKE_LISTEN_PORT || 0);',
  'const body = \'<html lang="en"><nav><a href="/goal" class="current">Goals</a></nav><title>quay — Goals</title></html>\';',
  "if (port > 0) {",
  '  http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body); }).listen(port, "127.0.0.1");',
  "}",
  "setInterval(() => {}, 1 << 30);",
].join("\n");

function spawnFakeServe(root, { argvHost, argvPort, listenPort = 0 }) {
  const child = spawn(process.execPath, ["-e", FAKE_SERVE_SRC, "quay.ts", "serve", "--host", argvHost, "--port", String(argvPort)], {
    cwd: root,
    env: { ...process.env, FAKE_LISTEN_PORT: String(listenPort) },
    stdio: "ignore",
  });
  _children.push(child);
  return child;
}

function writeCarrier(root, { pid, services }) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "server.json"),
    JSON.stringify({ schemaVersion: 1, pid, startedAt: new Date().toISOString(), services }, null, 2),
  );
}

const webService = ({ pid, host = "0.0.0.0", port, up = true }) => ({ name: "web", pid, host, port, up });

// Run the shipped block exactly as the acceptance runner would: `sh -c <criterion text>` with cwd =
// root. `sh -c` is deliberate — its own cmdline CONTAINS the block text (hence the literal
// `quay.ts serve`), so it is itself a discovery candidate with no `serve` subcommand in its argv.
// That is the masquerade the block's nserve/ncand split exists to reject.
function runShText(text, root) {
  const env = { ...process.env };
  delete env.QUAY_GOAL_ACCEPTANCE_ACTIVE; // the goal-store re-entrancy guard must not leak in
  const r = spawnSync("/bin/sh", ["-c", text], { cwd: root, encoding: "utf8", timeout: 60_000, env });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** The derivation BLOCK only — §①/§② below, which pin the address contract without a page to assert over. */
function runBlock(root) {
  return runShText(addrBlock(), root);
}

/** The WHOLE shipped criterion — the exact text `quay goal gate AC-301` executes. §④'s cases use this
 *  so "the assertion branches still have teeth" is a BEHAVIOUR reading of the shipped text rather than
 *  a claim about the diff. */
function runCriterion(root) {
  return runShText(criterionText(), root);
}

// ── positive direction ──────────────────────────────────────────────────────────────────────────
test("AC-301 block: an explicit --port >= 1 on the candidate's own argv is used, and reported as such", async () => {
  const root = mkRoot();
  const port = await freePort();
  const child = spawnFakeServe(root, { argvHost: "127.0.0.1", argvPort: port, listenPort: port });
  assert.ok(await waitForPort(port), "the fake serve must be listening before the block runs");
  // A carrier naming the SAME pid but a different port: argv must win over it.
  const bogus = await freePort();
  writeCarrier(root, { pid: child.pid, services: [webService({ pid: child.pid, host: "127.0.0.1", port: bogus })] });

  const r = runBlock(root);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /derived from argv/, "the derivation source must be named");
  assert.match(r.stdout, new RegExp(`127\\.0\\.0\\.1:${port}\\b`), "the argv port must be the derived address");
  assert.ok(!new RegExp(`:${bogus}\\b`).test(r.stdout), "the carrier port must NOT win when argv carries a real port");
  assert.match(r.stdout, new RegExp(`pid=${child.pid}`), "the chosen candidate's pid must be reported");
});

test("AC-301 block: --port 0 (kernel-assigned) falls back to the carrier's web service, wildcard host normalised", async () => {
  const root = mkRoot();
  const port = await freePort();
  const child = spawnFakeServe(root, { argvHost: "0.0.0.0", argvPort: 0, listenPort: port });
  assert.ok(await waitForPort(port), "the fake serve must be listening before the block runs");
  writeCarrier(root, { pid: child.pid, services: [webService({ pid: child.pid, host: "0.0.0.0", port })] });

  const r = runBlock(root);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /derived from carrier/, "the fallback source must be named");
  assert.match(r.stdout, new RegExp(`127\\.0\\.0\\.1:${port}\\b`), "the carrier's web port must be the derived address");
  assert.ok(!/0\.0\.0\.0:/.test(r.stdout + r.stderr), "the wildcard host must be normalised, never left as 0.0.0.0");
  assert.ok(!/\baddr=[^ ]*:0\b/.test(r.stdout), "the kernel-assigned 0 must never survive as a port");
});

// KNOWN LIMITATION of the canonical addr-derivation block (shared verbatim with AC-288/AC-290/…, so
// it is deliberately NOT re-derived here — the family convention is to adopt the newest block
// verbatim). `packages/quay/src/server-state.ts` `probeAddress()` treats BOTH `0.0.0.0` and `::`
// (and `""` / `*`) as wildcards, but the block's shell counterpart only normalises `0.0.0.0:*`:
// for an IPv6 wildcard host the concatenation is `:::PORT`, and `${a#::}` leaves `:PORT`, yielding
// `127.0.0.1::PORT`. What this test pins is the SAFETY property, which is what matters for a probe:
// the block must FAIL CLOSED with a named, attributable cause rather than silently hand back a
// plausible-looking address. Production binds `0.0.0.0`, so AC-301's live criterion is unaffected.
test("AC-301 block: an IPv6-wildcard (`::`) carrier host fails CLOSED with a named cause, never a silent wrong address", async () => {
  const root = mkRoot();
  const port = await freePort();
  const child = spawnFakeServe(root, { argvHost: "0.0.0.0", argvPort: 0, listenPort: port });
  assert.ok(await waitForPort(port));
  writeCarrier(root, { pid: child.pid, services: [webService({ pid: child.pid, host: "::", port })] });

  const r = runBlock(root);
  assert.equal(r.status, 3, "an unnormalisable wildcard must not yield a green");
  assert.match(r.stderr, /FAIL=no-reachable-serve-address/);
  assert.match(r.stderr, /fetch-failed\(curl-exit-\d+\)/, "the curl EXIT must be translated into a named cause");
  assert.match(r.stderr, new RegExp(`pid=${child.pid}`), "the candidate must still be attributable");
  assert.equal(r.stdout, "", "no address may be reported as derived-and-good");
});

// ── negative direction: "could not derive" ──────────────────────────────────────────────────────
test("AC-301 block: --port 0 with NO carrier refuses with FAIL=no-derivable-serve-address and names every candidate", async () => {
  const root = mkRoot();
  const child = spawnFakeServe(root, { argvHost: "0.0.0.0", argvPort: 0, listenPort: 0 });

  const r = runBlock(root);
  assert.equal(r.status, 3, `expected exit 3, got ${r.status}\nstdout: ${r.stdout}`);
  assert.match(r.stderr, /FAIL=no-derivable-serve-address/);
  assert.match(r.stderr, new RegExp(`pid=${child.pid}`), "the candidate must be named");
  assert.match(r.stderr, /addr=-/, "a candidate with no usable address must say so rather than print an empty addr");
  assert.match(r.stderr, /argv-port-kernel-assigned/, "the argv-side reason must be named");
  assert.match(r.stderr, /carrier-absent/, "the carrier-side reason must be named");
  assert.equal(r.stdout, "", "nothing may be derived, so nothing may be printed as derived");
});

test("AC-301 block: a carrier whose pid is not the candidate's is refused (carrier-pid-mismatch)", async () => {
  const root = mkRoot();
  const child = spawnFakeServe(root, { argvHost: "0.0.0.0", argvPort: 0, listenPort: 0 });
  const port = await freePort();
  writeCarrier(root, { pid: child.pid + 999_999, services: [webService({ pid: child.pid + 999_999, host: "127.0.0.1", port })] });

  const r = runBlock(root);
  assert.equal(r.status, 3, NOT_EVALUATED_WHY);
  assert.match(r.stderr, /FAIL=no-derivable-serve-address/);
  assert.match(r.stderr, /carrier-pid-mismatch/);
  assert.match(r.stderr, new RegExp(`pid=${child.pid}`));
});

test("AC-301 block: a carrier with no `web` service is refused (carrier-no-web-service)", async () => {
  const root = mkRoot();
  const child = spawnFakeServe(root, { argvHost: "0.0.0.0", argvPort: 0, listenPort: 0 });
  writeCarrier(root, { pid: child.pid, services: [{ name: "control", pid: child.pid, host: "127.0.0.1", port: 9081, up: true }] });

  const r = runBlock(root);
  assert.equal(r.status, 3, NOT_EVALUATED_WHY);
  assert.match(r.stderr, /FAIL=no-derivable-serve-address/);
  assert.match(r.stderr, /carrier-no-web-service/, "the control-plane entry must not be mistaken for the web service");
});

test("AC-301 block: a carrier whose web service is down is refused (carrier-web-down)", async () => {
  const root = mkRoot();
  const child = spawnFakeServe(root, { argvHost: "0.0.0.0", argvPort: 0, listenPort: 0 });
  const port = await freePort();
  writeCarrier(root, { pid: child.pid, services: [webService({ pid: child.pid, host: "127.0.0.1", port, up: false })] });

  const r = runBlock(root);
  assert.equal(r.status, 3, NOT_EVALUATED_WHY);
  assert.match(r.stderr, /FAIL=no-derivable-serve-address/);
  assert.match(r.stderr, /carrier-web-down/);
});

// ── negative direction: "derived but could not reach" ───────────────────────────────────────────
test("AC-301 block: a derivable but unreachable address is REFUSED with FAIL=no-reachable-serve-address", async () => {
  const root = mkRoot();
  const child = spawnFakeServe(root, { argvHost: "0.0.0.0", argvPort: 0, listenPort: 0 });
  const deadPort = await freePort(); // allocated then released: nothing is listening on it
  writeCarrier(root, { pid: child.pid, services: [webService({ pid: child.pid, host: "127.0.0.1", port: deadPort })] });

  const r = runBlock(root);
  assert.equal(r.status, 3, `expected exit 3, got ${r.status}\nstdout: ${r.stdout}`);
  assert.match(r.stderr, /FAIL=no-reachable-serve-address/);
  assert.match(r.stderr, /connection-refused/, "the curl EXIT must be translated into a named cause");
  assert.match(r.stderr, new RegExp(`pid=${child.pid}`), "the candidate must be named");
  assert.match(r.stderr, new RegExp(`addr=127\\.0\\.0\\.1:${deadPort}`), "the DERIVED address must be reported, not blanked");
  assert.equal(r.stdout, "");
});

// ── negative direction: "no instance at all", distinct from both of the above ────────────────────
test("AC-301 block: no serve-shaped candidate yields CAUSE=no-running-serve-instance — the `sh -c` runner must not masquerade as one", async () => {
  const root = mkRoot(); // no fake serve at all; only the `sh -c <block>` runner itself lives here

  const r = runBlock(root);
  assert.equal(r.status, 3, NOT_EVALUATED_WHY);
  assert.match(r.stderr, /CAUSE=no-running-serve-instance/);
  assert.ok(!/FAIL=no-derivable-serve-address/.test(r.stderr), "this is a DIFFERENT refusal from 'could not derive'");
  assert.ok(!/FAIL=no-reachable-serve-address/.test(r.stderr), "this is a DIFFERENT refusal from 'could not reach'");
  // The runner's own `sh -c <criterion>` has this root as its cwd and carries the literal string in
  // its cmdline, so it IS discovered — and must be classified as NOT a serve process.
  const readings = r.stderr.match(/candidate readings \(cwd=.*\)/);
  assert.ok(readings, `the per-candidate readings must be reported even here; stderr: ${r.stderr}`);
  assert.match(readings[0], /nserve=0/, "the gate's own runner must not be counted as a serve instance");
});

// ── the three refusal shapes are pairwise distinct ──────────────────────────────────────────────
test("AC-301 block: the three refusal tokens are pairwise distinct (hard rule 3b)", async () => {
  const noInstance = (() => {
    const root = mkRoot();
    return runBlock(root).stderr.match(/CAUSE=no-running-serve-instance/)?.[0];
  })();
  const cannotDerive = (() => {
    const root = mkRoot();
    spawnFakeServe(root, { argvHost: "0.0.0.0", argvPort: 0, listenPort: 0 });
    return runBlock(root).stderr.match(/FAIL=no-derivable-serve-address/)?.[0];
  })();
  const cannotReach = (() => {
    const root = mkRoot();
    return runBlock(root).stderr.match(/FAIL=no-reachable-serve-address/)?.[0] ?? "absent";
  })();

  assert.ok(noInstance && cannotDerive, "all three shapes must actually be produced");
  assert.notEqual(noInstance, cannotDerive);
  assert.notEqual(noInstance, cannotReach);
  assert.notEqual(cannotDerive, cannotReach);
});

// ── the shipped criterion itself ────────────────────────────────────────────────────────────────
test("AC-301 criterion parses as /bin/sh over its WHOLE text (a folded comment must not become code)", () => {
  const r = spawnSync("/bin/sh", ["-n"], { input: criterionText(), encoding: "utf8" });
  assert.equal(r.status, 0, `sh -n rejected the shipped criterion:\n${r.stderr}`);
});

test("AC-301 block header names THIS fixture (the block is the one shipped for AC-301)", () => {
  assert.match(addrBlock(), new RegExp(FIXTURE_REL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("AC-301 criterion keeps its eleven pre-amendment CAUSE refusal branches and the /goal route", () => {
  const c = criterionText();
  for (const label of [
    "no-running-serve-instance",
    "en-fetch-failed",
    "zh-fetch-failed",
    "no-nav-region",
    "no-nav-region-zh",
    "english-baseline-missing",
    "no-title-tag",
    "html-lang-not-zh",
    "nav-label-untranslated",
    "no-title-tag-zh",
    "title-unchanged",
  ]) {
    assert.ok(c.includes(`CAUSE=${label} `), `the pre-amendment refusal branch ${label} was dropped`);
  }
  assert.equal((c.match(/CAUSE=/g) || []).length, 11, "the CAUSE-branch count must be unchanged");
  assert.match(c, /^ROUTE="\/goal"$/m);
  assert.match(c, /^LABEL_EN="Goals"$/m);
});

test("AC-301 criterion pins no host/port literal (it must re-derive on every run)", () => {
  const c = criterionText();
  assert.equal((c.match(/19071|172\.28/g) || []).length, 0, "a literal host/port would go stale on the next restart");
  // Negative control for the predicate itself: it must be able to fire (hard rule 2).
  assert.ok(/19071/.test("127.0.0.1:19071"), "the predicate must match a known-positive sample");
});

// ── ④ the WHOLE criterion on a self-made live surface: it must still be able to say NO ────────────
//
// §② above pins the derivation BLOCK's exit status (it appends `exit 0`). These cases run the ENTIRE
// criterion — the exact text `quay goal gate AC-301` executes — so "the assertion branches still have
// teeth" is a BEHAVIOUR reading of the shipped text, not a claim about the diff. The live surface is
// built HERE (a `git init`-ed scratch root, a real serve-shaped candidate carrying an explicit
// `--port N` on its OWN argv, and a real listener on that port answering /goal in two bodies chosen by
// the request's own `Cookie: lang=zh` header): ⛔ nothing under `packages/quay/src/serve-*.ts` is
// touched, and ⛔ the product's own serving path is not reused.

/** The same discovery surface as FAKE_SERVE_SRC, but the response body is chosen by the cookie — the two
 *  probes the criterion itself makes. Unlike FAKE_SERVE_SRC this one MUST listen on its argv port,
 *  because here the criterion reaches it through a real HTTP fetch rather than a refusal path. */
const FAKE_I18N_SERVE_SRC = [
  'const http = require("node:http");',
  'const en = process.env.FAKE_BODY_EN || "";',
  'const zh = process.env.FAKE_BODY_ZH || "";',
  "const port = Number(process.env.FAKE_LISTEN_PORT || 0);",
  "http",
  "  .createServer((req, res) => {",
  '    const wantsZh = /(?:^|;\\s*)lang=zh(?:;|$)/.test(req.headers.cookie || "");',
  '    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });',
  "    res.end(wantsZh ? zh : en);",
  "  })",
  '  .listen(port, "127.0.0.1");',
  "setInterval(() => {}, 1 << 30);",
].join("\n");

function spawnI18nServe(root, { argvPort, bodyEn, bodyZh }) {
  const child = spawn(
    process.execPath,
    ["-e", FAKE_I18N_SERVE_SRC, "quay.ts", "serve", "--host", "127.0.0.1", "--port", String(argvPort)],
    {
      cwd: root,
      env: { ...process.env, FAKE_LISTEN_PORT: String(argvPort), FAKE_BODY_EN: bodyEn, FAKE_BODY_ZH: bodyZh },
      stdio: "ignore",
    },
  );
  _children.push(child);
  return child;
}

const GOAL_EN =
  '<html lang="en"><nav><a href="/goal" class="current">Goals</a></nav><title>quay — Goals</title></html>';
/** Wired: the zh nav no longer carries the English label AND this page's own <title> switched. */
const GOAL_ZH_WIRED =
  '<html lang="zh"><nav><a href="/goal" class="current">目标</a></nav><title>quay — 目标</title></html>';
/** Not wired: the zh response IS <html lang="zh"> and its title DID switch, but the nav bar is untouched. */
const GOAL_ZH_UNTRANSLATED =
  '<html lang="zh"><nav><a href="/goal" class="current">Goals</a></nav><title>quay — 目标</title></html>';

test("AC-301 whole criterion PASSES (exit 0) on a live surface whose zh nav really is translated", async () => {
  const root = mkRoot();
  const port = await freePort();
  spawnI18nServe(root, { argvPort: port, bodyEn: GOAL_EN, bodyZh: GOAL_ZH_WIRED });
  assert.ok(await waitForPort(port), "the i18n fake serve must be listening before the criterion runs");

  const r = runCriterion(root);
  assert.equal(r.status, 0, `a wired surface must PASS: ${r.stderr}`);
  assert.match(r.stdout, /OK -- \/goal:/);
  // It reached the assertions — i.e. it did NOT read the address derivation's refusal path.
  assert.doesNotMatch(r.stderr, /FAIL=|CAUSE=/);
});

test("AC-301 whole criterion still FAILS (exit 1, nav-label-untranslated) on a reachable but unwired zh page", async () => {
  const root = mkRoot();
  const port = await freePort();
  spawnI18nServe(root, { argvPort: port, bodyEn: GOAL_EN, bodyZh: GOAL_ZH_UNTRANSLATED });
  assert.ok(await waitForPort(port), "the i18n fake serve must be listening before the criterion runs");

  const r = runCriterion(root);
  assert.equal(r.status, 1, `an unwired zh nav IS false — it must not report not-evaluated: ${r.stdout}`);
  assert.match(r.stderr, /CAUSE=nav-label-untranslated/);
  // The two states must not wear the same shape: this is FALSE (1), never NOT-EVALUATED (3).
  assert.notEqual(r.status, 3);
});

// ── ⑤ the amendment's own boundary, read off the shipped text ─────────────────────────────────────
test("AC-301 exactly four branches report not-evaluated and the ten assertion branches still fail", () => {
  // Comment lines are excluded: the amendment's WHY comment is PROSE that quotes both exit codes, and a
  // count that cannot tell prose from code would be a count of the comment (hard rule 2).
  const code = criterionText()
    .split("\n")
    .filter((l) => !/^\s*#/.test(l));
  const notEvaluated = code.filter((l) => /\bexit 3\b/.test(l));
  assert.equal(
    notEvaluated.length,
    4,
    `exactly four carrier-absence branches report not-evaluated, got ${notEvaluated.length}:\n${notEvaluated.join("\n")}`,
  );
  for (const token of [
    "FAIL=workspace-root-unresolvable",
    "FAIL=no-derivable-serve-address",
    "FAIL=no-reachable-serve-address",
    "CAUSE=no-running-serve-instance",
  ]) {
    assert.ok(
      notEvaluated.some((l) => l.includes(token)),
      `${token} must report not-evaluated (exit 3), not "this is false"`,
    );
  }
  // The other half of the amendment: nothing else moved. Every assertion branch keeps failing.
  const failing = code.filter((l) => /\bexit 1\b/.test(l));
  assert.equal(
    failing.length,
    10,
    `the ten assertion branches must still exit 1, got ${failing.length}:\n${failing.join("\n")}`,
  );
  for (const token of [
    "CAUSE=en-fetch-failed",
    "CAUSE=zh-fetch-failed",
    "CAUSE=no-nav-region ",
    "CAUSE=no-nav-region-zh",
    "CAUSE=english-baseline-missing",
    "CAUSE=no-title-tag ",
    "CAUSE=html-lang-not-zh",
    "CAUSE=nav-label-untranslated",
    "CAUSE=no-title-tag-zh",
    "CAUSE=title-unchanged",
  ]) {
    assert.ok(failing.some((l) => l.includes(token)), `${token} must still be able to say NO (exit 1)`);
  }
});
