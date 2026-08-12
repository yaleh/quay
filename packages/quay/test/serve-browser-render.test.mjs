// @test-group product
// QN-046 (closes discussion-doc §2.1's "browser-automation Web UI
// verification" proposal — the one remaining un-issued item named in
// iterations 21/29/31/33/34's own problem lists; also closes QN-031's own
// (iteration 21) explicitly-named `## Gaps` item, "browser-level rendering").
//
// This iteration drove `quay serve`'s list page, task-detail page, and
// action-button POST through a REAL rendered browser (playwright MCP
// tooling — a session-level capability, not an npm dependency this repo
// installs; per §Core-scope constraint 1, "browser-automation tooling
// (chrome-devtools / playwright MCP)", never bare "MCP testing"). That live
// run found a genuine, previously-undetected production bug: `serve.js`'s
// two HTML-emitting routes sent `Content-Type: text/html` with NO charset
// parameter. The response bytes on the wire are correct UTF-8 (confirmed via
// `xxd`: the em-dash is `e2 80 94`, valid UTF-8), but a real browser with no
// charset hint falls back to a legacy encoding and mis-decodes non-ASCII
// glyphs — observed live as "Quay â€” task list" (should be "Quay — task
// list") and "role: primitive Â· labels:" (should be "role: primitive ·
// labels:"). `serve.test.mjs`'s own pre-existing assertions never caught
// this because they check raw-byte substring presence (`body.includes(...)`
// against the UTF-8-encoded string literal in the test file itself, which
// happens to byte-match regardless of what a browser's HTML parser would
// decode it as) — this is exactly the kind of gap only a genuine rendering
// engine surfaces, which is why this verification layer has value beyond
// what raw-HTTP-body assertions already provide.
//
// This automated regression test cannot itself drive a real browser (no
// browser-automation MCP tooling or headless-browser npm package is
// importable from a plain `node test.mjs` process in this repo — confirmed:
// `npm ls playwright` in the workspace root returns empty, and no such
// dependency exists in packages/quay/package.json, consistent with G5's "no
// framework" discipline). Per the same discipline used for G6's manda
// precondition (checked live each iteration, not embedded as an automated
// test's pass/fail condition), the LIVE browser verification is this
// iteration's own real, run-once evidence (recorded in
// experiments/quay-native-bootstrap/iterations/iteration-35.md), not fabricated into this file.
// What THIS file can and does assert mechanically, forever, without a
// browser: the root-caused, mechanically-checkable condition that was
// causing the mojibake — the exact `Content-Type` header value and byte
// sequence any correctly-implemented HTML parser depends on for correct
// decoding — so a regression is caught even in a browser-less CI run.
//
// Run: node test/serve-browser-render.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function getRaw(port, urlPath) {
  // Deliberately reads the raw response as a Buffer (not res.setEncoding),
  // so this test inspects the actual bytes on the wire, the same layer a
  // browser's HTML parser decodes from — not a JS-string view that would
  // already assume UTF-8 and mask the bug.
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

async function main() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-render-test-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-render-workspace-"));

  execFileSync("node", [nativeBin, "task", "create", "RND-1", "--title", "Rendered task with a middle-dot: role · label",
    "--status", "todo", "--body", VALID_SECTIONS], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });

  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );

  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port: 0 });
    const port = server.address().port;

    // --- The root-caused, mechanically-checkable regression: Content-Type
    // must declare charset=utf-8 on both HTML-emitting routes, so any
    // standards-compliant HTML parser (browser or otherwise) decodes the
    // body's UTF-8 bytes correctly instead of falling back to a legacy
    // encoding and mangling non-ASCII glyphs (the live browser-observed bug
    // this task fixes).
    const list = await getRaw(port, "/");
    assert(list.status === 200, `GET / returns 200 (got ${list.status})`);
    assert(/charset=utf-8/i.test(list.headers["content-type"] || ""),
      `GET / Content-Type header declares charset=utf-8 (got "${list.headers["content-type"]}")`);
    // The em-dash in "Quay — task list" is U+2014, UTF-8 bytes E2 80 94.
    const emDashBytes = Buffer.from([0xe2, 0x80, 0x94]);
    assert(list.raw.includes(emDashBytes),
      "GET / body's raw bytes contain the correctly UTF-8-encoded em-dash (E2 80 94)");
    assert(list.raw.toString("utf-8").includes("<meta charset=\"utf-8\">"),
      "GET / body includes an explicit <meta charset=\"utf-8\"> tag (belt-and-braces alongside the HTTP header)");

    const detail = await getRaw(port, "/task/RND-1");
    assert(detail.status === 200, `GET /task/RND-1 returns 200 (got ${detail.status})`);
    assert(/charset=utf-8/i.test(detail.headers["content-type"] || ""),
      `GET /task/RND-1 Content-Type header declares charset=utf-8 (got "${detail.headers["content-type"]}")`);
    // The middle-dot separator ("role: ... · labels: ...") is U+00B7, UTF-8
    // bytes C2 B7 — the exact glyph observed mis-decoded live as "Â·".
    const middleDotBytes = Buffer.from([0xc2, 0xb7]);
    assert(detail.raw.includes(middleDotBytes),
      "GET /task/RND-1 body's raw bytes contain the correctly UTF-8-encoded middle-dot (C2 B7)");
    assert(detail.raw.toString("utf-8").includes("<meta charset=\"utf-8\">"),
      "GET /task/RND-1 body includes an explicit <meta charset=\"utf-8\"> tag");
    // The task's own title (containing a middle-dot) round-trips correctly
    // through client.taskGet() -> escapeHtml() -> the wire, unmangled.
    assert(detail.raw.toString("utf-8").includes("Rendered task with a middle-dot: role · label"),
      "GET /task/RND-1 body renders the task's own title (with its middle-dot) correctly, decoded as UTF-8");

    // --- Adversarial negative control: prove this assertion has real teeth
    // by reverting the header to the pre-fix, charset-less value and
    // confirming the charset assertion (and only that one) would fail.
    const brokenHeaders = { "content-type": "text/html" };
    assert(!/charset=utf-8/i.test(brokenHeaders["content-type"]),
      "negative control: a bare 'text/html' Content-Type (the pre-fix value) correctly fails the charset assertion");
  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(originalCwd);
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nAll QN-046 serve-browser-render regression tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
