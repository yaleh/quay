// @test-group product
// gap-verification-round-empty-state-lumps-three-distinct-causes — the `/tests` empty state used to
// merge THREE structurally different causes into ONE `status` + ONE reason string
// (「尚未跑过验证轮 → 未接入」):
//
//   (a) nothing in this workspace can ever write the ledger   → `empty-no-writer`
//   (b) a writer IS wired, it has simply produced no row yet  → `empty-writer-zero-records`
//   (c) the ledger is present but unreadable                  → `error`
//
// Only (b) is a timing statement. Rendering (a) as 「尚未跑过验证轮」 sends the reader down a fix path
// («run another round») that does not exist for it — a workspace with no suite entry can run a thousand
// rounds and the ledger stays empty. Hard rule 3 (枚举，不布尔) requires the DISCRIMINATOR to live in
// `status`, not merely in the page's prose, so a downstream reader of the DATA can tell them apart too.
//
// Three layers:
//   1. `detectRoundWriterPath` — the direct quantity, unit-tested against the workspace shapes it must
//      separate (⛔ reads `<root>` alone; no driver-side input, hard rule 4c).
//   2. `readTests` — the status enumeration, including the `error` value that must NOT regress into
//      either empty value (the DEGRADATION CONTRACT in observation.ts's header).
//   3. The RENDERED page — real HTML from a real started server, because AC2 is about what the reader
//      sees, and the three copies must be pairwise different.
//
// Run (scoped): node --test packages/quay/test/serve-tests-empty-state.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { clearVerificationRoundCache, detectRoundWriterPath, readTests } from "../src/observation.ts";
import { obsNote } from "../src/serve-render.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const repoRoot = path.join(__dirname, "..", "..", "..");

/** A minimal but LEGAL quay workspace (`.quay/config.yml` is the provider map — a bare tasks dir is
 *  not a workspace). The `loop:` section is written by the caller, since it is the discriminator. */
function makeWorkspace(prefix, loopYaml = "") {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n` +
      loopYaml,
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "serve-tests-empty-state fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: ws });
  return ws;
}

function writeRound(ws, fields) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "verification-round.jsonl"),
    JSON.stringify({
      round: 1, startedAt: "2026-09-13T00:00:00Z", durationMs: 1000, state: "green",
      pass: 7, fail: 0, cancelled: 0, tests: 7, reason: null, commit: "abcdef123456",
      scope: "repo", runner: "test.sh", failures: [], ...fields,
    }) + "\n",
  );
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** Render the REAL `/tests` page for a workspace by starting the real server on it (AC1's "实际 HTML
 *  文本，不以 HTTP 200 为证据"). Returns the page body. */
async function renderTestsPage(ws) {
  const cwd0 = process.cwd();
  process.chdir(ws);
  const port = await freePort();
  const server = await startServer({ port, host: "127.0.0.1" });
  try {
    const r = await get(port, "/tests");
    assert.equal(r.status, 200, "/tests returned 200");
    return r.body;
  } finally {
    // The provider client OWNS a live child process: `http.Server.close()` alone leaves it running and
    // the test file never exits (zero output, indistinguishable from a hung import). The established
    // teardown is close() + `await server.client.close()` — see serve.ts:326-331.
    server.close();
    if (server.client) await server.client.close();
    process.chdir(cwd0);
  }
}

/** The rendered obsNote line(s) — the reader-visible state copy, isolated from the rest of the page. */
function noteLines(html) {
  return [...html.matchAll(/<p class="meta"><strong>([^<]*)<\/strong> — ([^<]*)<\/p>/g)].map((m) => m[0]);
}

// ── Layer 1: detectRoundWriterPath — the direct quantity ─────────────────────────────────────────────

test("detectRoundWriterPath: scripts/test.sh alone means wired (the quay-shaped suite entry fan-in runs)", () => {
  const ws = makeWorkspace("tse-sh-");
  try {
    fs.mkdirSync(path.join(ws, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n");
    const p = detectRoundWriterPath(ws);
    assert.equal(p.wired, true);
    assert.deepEqual(p.signals, ["scripts/test.sh"]);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("detectRoundWriterPath: loop.test_command alone means wired (the third-party delegated entry)", () => {
  const ws = makeWorkspace("tse-cmd-", `loop:\n  test_command: node --test\n`);
  try {
    const p = detectRoundWriterPath(ws);
    assert.equal(p.wired, true);
    assert.deepEqual(p.signals, ["loop.test_command"]);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("detectRoundWriterPath: loop.test_output is reported as EVIDENCE but does not by itself wire a writer", () => {
  // A declared parse contract with no runnable entry runs nothing — the writer side resolves the entry
  // (worker-driver.ts resolveScopedGateCommand / suiteRunsOutsideRunner) off test.sh || test_command.
  // Reporting this as 「已接入」 would be a fabricated capability (hard rule 3b).
  const ws = makeWorkspace("tse-out-", `loop:\n  test_output:\n    pass: 'pass (\\\\d+)'\n`);
  try {
    const p = detectRoundWriterPath(ws);
    assert.equal(p.wired, false);
    assert.deepEqual(p.signals, ["loop.test_output"]);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("detectRoundWriterPath: neither entry nor declaration ⇒ not wired, and it CAN take false (hard rule 4c)", () => {
  const ws = makeWorkspace("tse-none-");
  try {
    const p = detectRoundWriterPath(ws);
    assert.equal(p.wired, false);
    assert.deepEqual(p.signals, []);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("detectRoundWriterPath: reads <root> DIRECTLY — a parent workspace's loop config does not leak in", () => {
  // The upward-searching reader (config.ts findConfig) would inherit /home/yale's declarations for a
  // bare temp dir; the workspace must be judged by its OWN .quay/config.yml (no upward search).
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tse-parent-"));
  const child = path.join(parent, "child");
  try {
    fs.mkdirSync(path.join(parent, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(parent, ".quay", "config.yml"), "loop:\n  test_command: node --test\n");
    fs.mkdirSync(child, { recursive: true });
    const p = detectRoundWriterPath(child);
    assert.equal(p.wired, false, "the parent's loop.test_command must NOT be attributed to the child");
    assert.deepEqual(p.signals, []);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ── Layer 2: readTests — the status enumeration ──────────────────────────────────────────────────────

test("readTests: absent ledger + writable workspace ⇒ empty-writer-zero-records (a TIMING fact)", () => {
  const ws = makeWorkspace("tse-rw-", `loop:\n  test_command: node --test\n`);
  try {
    clearVerificationRoundCache();
    const t = readTests(ws);
    assert.equal(t.status, "empty-writer-zero-records");
    assert.equal(t.runs.length, 0);
    assert.match(t.reason, /已接入写者/, "the reason names the writer wiring as present");
    assert.doesNotMatch(t.reason, /尚未跑过验证轮/, "the old timing-only wording is gone");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("readTests: absent ledger + no writer path ⇒ empty-no-writer (a WIRING fact, not a timing one)", () => {
  const ws = makeWorkspace("tse-rn-");
  try {
    clearVerificationRoundCache();
    const t = readTests(ws);
    assert.equal(t.status, "empty-no-writer");
    assert.equal(t.runs.length, 0);
    assert.match(t.reason, /无写者接入该载体/);
    assert.doesNotMatch(t.reason, /尚未跑过验证轮/, "the old timing-only wording is gone");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("readTests: ledger present but no parseable row ⇒ empty-writer-zero-records (a writer DID run)", () => {
  const ws = makeWorkspace("tse-garbage-");
  try {
    fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), "\nnot json\n\n");
    clearVerificationRoundCache();
    const t = readTests(ws);
    assert.equal(t.status, "empty-writer-zero-records");
    assert.equal(t.runs.length, 0);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("readTests: unreadable ledger ⇒ error, still distinct from BOTH empty values (DEGRADATION CONTRACT)", () => {
  // A directory at the ledger path: existsSync true, readFileSync throws EISDIR ⇒ the PRESENT-but-
  // unreadable branch. 「读失败」 must not collapse into either 「无数据」 value.
  const ws = makeWorkspace("tse-eisdir-", `loop:\n  test_command: node --test\n`);
  try {
    fs.mkdirSync(path.join(ws, ".quay", "verification-round.jsonl"), { recursive: true });
    clearVerificationRoundCache();
    const t = readTests(ws);
    assert.equal(t.status, "error");
    assert.match(t.reason, /读失败/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("readTests: a workspace WITH records is still ok (no regression on the populated path)", () => {
  const ws = makeWorkspace("tse-ok-", `loop:\n  test_command: node --test\n`);
  try {
    writeRound(ws, {});
    clearVerificationRoundCache();
    const t = readTests(ws);
    assert.equal(t.status, "ok");
    assert.equal(t.reason, null);
    assert.equal(t.runs.length, 1);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── Layer 3: the RENDERED page — three causes, three copies ──────────────────────────────────────────

test("AC2: the three reader-visible copies are PAIRWISE DIFFERENT (枚举，不布尔)", () => {
  const noWriter = obsNote("empty-no-writer", "REASON-A");
  const writerZero = obsNote("empty-writer-zero-records", "REASON-B");
  const unreadable = obsNote("error", "REASON-C");
  const all = [noWriter, writerZero, unreadable];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      assert.notEqual(all[i], all[j], `copies ${i} and ${j} render identically — the causes are not enumerated`);
    }
  }
  assert.match(noWriter, /未接入\/无数据/);
  assert.match(writerZero, /已接入\/暂无记录/);
  assert.match(unreadable, /读失败/);
  // ok renders no note at all — the populated path is untouched (AC5's negative control at unit level).
  assert.equal(obsNote("ok", null), "");
});

test("AC1/AC3: the REAL /tests page renders the distinct copy per cause (actual HTML, not just status)", async () => {
  const wired = makeWorkspace("tse-page-wired-", `loop:\n  test_command: node --test\n`);
  const unwired = makeWorkspace("tse-page-unwired-");
  try {
    // Writer wired, zero records: must say 「已接入/暂无记录」 and must NOT say 「尚未跑过验证轮」.
    const wiredHtml = await renderTestsPage(wired);
    assert.match(wiredHtml, /已接入\/暂无记录/, "wired-but-empty renders the wired copy");
    assert.doesNotMatch(wiredHtml, /尚未跑过验证轮/, "the timing-only wording is gone from the wired case");
    assert.doesNotMatch(wiredHtml, /未接入\/无数据/, "the wired case must not wear the not-wired label");

    // No writer path: must say 「未接入/无数据」 and name the wiring entry, NOT imply waiting.
    const unwiredHtml = await renderTestsPage(unwired);
    assert.match(unwiredHtml, /未接入\/无数据/, "no-writer renders the not-wired copy");
    assert.doesNotMatch(unwiredHtml, /尚未跑过验证轮/, "the timing-only wording is gone");
    assert.doesNotMatch(unwiredHtml, /已接入\/暂无记录/, "the no-writer case must not claim a writer");
    assert.match(unwiredHtml, /无写者接入该载体/, "the copy names the cause explicitly");

    assert.notDeepEqual(noteLines(wiredHtml), noteLines(unwiredHtml), "the two rendered notes differ");
  } finally {
    fs.rmSync(wired, { recursive: true, force: true });
    fs.rmSync(unwired, { recursive: true, force: true });
  }
});

// ── AC3: the guidance must name entries that EXIST (⛔ not a command name invented on the page) ───────

test("AC3: every entry the no-writer guidance names actually exists", () => {
  const ws = makeWorkspace("tse-guidance-");
  try {
    clearVerificationRoundCache();
    const { reason } = readTests(ws);

    // 1. `loop.test_command` — a real config key, read by BOTH the writer side and the render side.
    assert.match(reason, /loop 段声明 test_command/);
    const writerSide = fs.readFileSync(path.join(repoRoot, "plugin", "scripts", "worker-driver.ts"), "utf8");
    assert.match(writerSide, /loop\.test_command|\.test_command/, "worker-driver.ts really reads loop.test_command");

    // 2. `plugin/scripts/quay-init.sh` — the script that WRITES that declaration.
    const initScript = path.join(repoRoot, "plugin", "scripts", "quay-init.sh");
    assert.ok(fs.existsSync(initScript), `the named init entry exists: ${initScript}`);
    assert.match(fs.readFileSync(initScript, "utf8"), /test_command/, "quay-init.sh really writes loop.test_command");

    // 3. `/quay:init --all --loop` — the operator-facing equivalent, a real skill.
    assert.match(reason, /\/quay:init --all --loop/);
    const initSkill = path.join(repoRoot, "plugin", "skills", "init", "SKILL.md");
    assert.ok(fs.existsSync(initSkill), `the named skill entry exists: ${initSkill}`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
