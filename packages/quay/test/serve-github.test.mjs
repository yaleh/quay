// @test-group product
// QN-061 (iteration 57): live cross-Provider (GitHub) regression test for
// the Web UI (`quay serve`, src/serve.js) — the third of the proposal's
// three sibling ABI bindings (quay-proposal.md §9: CLI, Core MCP, Web UI;
// see also core-three-way-symmetry.test.mjs's own header). Iterations
// 54/55 closed the CLI-layer (bin/quay.js) cross-Provider test-coverage
// gap; iteration 56 closed the analogous MCP-layer
// (packages/quay/src/mcp-server.js) gap. This closes the same shape of
// gap at the Web-UI layer: serve.test.mjs and
// core-three-way-symmetry.test.mjs both exclusively exercise startServer()
// against isolated, local native task stores — neither, nor any other test
// file in this repo, had ever spun it up against the live GitHub Provider.
// serve.js itself has never branched on provider id (see its own file
// header) so this was always expected to work, but was never proven live,
// end-to-end, against a real GitHub-backed task before this test existed.
//
// Read packages/quay/src/serve.js and provider-client.js in full before
// writing this test: the Web UI's GET routes (`/tasks` list, `/task/:id`
// detail) call only read-only Provider functions (client.taskList(),
// client.taskGet(), client.manifest()) — no write path. The POST
// `/task/:id/action/:actionId` route only composes+delivers a trigger
// (composePayload()/deliverTrigger()) — it does not itself write to the
// Provider — but deliverTrigger is a real, non-idempotent delivery side
// effect, so (matching write.test.mjs's own precedent and iteration
// 55/56's identical `task edit --provider github` / `action_run` exclusion
// reasoning) it remains excluded from automated live-issue testing here.
//
// This test targets the real, live yaleh/quay repository's issue #3
// (task id "gh-3" under the GitHub Provider's id convention) — the same
// fixture iterations 55/56 already used. Its real live label state
// (status:ready, all AC/DoD boxes unchecked) was confirmed unchanged
// immediately before and after this test file was authored, via
// `gh issue view 3 --repo yaleh/quay --json number,state,labels,body`.
// If issue #3's status label or AC-checkbox state changes in the future,
// the assertions below (particularly the `ready`-status/Advance-button
// assertion) would need revisiting — the same caveat iterations 55/56
// each named for their own gh-3-dependent assertions.
//
// Run: node test/serve-github.test.mjs
//
// ADR-019 (M173/DIR-109): in-file skip declaration. This file hits the real
// live yaleh/quay GitHub repo (gh-3) — unsafe-by-default for an offline /
// credential-less run. Classification lives HERE, not in an external
// grep/glob exclusion list (scripts/test.sh's default glob always includes
// this file; this in-file guard is what keeps it safe). Opt in with
// QUAY_TEST_LIVE_GITHUB=1 (requires GH_TOKEN / `gh auth login` with read
// access to yaleh/quay).

import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const LIVE_GITHUB_ENV = "QUAY_TEST_LIVE_GITHUB";
const liveGithubEnabled = process.env[LIVE_GITHUB_ENV] === "1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const githubBin = path.join(repoRoot, "packages", "quay-github", "bin", "quay-github.ts");
const githubProviderDir = path.dirname(githubBin);

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

async function main() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-serve-github-test-"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });

  // Both Providers declared (matching this repo's real .quay/config.yml
  // convention), but only github is enabled for this test — serve.js's
  // own startServer() connects to whichever Provider activeProvider()
  // resolves as enabled (config.js), same pattern as mcp-server.test.mjs's
  // own github-enabled fixture block.
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n` +
      `  native:\n` +
      `    enabled: false\n` +
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n` +
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n` +
      `  github:\n` +
      `    enabled: true\n` +
      `    path: "${githubProviderDir.replaceAll("\\", "\\\\")}"\n` +
      `    mcp_entry: ["node", "${githubBin.replaceAll("\\", "\\\\")}", "mcp"]\n` +
      `    env:\n` +
      `      QUAY_GITHUB_REPO: "yaleh/quay"\n`
  );

  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port: 0 });
    const port = server.address().port;

    // --- GET /tasks (list) — real GitHub-backed task gh-3 must appear ---
    const list = await get(port, "/tasks");
    assert(list.status === 200, `GET /tasks returns 200 (got ${list.status})`);
    assert(list.body.includes("gh-3"), "GET /tasks body contains the real GitHub-backed task id gh-3");
    assert(
      list.body.includes("Fix MCP task_write silently dropping the extra field"),
      "GET /tasks body contains gh-3's real live title"
    );

    // --- GET /task/gh-3 (detail) — real live status ---
    // NOTE (2026-08-06): the "Advance action button" assertion was removed —
    // the web action-buttons POST route and its form renders were deleted by
    // gap-web-action-buttons-unused-route-and-open-redirect-delete, so the
    // detail page no longer renders an action button.
    const detail = await get(port, "/task/gh-3");
    assert(detail.status === 200, `GET /task/gh-3 returns 200 (got ${detail.status})`);
    assert(
      detail.body.includes("Fix MCP task_write silently dropping the extra field"),
      "GET /task/gh-3 body contains gh-3's real live title"
    );
    assert(
      /\[ready\]/.test(detail.body),
      "GET /task/gh-3 body reflects gh-3's real live derived status (ready, from its status:ready label)"
    );
  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(originalCwd);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  // NOTE: POST /task/gh-3/action/advance is deliberately NOT tested here.
  // composePayload()+deliverTrigger() is a real, non-idempotent delivery
  // side effect (matching write.test.mjs's own precedent and iterations
  // 55/56's identical `task edit --provider github` / `action_run`
  // exclusion) — this repo's real issue #3 is too small/precious a
  // fixture to safely target with a live trigger-delivery call in an
  // automated, repeatable test file.

  console.log(
    failures === 0
      ? "\nAll QN-061 live cross-Provider (GitHub) Web UI regression tests passed."
      : `\n${failures} test(s) FAILED`
  );
  if (failures > 0) {
    throw new Error(`${failures} QN-061 live cross-Provider (GitHub) test(s) FAILED`);
  }
}

test(
  "QN-061 live cross-Provider (GitHub) Web UI regression (serve.js against real yaleh/quay issue gh-3)",
  {
    skip:
      !liveGithubEnabled &&
      `live-GitHub test skipped by default — opt in with ${LIVE_GITHUB_ENV}=1 (requires GH_TOKEN / gh auth with read access to yaleh/quay)`,
  },
  main
);
