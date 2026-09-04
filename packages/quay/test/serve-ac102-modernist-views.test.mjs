// @test-group product
// AC102 — the 15 design views must ACTUALLY apply the design's visual spec, not just exist as
// routes. The two mechanical criteria (the exact greps the AC102 judge specifies):
//   ① every one of the 15 routes' response HTML contains the Modernist token stylesheet's
//     recognisable characteristic (`--color-bg`) — i.e. the SAME token sheet the 3 detail pages
//     use (modernistStyles()), not a separate colour scheme;
//   ② the rendering code carries ZERO hardcoded 6-digit hex — colours come only from tokens
//     (the hex values live only in the webui-modernist.css asset, pinned byte-identical to the
//     design source by webui-modernist-sync.test.mjs AC100(a)).
// The pageStyles() base sheet and every inline style are migrated to var(--color-*), so the
// whole serve-handlers.ts is hex-free (the strongest form of criterion ② — even beyond the
// "excluding shared head/nav" carve-out).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
// gap-serve-handlers-split-by-concern: the rendering code (pageStyles + verdict classes) moved to
// serve-render.ts; the AC102② zero-hex + token-derived invariant now pins that file.
const SERVE_RENDER = path.join(__dirname, "..", "src", "serve-render.ts");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

let server, port, originalCwd, workspaceRoot;

before(async () => {
  const tasksDir = makeTmpDir("ac102-serve-tasks-");
  workspaceRoot = makeTmpDir("ac102-serve-ws-");
  fs.writeFileSync(path.join(tasksDir, "AC102-001.md"),
    "---\nid: AC102-001\ntitle: token detail\ntodo: false\nstatus: todo\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [x] d\n");
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  // git-init + a commit so /git-history renders a real SVG (the AC102② token-class check needs it).
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac102 fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });
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

// The 15 design views (AC95's list — 8 exact routes + 6 new + task detail).
const FIFTEEN_VIEWS = [
  ["/dashboard", "Dashboard"],
  ["/tasks", "task list"],
  ["/live", "Live"],
  ["/board", "Board"],
  ["/system", "System"],
  ["/manager", "Manager"],
  ["/journal", "Journal"],
  ["/git-history", "Git History"],
  ["/tests", "Tests"],
  ["/sessions", "Sessions"],
  ["/adr", "ADRs"],
  ["/goal", "Goals"],
  ["/doc", "Docs"],
  ["/architecture", "Architecture"],
  ["/task/AC102-001", "task detail"],
];

test("AC102① — all 15 views' response HTML contains the Modernist token characteristic (--color-bg)", async () => {
  for (const [route, label] of FIFTEEN_VIEWS) {
    const r = await get(port, route);
    assert.equal(r.status, 200, `AC102①: GET ${route} returns 200 (${label}, got ${r.status})`);
    assert.ok(
      r.body.includes("--color-bg"),
      `AC102①: GET ${route} (${label}) inlines the Modernist token sheet (--color-bg present)`
    );
    assert.ok(r.body.includes("var(--color-"), `AC102①: ${route} body uses var(--color-*) tokens`);
  }
});

test("AC102② — serve-render.ts rendering code carries zero hardcoded 6-digit hex", () => {
  const src = fs.readFileSync(SERVE_RENDER, "utf8");
  const hex = src.match(/#[0-9a-fA-F]{6}/g) || [];
  assert.deepEqual(hex, [], `AC102②: zero hardcoded hex in serve-render.ts (got ${hex.length}: ${hex.join(", ")})`);
  // The pageStyles base sheet is token-derived too (colours via var(--color-*), not legacy hex).
  assert.ok(src.includes("color: var(--color-accent-700)"), "shared base verdict class is token-derived");
});

test("AC102② — the git-history client renderer is token-classed, not hardcoded hex", async () => {
  const r = await get(port, "/git-history");
  assert.equal(r.status, 200);
  // The chart is now client-rendered (third-party D3); its marks still use the token-derived
  // git-svg-* classes. The inlined CSS token sheet legitimately carries hex (it is the single
  // source), so this check scopes to the client RENDERER script, which must carry none.
  const marker = 'attr("class", "git-svg-commit")';
  const i = r.body.indexOf(marker);
  assert.ok(i >= 0, "the client renderer marks commits with the token class");
  assert.ok(r.body.includes('attr("class", "git-svg-merge")'), "the client renderer marks merges with the token class");
  const scriptStart = r.body.lastIndexOf("<script>", i);
  const scriptEnd = r.body.indexOf("</script>", i);
  const renderer = r.body.slice(scriptStart, scriptEnd);
  const hex = renderer.match(/#[0-9a-fA-F]{6}/g) || [];
  assert.deepEqual(hex, [], "the client renderer script carries no hardcoded hex");
});
