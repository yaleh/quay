// @test-group engine
// live-web-address.test.mjs — the SINGLE-DEFINITION-POINT derivation helper
// (plugin/scripts/live-web-address.ts, gap-criterion-live-web-address-derivation-17-copies-to-one).
//
// WHAT THIS FILE DEFENDS. The helper is the one place that answers "what is this root's live web
// address", and every goal criterion that probes a RUNNING instance now asks it instead of inlining
// its own copy. The three inlined variants it replaces disagreed on real inputs, so the cases below
// pin the UNIFIED semantics rather than re-stating them:
//
//   AC3 (three-state, non-echo) — three REAL carriers on disk (well-formed / corrupt JSON / absent)
//       must yield exit `0 / 3 / 3`, and the two NOT-EVALUATED sub-states must be DIFFERENT strings
//       (硬规则 3b: "could not read it" may not wear the same shape as "read it, fine"). The CLI is
//       spawned for real, so it is the EXIT CODE that is asserted, not a returned enum.
//   AC4 (missing-field semantics) — a `web` entry with NO `up` field. The variants answered this in
//       OPPOSITE directions (`up === false` passed it, `up !== true` failed it). Unified: absent is
//       "not checked" (硬规则 6) ⇒ NOT-EVALUATED, a THIRD value distinct from both `true` (address)
//       and an explicit `false` (a real false ⇒ exit 1).
//
// The carriers below are written to a temp workspace and read back by the real CLI, so nothing here
// re-implements the reader (硬规则 4 推论三).
//
// Run (scoped): scripts/test.sh plugin/test/live-web-address.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { deriveLiveWebAddress, CARRIER_RELATIVE_PATH, runLiveWebAddressCli } from "../scripts/live-web-address.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "live-web-address.ts");
const GOALS_DIR = path.join(REPO_ROOT, "goals");

/** Build a temp workspace, run `fn(root)` against it, ALWAYS remove it. The `mkdtempSync` binding and
 *  its `rmSync` live in this one function on purpose — same scope, the removal inside a `finally`
 *  (the shape `tmp-leak-pairing-check`'s `detectMkdtempNoCleanup` accepts). */
function withRoot(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-web-address-"));
  try {
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Write a carrier into the temp root. `state` is spread over the schemaVersion/startedAt envelope,
 *  exactly the way a test fixture must not be allowed to diverge from the writer's shape. */
function writeCarrier(root, state) {
  fs.writeFileSync(
    path.join(root, CARRIER_RELATIVE_PATH),
    JSON.stringify({ schemaVersion: 1, startedAt: new Date().toISOString(), ...state }, null, 2),
  );
}

/** Spawn the REAL CLI. `--no-warnings` keeps Node's module-type notice out of the captured stderr —
 *  without it the sub-state word would arrive glued to a warning, and a caller parsing stderr would
 *  read a different string than the one this helper promises. */
function runCli(root, extraArgs = []) {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", SCRIPT, root, ...extraArgs],
    { encoding: "utf8" },
  );
  return { code: r.status, stdout: r.stdout ?? "", stderr: (r.stderr ?? "").trim() };
}

const WEB = (over = {}) => ({ name: "web", pid: 4242, host: "127.0.0.1", port: 51000, up: true, ...over });

// ── AC3: three REAL carriers ⇒ 0 / 3 / 3, distinct sub-states ─────────────────────────────────────
test("AC3: a well-formed carrier naming a live web service ⇒ exit 0, stdout host:port", () => {
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [WEB()] });
    const r = runCli(root);
    assert.equal(r.code, 0, `expected evaluable, got ${r.code}; stderr=${r.stderr}`);
    assert.equal(r.stdout, "127.0.0.1:51000");
    assert.equal(r.stderr, "", "an evaluable read must not write a sub-state to stderr");
  });
});

test("AC3: a CORRUPT carrier ⇒ exit 3, sub-state carrier-unreadable", () => {
  withRoot((root) => {
    fs.writeFileSync(path.join(root, CARRIER_RELATIVE_PATH), "{ not json at all ");
    const r = runCli(root);
    assert.equal(r.code, 3, `expected NOT-EVALUATED, got ${r.code}; stderr=${r.stderr}`);
    assert.equal(r.stderr, "carrier-unreadable");
  });
});

test("AC3: an ABSENT carrier ⇒ exit 3, sub-state carrier-absent — and it is a DIFFERENT word from corrupt", () => {
  withRoot((root) => {
    // No carrier written at all.
    const absent = runCli(root);
    fs.writeFileSync(path.join(root, CARRIER_RELATIVE_PATH), "{ not json at all ");
    const corrupt = runCli(root);
    assert.equal(absent.code, 3, `expected NOT-EVALUATED, got ${absent.code}; stderr=${absent.stderr}`);
    assert.equal(corrupt.code, 3);
    assert.equal(absent.stderr, "carrier-absent");
    assert.notEqual(
      absent.stderr,
      corrupt.stderr,
      "absent and unreadable must not share a sub-state — that is the 硬规则 3b collapse",
    );
  });
});

test("AC3: the two NOT-EVALUATED readings are distinguishable from the evaluable one", () => {
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [WEB()] });
    const ok = runCli(root);
    fs.writeFileSync(path.join(root, CARRIER_RELATIVE_PATH), "nope");
    const bad = runCli(root);
    assert.equal(ok.code, 0);
    assert.notEqual(ok.code, bad.code, "not-evaluated must not wear the evaluable exit code");
    assert.notEqual(ok.stdout, bad.stderr || bad.stdout, "the address and the sub-state are different outputs");
  });
});

// ── AC4: the missing-`up` semantic, UNIFIED and pinned ────────────────────────────────────────────
test("AC4: `up` ABSENT ⇒ exit 3 carrier-web-up-absent (missing is not-checked, never false)", () => {
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [{ name: "web", pid: 4242, host: "127.0.0.1", port: 51000 }] });
    const r = runCli(root);
    assert.equal(r.code, 3, `a missing up field must NOT pass, got ${r.code}`);
    assert.equal(r.stderr, "carrier-web-up-absent");
  });
  const fn = deriveLiveWebAddress;
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [{ name: "web", pid: 4242, host: "127.0.0.1", port: 51000 }] });
    const res = fn(root, "4242");
    assert.equal(res.state, "not-evaluated");
    assert.equal(res.subState, "carrier-web-up-absent");
  });
});

test("AC4: `up: true` ⇒ address; `up: false` ⇒ exit 1 carrier-web-down; the three are three values", () => {
  const seen = {};
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [WEB({ up: true })] });
    seen.up = runCli(root);
    writeCarrier(root, { pid: 4242, services: [WEB({ up: false })] });
    seen.down = runCli(root);
  });
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [{ name: "web", pid: 4242, host: "127.0.0.1", port: 51000 }] });
    seen.absent = runCli(root);
  });
  assert.equal(seen.up.code, 0, JSON.stringify(seen.up));
  assert.equal(seen.down.code, 1, JSON.stringify(seen.down));
  assert.equal(seen.down.stderr, "carrier-web-down");
  assert.equal(seen.absent.code, 3, JSON.stringify(seen.absent));
  // The whole point of the unification: an explicit `false` and an ABSENT field must not collapse.
  assert.notEqual(seen.down.code, seen.absent.code);
  assert.notEqual(seen.down.stderr, seen.absent.stderr);
});

test("AC4: `up` present but not a boolean is treated as absent (not as false)", () => {
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [WEB({ up: "yes" })] });
    const r = runCli(root);
    assert.equal(r.code, 3, `a non-boolean up must be NOT-EVALUATED, got ${r.code}`);
    assert.equal(r.stderr, "carrier-web-up-absent");
  });
});

// ── the rest of the state machine (each sub-state is reachable and NAMED) ─────────────────────────
test("schemaVersion other than 1 ⇒ carrier-unreadable (an old carrier is not a usable address)", () => {
  withRoot((root) => {
    fs.writeFileSync(
      path.join(root, CARRIER_RELATIVE_PATH),
      JSON.stringify({ schemaVersion: 2, pid: 4242, services: [WEB()] }),
    );
    const r = runCli(root);
    assert.equal(r.code, 3);
    assert.equal(r.stderr, "carrier-unreadable");
  });
});

test("a carrier naming a DIFFERENT pid ⇒ carrier-pid-mismatch (a stale carrier must not be trusted)", () => {
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [WEB()] });
    const r = runCli(root, ["999999"]);
    assert.equal(r.code, 3);
    assert.equal(r.stderr, "carrier-pid-mismatch");
  });
});

test("no `web` entry (control only) ⇒ carrier-no-web-service", () => {
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [{ name: "control", pid: 4242, host: "127.0.0.1", port: 1, up: true }] });
    const r = runCli(root);
    assert.equal(r.code, 3);
    assert.equal(r.stderr, "carrier-no-web-service");
  });
});

test("a web entry whose address is unusable ⇒ carrier-web-address-unusable", () => {
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [WEB({ host: "" })] });
    assert.equal(runCli(root).stderr, "carrier-web-address-unusable");
    writeCarrier(root, { pid: 4242, services: [WEB({ port: 0 })] });
    assert.equal(runCli(root).stderr, "carrier-web-address-unusable");
    writeCarrier(root, { pid: 4242, services: [WEB({ port: "51000" })] });
    assert.equal(runCli(root).stderr, "carrier-web-address-unusable");
  });
});

test("the host is emitted VERBATIM (no 0.0.0.0 rewriting here — the caller normalizes)", () => {
  withRoot((root) => {
    writeCarrier(root, { pid: 4242, services: [WEB({ host: "0.0.0.0" })] });
    const r = runCli(root);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "0.0.0.0:51000");
  });
});

test("usage: no root ⇒ exit 2 and a usage line on stderr", () => {
  const out = [];
  const orig = process.stderr.write;
  process.stderr.write = (s) => {
    out.push(String(s));
    return true;
  };
  let code;
  try {
    code = runLiveWebAddressCli([]);
  } finally {
    process.stderr.write = orig;
  }
  assert.equal(code, 2);
  assert.match(out.join(""), /usage: live-web-address\.ts/);
});

// ── AC5: every criterion that CALLS the helper really depends on it (mutation + deletion control) ──
//
// WHY THIS IS THE LOAD-BEARING CONTROL. "the criteria were edited to call the helper" is a claim about
// TEXT; the claim that matters is that the call is LOAD-BEARING — that mutating the helper changes
// every criterion's verdict. So this section runs the SHIPPED criterion texts (extracted from
// `goals/`, ⛔ never a copy) against a fixture root that is otherwise identical in three modes:
//
//   real    — the shipped helper            ⇒ every criterion reaches its assertions and passes (0)
//   mutant  — a helper that always reports NOT-EVALUATED ⇒ every criterion reports NOT-EVALUATED (3)
//   missing — no helper at all              ⇒ every criterion exits NON-ZERO
//
// The `real` arm is what makes the other two discriminating: without it, a "no candidate here" root
// would give exit 3 in all three modes and the control would prove nothing (硬规则 4 推论三).
//
// The fixture page is GENERIC on purpose: its English nav carries every label the criteria assert on,
// and its zh face carries none of them with a changed <title>. One page, every subject — the arm under
// test is the DERIVATION, not the page (the `/doc` index AC-904 reads is appended outside `<nav>`).

const MUTANT_HELPER = `process.stderr.write("carrier-unreadable\\n");\nprocess.exit(3);\n`;

/** Every goal criterion that derives its address through the helper. */
function convergedCriteria() {
  const out = [];
  for (const name of fs.readdirSync(GOALS_DIR).sort()) {
    if (!name.endsWith(".md")) continue;
    const raw = fs.readFileSync(path.join(GOALS_DIR, name), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    if (!fm) continue;
    let doc;
    try {
      doc = parseYaml(fm[1]);
    } catch {
      continue;
    }
    if (!doc || typeof doc.criterion !== "string") continue;
    if (!doc.criterion.includes("live-web-address.ts")) continue;
    out.push({ id: String(doc.id), criterion: doc.criterion, label: (/LABEL_EN="([^"]*)"/.exec(doc.criterion) ?? [])[1] });
  }
  return out;
}

const CRITERIA = convergedCriteria();
const LABELS = [...new Set(CRITERIA.map((c) => c.label).filter(Boolean))];
// The drill criteria name the doc record they require the `/doc` page to LIST (`grep -q 'DOC-910'`).
// Deriving the ids from the corpus — instead of a literal list — keeps the fixture page in step when a
// new drill criterion joins the set.
const DOC_IDS = [...new Set(CRITERIA.flatMap((c) => [...c.criterion.matchAll(/DOC-\d+/g)].map((m) => m[0])))];

function enPage() {
  const nav = LABELS.map((l) => `<a href="#">${l}</a>`).join("");
  return `<!doctype html><html lang="en"><head><title>quay EN baseline</title></head><body><nav>${nav}</nav><div id="goal-card">GOAL-022</div></body></html>`;
}
const ZH_PAGE = `<!doctype html><html lang="zh"><head><title>quay 中文基线</title></head><body><nav><a href="#">首页</a></nav></body></html>`;

/** One fixture root for one mode, shared by all 17 criteria (they all need the same shape). */
async function makeHarness(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `lwa-ac5-${mode}-`));
  // The criteria resolve `$root` with `git rev-parse --show-toplevel`, so the fixture root must BE a
  // git root (⛔ without this every arm is "cannot evaluate" and the control proves nothing).
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  // The fake serve below is spawned with the PRODUCTION entry shape (`packages/quay/bin/quay.ts`), so
  // the directory must exist: AC-340 `readlink -f`s the entry it greps out of `/proc/<pid>/cmdline`,
  // and `readlink -f` requires every component but the last to exist.
  fs.mkdirSync(path.join(root, "packages", "quay", "bin"), { recursive: true });
  if (mode === "real") fs.copyFileSync(SCRIPT, path.join(root, "plugin", "scripts", "live-web-address.ts"));
  if (mode === "mutant") fs.writeFileSync(path.join(root, "plugin", "scripts", "live-web-address.ts"), MUTANT_HELPER);

  const server = http.createServer((req, res) => {
    const url = String(req.url ?? "");
    const wantsZh = /(?:^|;\s*)lang=zh(?:;|$)/.test(String(req.headers.cookie ?? "")) || /lang=zh/.test(url);
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (/lang=zh/.test(url)) res.setHeader("set-cookie", "lang=zh; Path=/");
    let body = wantsZh ? ZH_PAGE : enPage();
    // The GOAL drill criteria (AC-904/905/906/907) are each satisfied by `GET /doc` LISTING their own
    // managed record (`DOC-904` / `DOC-910` / `DOC-920` / `DOC-930`), so the `/doc` response carries a
    // doc-index element naming every record the corpus asks for. Appended OUTSIDE `<nav>`: the other
    // criteria assert on the nav region + `<title>` (both unchanged), so this stays one generic page
    // serving every subject — the arm under test is the DERIVATION, not the page content (硬规则 4 推论三).
    if (/^\/doc(?:[?#]|$)/.test(url)) body = body.replace("</body>", `<div id="doc-index">${DOC_IDS.join(" ")}</div></body>`);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const pagePort = server.address().port;

  // A real process whose argv carries the PRODUCTION entry shape `packages/quay/bin/quay.ts serve` and
  // whose /proc/<pid>/cwd IS this root — the candidate shape the criteria accept. The full production
  // path (⛔ not the bare `quay.ts`) is deliberate: the 17 converged criteria locate it with the loose
  // `pgrep -f 'quay.ts serve'` (which the longer string still contains), while AC-340 locates the SAME
  // process by its real entry path (`packages/quay/bin/quay\.(ts|js)`) and `readlink -f`s it. A fixture
  // that served only the bare name would make AC-340 unreachable on its own contract, not prove it
  // wrong — the arm under test is the DERIVATION, so the fixture must carry the shape production does.
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 60000)", "packages/quay/bin/quay.ts", "serve", "--host", "127.0.0.1", "--port", "0"],
    { cwd: root, detached: true, stdio: "ignore", argv0: "node" },
  );
  child.unref();

  writeCarrier(root, {
    pid: child.pid,
    services: [
      { name: "web", pid: child.pid, host: "127.0.0.1", port: pagePort, up: true },
      { name: "control", pid: child.pid, host: "127.0.0.1", port: 1, up: true },
    ],
  });

  return {
    root,
    async cleanup() {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      await new Promise((r) => server.close(r));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function runCriterionText(root, criterion) {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", criterion], { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const killer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("AC5: the corpus really is every goal criterion that calls the helper (guard against a vacuous control)", () => {
  // 22 = the 17 converged criteria (gap-criterion-live-web-address-derivation-17-copies-to-one) + AC-904,
  // the GOAL-904 drill criterion added 2026-10-04 (`1aec2bd8b`), + AC-905/906/907, the GOAL-905 drill
  // criteria added 2026-10-05 whose inlined `server.json` reads were replaced by a call to the helper
  // (gap-dispatch-worktree-setup-links-node-modules-for-pnpm-projects), + AC-340, the GOAL-030 preview
  // criterion added 2026-10-08 (`1bc75c391`) whose inlined `.quay/server.json` read was replaced by the
  // helper's pid-owner gate (gap-goal030-kernel-task-transition-and-status-event). The predicate is
  // deliberately live (the criterion TEXT names the helper), so the count is the guard against a vacuous
  // (empty/one-element) control and must move whenever a new caller joins the set.
  assert.equal(CRITERIA.length, 22, `expected every criterion that calls the helper, found ${CRITERIA.length}: ${CRITERIA.map((c) => c.id).join(",")}`);
  assert.ok(LABELS.length >= 14, `the English nav must carry every asserted label, found ${LABELS.length}`);
});

test("AC5 (real arm): with the shipped helper every converged criterion PASSES on the fixture", async () => {
  const h = await makeHarness("real");
  try {
    for (const c of CRITERIA) {
      const r = await runCriterionText(h.root, c.criterion);
      assert.equal(r.code, 0, `${c.id} should pass with the shipped helper, got ${r.code}; stderr=${r.stderr.slice(0, 400)}`);
    }
  } finally {
    await h.cleanup();
  }
});

test("AC5 (mutant arm): a helper that always reports NOT-EVALUATED makes EVERY criterion refuse — never a silent pass", async () => {
  // ⚠️ WHAT "REPORTS NOT-EVALUATED" IS MEASURED AS HERE, and why not "exit 3" on every row.
  //
  // The repository's own convention is 0=PASS / 1=FAIL / 2=usage / 3=NOT-EVALUATED, and 10 of these
  // 17 criteria ALREADY mapped their underivable-address refusal to exit 1 (measured 2026-09-30 on
  // this very fixture: `3` for AC-179/290/291/292/297/301/303, `1` for the other ten). That split is
  // the leftover of the `gap-ac2XX-criterion-carrier-absence-not-evaluated` family — filed one-AC-at-a-
  // time for 291/292/301/303 only — and is ⛔ NOT in this task's P1–P4 scope (the Plan changes the
  // DERIVATION, not each criterion's verdict vocabulary); it is recorded as an owed follow-up in the
  // task body's Evidence. What THIS task must prove, and what is asserted below, is the property its own
  // parenthetical names: mutating the single definition point must make every criterion FAIL CLOSED
  // and NAME the underivable address — a criterion that still printed `OK --` would be the silent
  // pass the negative control exists to exclude.
  const h = await makeHarness("mutant");
  const codes = [];
  try {
    for (const c of CRITERIA) {
      const r = await runCriterionText(h.root, c.criterion);
      codes.push(`${c.id}=${r.code}`);
      assert.notEqual(r.code, 0, `${c.id} must fail closed with a not-evaluating helper, got 0`);
      assert.doesNotMatch(r.stdout, /^OK -- /m, `${c.id} printed a PASS while the derivation was not evaluable: ${r.stdout.slice(0, 200)}`);
      assert.match(
        r.stderr,
        // The last alternative is AC-340's: its criterion refuses with "no live quay serve registered
        // under <root>" rather than naming the ADDRESS. It is still a NAMED refusal (⛔ not a silent
        // pass — the two assertions above pin that), so the vocabulary admits it: the property under
        // test is that the mutation is LOAD-BEARING (every caller notices), not that all 22 phrase the
        // cause identically.
        /no-derivable-serve-address|no-derivable-address|no live candidate exposed a derivable address|no live web address for|no live quay serve registered/,
        `${c.id} must NAME the underivable-address refusal: ${r.stderr.slice(0, 300)}`,
      );
    }
  } finally {
    await h.cleanup();
  }
  // Enumerate, don't boolean (硬规则 3): the per-criterion codes are part of the reading.
  assert.equal(codes.length, 22, codes.join(" "));
});

test("AC5 (missing arm): with the helper DELETED every criterion exits NON-ZERO (the call is real)", async () => {
  const h = await makeHarness("missing");
  try {
    for (const c of CRITERIA) {
      const r = await runCriterionText(h.root, c.criterion);
      assert.notEqual(r.code, 0, `${c.id} must fail closed without the helper, got 0`);
    }
  } finally {
    await h.cleanup();
  }
});
