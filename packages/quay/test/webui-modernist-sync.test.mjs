// @test-group product
// AC100 — the three existing detail pages (/adr/:id /goal/:id /doc/:id) must share
// the SAME style source as the 15 design views: the Modernist token sheet
// (docs/design/.../_ds/modernist-*/styles.css). The server ships a canonical product
// copy (packages/quay/src/webui-modernist.css) and inlines it, so the rendering code
// carries ZERO hardcoded hex. This file is the mechanical evidence for AC100 ①:
//   (a) the product copy is byte-identical to the design source ("same style source");
//   (b) the rendered detail pages use var(--*) tokens and no legacy hex accents;
//   (c) the three detail-handler code segments contain no hardcoded hex
//       (the exact grep the judge specifies, over the exact code segments).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

// ── (a) same-style-source: product copy byte-identical to the design source ──
test("AC100(a) — webui-modernist.css is byte-identical to the design's modernist styles.css", () => {
  const product = fs.readFileSync(path.join(__dirname, "..", "src", "webui-modernist.css"), "utf8");
  const dsDir = path.join(__dirname, "..", "..", "..", "docs", "design",
    "quay-webui-improved-2026-08-16", "_ds");
  const hits = fs.readdirSync(dsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("modernist-"));
  assert.ok(hits.length >= 1, `expected a modernist-* dir under ${dsDir}`);
  const design = fs.readFileSync(path.join(dsDir, hits[0].name, "styles.css"), "utf8");
  assert.equal(product, design, "product stylesheet must be byte-identical to the design source");
  // The token family AC100 names must actually be present in the shipped sheet.
  for (const token of ["--color-bg", "--font-heading", "--space-1", "--radius-md"]) {
    assert.ok(product.includes(token), `token ${token} must be defined in the shipped stylesheet`);
  }
});

// ── render checks against a real server ──────────────────────────────────────
let server, port, originalCwd, workspaceRoot;

before(async () => {
  const tasksDir = makeTmpDir("ac100-serve-tasks-");
  const adrDir = makeTmpDir("ac100-serve-adr-");
  workspaceRoot = makeTmpDir("ac100-serve-ws-");
  fs.writeFileSync(path.join(adrDir, "ADR-100-modernist.md"),
    "---\nid: ADR-100\ntitle: Modernist tokens\ndate: 2026-08-16\nstatus: accepted\nsupersedes: [ADR-099]\n---\n## Context\nlegacy hex everywhere\n## Decision\nuse var(--color-*) tokens\n");
  fs.writeFileSync(path.join(adrDir, "ADR-099-old.md"),
    "---\nid: ADR-099\ntitle: Old\nstatus: superseded\n---\n## Context\nold\n## Decision\nold\n");
  fs.mkdirSync(path.join(workspaceRoot, "goals"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "docs-managed"), { recursive: true });
  const goalsDir = path.join(workspaceRoot, "goals");
  fs.writeFileSync(path.join(goalsDir, "AC-100-criterion.md"),
    "---\nid: AC-100\ntitle: consistency\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: grep -cE '#[0-9a-fA-F]{6}'\nexpect: \"=0\"\norigin: 2026-08-16 measured criterion\nevidence:\n  at: 2026-08-16T00:00:00Z\n  verdict: pass\n  reading: \"0\"\n---\n## Rationale\nmeasured\n");
  fs.writeFileSync(path.join(workspaceRoot, "docs-managed", "DOC-100-modernist.md"),
    "---\nid: DOC-100\ntitle: modernist doc\nstatus: active\nkind: skill\n---\n## Body\nthe modernist doc body\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

test("AC100(b) — /adr/:id renders with Modernist tokens, no legacy hex accent", async () => {
  const r = await get(port, "/adr/ADR-100");
  assert.equal(r.status, 200);
  assert.match(r.body, /var\(--color-/);           // tokenized styling
  assert.match(r.body, /--color-bg/);               // token source present (modernist sheet inlined)
  assert.ok(!r.body.includes("#0066cc"), "legacy hardcoded accent must not appear");
  assert.match(r.body, /supersedes/);               // supersedes render still present
  assert.match(r.body, /ADR-099/);
});

test("AC100(b) — /goal/:id renders with Modernist tokens and a token verdict class", async () => {
  const r = await get(port, "/goal/AC-100");
  assert.equal(r.status, 200);
  assert.match(r.body, /var\(--color-/);
  assert.match(r.body, /--color-bg/);
  assert.ok(!r.body.includes('style="color:#1a7f37"'), "inline verdict hex must be gone");
  assert.match(r.body, /verdict-pass/);             // token-defined verdict class
  assert.match(r.body, /git rev-list|grep -cE/);
});

test("AC100(b) — /doc/:id renders with Modernist tokens", async () => {
  const r = await get(port, "/doc/DOC-100");
  assert.equal(r.status, 200);
  assert.match(r.body, /var\(--color-/);
  assert.match(r.body, /--color-bg/);
  assert.ok(!r.body.includes("#0066cc"));
  assert.match(r.body, /the modernist doc body/);
});

test("AC100(b) — legacy /adr and /goal LIST pages still render (no regression)", async () => {
  const adr = await get(port, "/adr");
  assert.equal(adr.status, 200);
  assert.match(adr.body, /ADR-100/);
  const goal = await get(port, "/goal");
  assert.equal(goal.status, 200);
  assert.match(goal.body, /AC-100/);
  assert.match(goal.body, /verdict-pass/);          // goalEvidenceCell shared with list page
});

// ── (c) static source check: the judge's grep over the detail-page render path ──
// The three handlers plus every helper they call (goalEvidenceCell, modernistStyles,
// detailStyles, renderMarkdown) must carry zero hardcoded hex — the hex lives only in
// the webui-modernist.css asset (which the byte-identity test (a) pins to the design).
test("AC100(c) — the three detail-page rendering code segments contain zero hardcoded hex", () => {
  // gap-serve-handlers-split-by-concern: the detail-page handlers + their render helpers moved out
  // of serve-handlers.ts into per-concern files. The AC100(c) invariant (zero hex in the detail-page
  // render path) is unchanged; only each function's home file moved.
  const fnFiles = {
    handleAdrDetail: "serve-adr.ts",
    handleGoalDetail: "serve-goal.ts",
    goalEvidenceCell: "serve-goal.ts",
    handleDocDetail: "serve-doc.ts",
    modernistStyles: "serve-render.ts",
    detailStyles: "serve-render.ts",
    renderMarkdown: "serve-render.ts",
  };
  for (const [fn, file] of Object.entries(fnFiles)) {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
    const lines = src.split("\n");
    const start = lines.findIndex((l) => l.includes(`function ${fn}`));
    assert.ok(start >= 0, `${fn} not found in ${file}`);
    let end = lines.length;
    for (let j = start + 1; j < lines.length; j++) {
      if (/^(export (async )?function |function )/.test(lines[j])) { end = j; break; }
    }
    const span = lines.slice(start, end).join("\n");
    const hex = span.match(/#[0-9a-fA-F]{6}/g) || [];
    assert.deepEqual(hex, [], `${fn} must have zero hardcoded hex (got ${hex.length}: ${hex.join(", ")})`);
  }
});
