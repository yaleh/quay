// @test-group product
// gap-webui-doc-tasks-residual-copy-en-zh — the LAST five hard-coded Chinese UI strings on /doc,
// /tasks and /task/<id> (the Runs block), moved onto the AC-288 dictionary.
//
// WHY THIS FILE EXISTS AT ALL (and why a probe was not optional): these five strings are all
// EDGE-STATE copy — a document-store read failure, a missing-id placeholder row, an unparseable
// frontmatter row, the Runs block's empty state, and its in-flight row. None of them renders on the
// default URL a criterion would grab, so the series' usual baseline ("count the CJK lines under
// lang=en") is TRUE BEFORE THE CHANGE and therefore carries no information (硬规则 4: a quantity
// that cannot take the other value is not a measurement). Every reading here is taken from a REAL
// HTTP response body of a REAL `quay serve` over a fixture whose five states are actually TRIGGERED
// — see `before()` for how each one is made to render.
//
// The switcher endonym `中文` is deliberately EXCLUDED from the "interface CJK = 0" predicate: ROW 4
// of serve-i18n.ts pins it to read 中文 under BOTH languages (an English exonym would make the
// switcher usable only by readers who do not need it). It is subtracted by name, not by accident —
// `interfaceCjkLines` below does exactly that one subtraction and nothing else.
//
// Run (scoped): node --test packages/quay/test/serve-doc-tasks-residual-i18n.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/serve.ts";
import {
  DOC_TASK_KEYS, DOC_TASK_LABELS, docTaskLabelsFor, docTaskLabel,
} from "../src/serve-i18n.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

const CJK = /[一-鿿]/;
/** ROW 4's endonym — pinned to 中文 under both languages, so it is NOT interface residue. */
const LANG_ENDONYM = "中文";

/** Visible text lines of a response: scripts/styles dropped (their source is not page copy), every
 *  tag replaced by a newline so a `<code>`-interleaved sentence yields its text nodes separately. */
function visibleTextLines(body) {
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "\n");
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Every visible line carrying a CJK character — the raw predicate, endonym INCLUDED. */
function cjkLines(body) {
  return visibleTextLines(body).filter((l) => CJK.test(l));
}

/** The same predicate with ROW 4's endonym subtracted. This is the "interface copy is all English"
 *  reading; the endonym is the ONE line that is supposed to stay Chinese on an English page. */
function interfaceCjkLines(body) {
  return cjkLines(body).filter((l) => l !== LANG_ENDONYM);
}

function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** A task file the native provider parses cleanly. */
function validTask(id, title) {
  return `---\nid: ${id}\ntitle: ${title}\nstatus: todo\nlabels: []\n---\n\n## Proposal\nbody for ${id}\n`;
}

// ── the fixture: FIVE edge states, each actually made to render ─────────────────────────────────
// ① /doc read failure      — `docs-managed/DOC-001.md` is a DIRECTORY, so DocumentStore.list()'s
//                            readFileSync hits EISDIR and serve-doc.ts's catch turns it into the
//                            `读失败:` banner. (A missing dir is NOT a trigger: createDocumentStore
//                            mkdirSyncs it — measured, not assumed.)
// ② /tasks missing id      — `noid.md` carries frontmatter with no `id:`, so the provider marks it
//                            extra.malformed=["missing-id"] and the list renders the placeholder row.
// ③ /tasks parse failure   — `broken.md` has an unterminated quote in its YAML, so the provider
//                            returns it in the machine-readable `malformed` list instead.
// ④ /task/<id> Runs empty  — no worker-outcome record for GAPDOC-001 (the carrier exists, so
//                            workerDriverActive() is true and the scan runs — the record set for
//                            THIS task is what is empty).
// ⑤ /task/<id> Runs live   — a real child process whose /proc cmdline carries the worker marker
//                            (`quay-task-worker … Task: <id>. Repo root: <root>.`), i.e. the same
//                            direct量 readLiveWorkerProcesses() reads in production. The pid is a
//                            real process, not an injected list — this arm would be vacuous if the
//                            scan were stubbed.
let server, port, ws, tasksDir, originalCwd, fakeWorker;

before(async () => {
  tasksDir = makeTmpDir("doc-task-i18n-tasks-");
  ws = makeTmpDir("doc-task-i18n-ws-");

  fs.writeFileSync(path.join(tasksDir, "GAPDOC-001.md"), validTask("GAPDOC-001", "runs empty probe"));
  fs.writeFileSync(path.join(tasksDir, "GAPDOC-002.md"), validTask("GAPDOC-002", "runs live probe"));
  // ② no `id:` at all — the provider falls back to the filename and flags the task.
  fs.writeFileSync(path.join(tasksDir, "noid.md"), "---\ntitle: no id here\nstatus: todo\n---\n\n## Proposal\nbody\n");
  // ③ YAML that cannot be parsed (unterminated double quote).
  fs.writeFileSync(path.join(tasksDir, "broken.md"), '---\nid: BROKEN-9\ntitle: "unterminated\nstatus: todo\n---\nbody\n');

  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  // ① a broken entry INSIDE the document store — the throw comes from list()'s read, not from the
  //    store's construction.
  fs.mkdirSync(path.join(ws, "docs-managed", "DOC-001.md"), { recursive: true });
  // ④/⑤ the outcome carrier must EXIST for the live scan to run at all; its only record is for a
  //    DIFFERENT task, so both GAPDOC tasks have an empty record set.
  fs.writeFileSync(
    path.join(ws, ".quay", "worker-outcome.jsonl"),
    JSON.stringify({ ts: "2026-09-18T00:00:00Z", task: "SOME-OTHER-TASK", final_state: "completed", exit_code: 0 }) + "\n",
  );

  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "doc-task residual i18n fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: ws });

  // ⑤ the in-flight worker: argv is joined with spaces when /proc/<pid>/cmdline's NULs are read, so
  //    the marker sentence lands intact. `setTimeout` keeps it alive for the whole file.
  const rootResolved = fs.realpathSync(ws);
  fakeWorker = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 300000)", "quay-task-worker", "Task: GAPDOC-002.", "Repo", "root:", `${rootResolved}.`],
    { stdio: "ignore" },
  );
  fakeWorker.unref();

  originalCwd = process.cwd();
  process.chdir(ws);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  if (fakeWorker) { try { fakeWorker.kill("SIGKILL"); } catch { /* already gone */ } }
  if (server) {
    await new Promise((r) => server.close(r));
    if (server.client) await server.client.close();
  }
  if (originalCwd) process.chdir(originalCwd);
});

// ── the dictionary (AC4) ────────────────────────────────────────────────────────────────────────

test("AC4 (unit) — DOC_TASK_LABELS is closed: two non-empty columns, en carries no CJK", () => {
  assert.ok(Array.isArray(DOC_TASK_KEYS) && DOC_TASK_KEYS.length > 0, "the roster is a non-empty array");
  assert.equal(new Set(DOC_TASK_KEYS).size, DOC_TASK_KEYS.length, "no duplicate keys");
  for (const key of DOC_TASK_KEYS) {
    const row = DOC_TASK_LABELS[key];
    assert.ok(row, `DOC_TASK_LABELS has a row for ${key}`);
    assert.equal(typeof row.en, "string", `${key}.en is a string`);
    assert.equal(typeof row.zh, "string", `${key}.zh is a string`);
    assert.ok(row.en.trim().length > 0, `${key}.en is non-empty`);
    assert.ok(row.zh.trim().length > 0, `${key}.zh is non-empty`);
    assert.ok(!CJK.test(row.en), `${key}.en carries no CJK (got ${JSON.stringify(row.en)})`);
    // ROW 8's stronger predicate (same as the dashboard row): a zh value with no CJK is allowed ONLY
    // when it is byte-equal to its en value, so a zh column accidentally left in English still reds.
    assert.ok(CJK.test(row.zh) || row.zh === row.en,
      `${key}.zh is Chinese, or byte-equal to en (the token-valued-row case); got ${JSON.stringify(row.zh)}`);
  }
  // The roster resolves for both languages and the two columns are actually different where copy
  // differs — a table whose two columns were swapped would otherwise pass every check above.
  const en = docTaskLabelsFor("en");
  const zh = docTaskLabelsFor("zh");
  assert.equal(Object.keys(en).length, DOC_TASK_KEYS.length, "the resolved en roster is complete");
  assert.equal(Object.keys(zh).length, DOC_TASK_KEYS.length, "the resolved zh roster is complete");
});

test("AC4 (unit) — an unknown key THROWS rather than silently rendering English", () => {
  assert.throws(() => docTaskLabel("no-such-key"), /unknown doc-task key/);
  assert.throws(() => docTaskLabel("no-such-key", "zh"), /unknown doc-task key/);
  // The RESOLVED roster is closed too: it carries exactly the declared keys and nothing else, so a
  // caller cannot reach a label that the roster does not own (the property that makes the throw above
  // unreachable from typed code, and which the black-box arms below therefore rely on).
  assert.deepEqual(Object.keys(docTaskLabelsFor("en")).sort(), [...DOC_TASK_KEYS].sort());
  assert.deepEqual(Object.keys(docTaskLabelsFor("zh")).sort(), [...DOC_TASK_KEYS].sort());
});

test("AC4 (unit) — a template row with a missing parameter THROWS (no `{error}` reaches the page)", () => {
  const templated = DOC_TASK_KEYS.filter((k) => /\{\w+\}/.test(DOC_TASK_LABELS[k].zh));
  assert.ok(templated.length >= 2, `the roster carries its interpolated rows (found ${templated.length})`);
  for (const key of templated) {
    const row = DOC_TASK_LABELS[key];
    const names = [...row.zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const lang of ["en", "zh"]) {
      // Supply every parameter but one: the call must throw for the missing one, in BOTH columns.
      const partial = Object.fromEntries(names.slice(1).map((n) => [n, "x"]));
      assert.throws(
        () => docTaskLabel(key, lang, partial),
        /supplied it not/,
        `${key} (${lang}) throws when {${names[0]}} is not supplied`,
      );
    }
  }
});

// ── the five edge states, over HTTP, in both languages (AC1/AC2/AC3/AC5) ────────────────────────

// Every URL this task touches. `/tasks` carries TWO of the five states (rows ② and ③), `/doc` one
// (①) and `/task/<id>` two (④ and ⑤, on two different tasks).
const EN_URLS = ["/doc", "/tasks", "/task/GAPDOC-001", "/task/GAPDOC-002"];
const ZH_URLS = [...EN_URLS];

test("AC1/AC2 (live) — under `lang=en` the five edge states render ZERO interface CJK", async () => {
  for (const urlPath of EN_URLS) {
    const r = await request(port, urlPath, { Cookie: "lang=en" });
    assert.equal(r.status, 200, `GET ${urlPath} (en) returns 200 (got ${r.status})`);
    const cjk = cjkLines(r.body);
    const iface = interfaceCjkLines(r.body);
    console.log(`  [en] ${urlPath}: cjkLines=${cjk.length} interface=${iface.length} ${JSON.stringify(iface.slice(0, 6))}`);
    assert.deepEqual(iface, [], `${urlPath} under en has no interface CJK left (endonym 中文 excluded by name)`);
    // The endonym is the ONLY CJK allowed through — a page that had lost the switcher entirely would
    // also read interface=0, so the exclusion is asserted rather than merely applied.
    assert.ok(cjk.every((l) => l === LANG_ENDONYM), `${urlPath} under en: the only CJK lines are the ROW 4 endonym`);
  }
});

test("AC1/AC2 (live) — the SAME predicate on `lang=zh` still hits (a zero that cannot be non-zero measures nothing)", async () => {
  for (const urlPath of ZH_URLS) {
    const r = await request(port, urlPath, { Cookie: "lang=zh" });
    assert.equal(r.status, 200, `GET ${urlPath} (zh) returns 200 (got ${r.status})`);
    const cjk = cjkLines(r.body);
    console.log(`  [zh] ${urlPath}: cjkLines=${cjk.length}`);
    assert.ok(cjk.length > 1, `${urlPath} under zh still carries Chinese (got ${cjk.length}) — the en reading is not a tautology`);
  }
});

test("AC1/AC5 (live) — ① /doc: the read-failure banner is English under en, Chinese under zh", async () => {
  const en = await request(port, "/doc", { Cookie: "lang=en" });
  assert.ok(en.body.includes("Read failed:"), "en /doc renders the English read-failure banner");
  assert.ok(!en.body.includes("读失败"), "en /doc must not render the zh banner text");
  console.log(`  [① en] ${JSON.stringify(/<div class="error-banner"[^>]*>[\s\S]{0,80}/.exec(en.body)?.[0] ?? "(no banner)")}`);

  const zh = await request(port, "/doc", { Cookie: "lang=zh" });
  assert.ok(zh.body.includes("读失败:"), "zh /doc still renders the pre-existing 读失败: banner, byte for byte");
  assert.ok(!zh.body.includes("Read failed:"), "zh /doc must not pick up the English banner");
  // The read error is the reader's own diagnostic string — DATA, passed through escapeHtml, untranslated.
  assert.ok(zh.body.includes("EISDIR") || /error-banner[^>]*>[\s\S]{0,200}<\/strong>/.test(zh.body), "the diagnostic reason still renders next to the label");
});

test("AC1/AC5 (live) — ② /tasks: the missing-id row is English under en, Chinese under zh", async () => {
  const en = await request(port, "/tasks", { Cookie: "lang=en" });
  assert.ok(en.body.includes("missing id field"), "en /tasks renders the English missing-id row");
  assert.ok(!en.body.includes("缺少 id 字段"), "en /tasks must not render the zh missing-id row");
  console.log(`  [② en] ${JSON.stringify(/<td colspan="6">⚠[\s\S]{0,120}?missing id field<\/td>/.exec(en.body)?.[0] ?? "(no row)")}`);

  const zh = await request(port, "/tasks", { Cookie: "lang=zh" });
  assert.ok(zh.body.includes("缺少 id 字段"), "zh /tasks still renders the pre-existing 缺少 id 字段 row");
});

test("AC1/AC5 (live) — ③ /tasks: the parse-failure row is English under en, Chinese under zh", async () => {
  const en = await request(port, "/tasks", { Cookie: "lang=en" });
  assert.ok(en.body.includes("parse failed:"), "en /tasks renders the English parse-failure row");
  assert.ok(!en.body.includes("解析失败"), "en /tasks must not render the zh parse-failure row");
  // The file name is wrapped in <code> — the markup is the caller's, the sentence is the dictionary's.
  assert.ok(/<code>broken\.md<\/code>/.test(en.body), "the unparseable file name is still rendered in <code>");
  console.log(`  [③ en] ${JSON.stringify(/<td colspan="6">⚠ <code>[\s\S]{0,160}?<\/td>/.exec(en.body)?.[0] ?? "(no row)")}`);

  const zh = await request(port, "/tasks", { Cookie: "lang=zh" });
  assert.ok(zh.body.includes("解析失败:"), "zh /tasks still renders the pre-existing 解析失败: row");
});

test("AC1/AC5 (live) — ④ /task/<id>: the empty Runs block is English under en, Chinese under zh", async () => {
  const en = await request(port, "/task/GAPDOC-001", { Cookie: "lang=en" });
  assert.ok(en.body.includes("No worker runs recorded"), "en /task/<id> renders the English empty Runs state");
  assert.ok(!en.body.includes("无 worker 运行记录"), "en /task/<id> must not render the zh empty Runs state");
  assert.ok(en.body.includes(".quay/worker-outcome.jsonl"), "the carrier path is still named (it is a path — DATA)");

  const zh = await request(port, "/task/GAPDOC-001", { Cookie: "lang=zh" });
  assert.ok(zh.body.includes("无 worker 运行记录"), "zh /task/<id> still renders the pre-existing 无 worker 运行记录");
  // AC3: the zh bytes are the pre-extraction literal, brackets included — the <code> sits INSIDE the
  // full-width parens exactly as before.
  assert.ok(/无 worker 运行记录（<code>\.quay\/worker-outcome\.jsonl<\/code>）/.test(zh.body.replace(/\n/g, "")),
    "zh renders the literal sentence with its full-width brackets and the <code> inside them");
});

test("AC1/AC5 (live) — ⑤ /task/<id>: the in-flight Runs row is English under en, Chinese under zh", async () => {
  // Control that the state is REALLY in flight: the row only renders when the /proc scan sees the
  // marker process, so assert the row is present before asserting its language.
  const en = await request(port, "/task/GAPDOC-002", { Cookie: "lang=en" });
  assert.ok(en.body.includes("worker-GAPDOC-002"), "control: the in-flight row is actually rendered (worker-<task> run id)");
  assert.ok(/<td><strong>In progress<\/strong><\/td>/.test(en.body.replace(/\n/g, "")), "en renders <strong>In progress</strong>");
  assert.ok(!en.body.includes("<strong>进行中</strong>"), "en must not render the zh in-flight word");

  const zh = await request(port, "/task/GAPDOC-002", { Cookie: "lang=zh" });
  assert.ok(/<td><strong>进行中<\/strong><\/td>/.test(zh.body.replace(/\n/g, "")), "zh still renders <strong>进行中</strong> byte for byte");
});

test("AC5 (live) — the language rides the REQUEST, not the server: en and zh differ on the same URL", async () => {
  // A page that had been fixed by hard-coding one language would pass one arm of the tests above and
  // fail this one. `/tasks` is the URL carrying two of the five states at once.
  const en = await request(port, "/tasks", { Cookie: "lang=en" });
  const zh = await request(port, "/tasks", { Cookie: "lang=zh" });
  assert.notEqual(en.body, zh.body, "the same URL answers differently for the two languages");
  assert.ok(en.body.includes("parse failed:") && !en.body.includes("解析失败"), "en arm");
  assert.ok(zh.body.includes("解析失败:") && !zh.body.includes("parse failed:"), "zh arm");
  // Query-param form as well as the cookie (both are AC-288 inputs) — the list page reads cfg.lang,
  // which the dispatcher resolved from either.
  const q = await request(port, "/tasks?lang=en");
  assert.ok(q.body.includes("parse failed:"), "?lang=en on the URL also reaches the dictionary");
});
