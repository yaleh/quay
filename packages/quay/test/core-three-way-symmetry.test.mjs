// @test-group product
// QN-044 (DIR-010): Core-level three-way symmetry test — CLI vs. Core MCP
// vs. Web UI, scoped EXACTLY to the capability set quay-proposal.md §9
// itself lists as shared across the three sibling bindings ("The Web UI is
// the same capability set with a web binding" — §9, line 235): task-list
// rendering, task-detail rendering, and action-button triggering (`action
// list`/`action run` in CLI terms). See §9's own command block (lines
// 42-48) for the literal capability list this test is scoped to.
//
// NOTE (2026-08-06): the web action-buttons POST route and its form renders
// were REMOVED (gap-web-action-buttons-unused-route-and-open-redirect-delete).
// Action-button triggering is now a TWO-way symmetry (CLI + Core MCP) — the
// Web UI leg of that capability (the detail-page form + the POST route) was
// deleted with the route, so this file's action-leg assertions cover only
// the CLI and Core MCP bindings (2 mock-delivery records, not 3). Task-list
// and task-detail rendering remain three-way (the Web UI still renders both).
//
// This is a DIFFERENT symmetry claim from `packages/quay-native/test/
// abi-symmetry.mjs` (P3, quay-native-design.md §6): that file proves
// Provider-level CLI/MCP schema symmetry (quay-native's own CLI vs. its own
// MCP tools). THIS file proves Core-level three-way symmetry (Core CLI vs.
// Core's own MCP server vs. Core's Web UI) — a claim P3 never made and
// abi-symmetry.mjs never tested (quay-native-design.md P2: "Web is a Core
// concern," i.e. out of quay-native's own remit). Per DIR-010's own explicit
// instruction, this file does NOT touch abi-symmetry.mjs or any
// Provider-level file — additive, Core-layer-only.
//
// Explicitly OUT OF SCOPE for this test (per DIR-010's Finding and Requested
// action §2, quoting quay-proposal.md §9 directly): `task edit` and `task
// check` are NOT part of §9's listed capability set (they were added to the
// Core CLI later, QN-024/QN-027, after §9's own example block was written,
// and were never proposed for the Web UI). Their absence from the Web UI's
// own three behaviors (list/detail/action-POST — see src/serve.js's own
// header comment) is correctly NOT a gap this test reports.
//
// Method: rather than driving a real browser (out of scope per DIR-010's own
// dependency-ordering note — browser-automation Web UI verification is a
// SEPARATE, not-yet-issued proposal, quay-core-scope-expansion-discussion.md
// §2.1), this test calls serve.js's own exported startServer() and issues
// real HTTP requests against it (the same harness serve.test.mjs already
// established), and compares the HTML response's *content* against what the
// CLI (spawned as a real subprocess) and Core MCP (a real quay mcp
// subprocess, a real MCP client) return for the identical task fixture. This
// is a Core-internal equivalence check: same underlying data, three
// bindings, one assertion each that the rendered/returned content agrees.
//
// Run: node test/core-three-way-symmetry.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startServer } from "../src/serve.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = QUAY_CLI;
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

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

async function connectStdio(command, args, cwd) {
  const transport = new StdioClientTransport({ command, args, cwd, env: process.env });
  const client = new Client({ name: "test-agent", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

async function main() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-3way-tasks-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-3way-workspace-"));
  const mockLogPath = path.join(workspaceRoot, "mock-delivery.jsonl");

  execFileSync(
    "node",
    [nativeBin, "task", "create", "SYM-1", "--title", "Three-way symmetry fixture", "--status", "todo", "--body", VALID_SECTIONS],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir } }
  );

  // NOTE (verified by direct execution while writing this test, not assumed
  // from reading other test files alone): serve.js's own startServer() reads
  // the tasks dir from provider.tasks_dir directly, but bin/quay.js's CLI
  // dispatch and mcp-server.js both resolve the child MCP process's env via
  // resolveProviderEnv(cfg, provider), which only reads provider.env's map --
  // NOT the top-level tasks_dir field. Both config.yml conventions must be
  // present for all three legs (CLI, Core MCP, Web UI) to serve the SAME
  // isolated tasksDir, since each leg's own code path resolves it
  // differently. This is an honestly-discovered, pre-existing (not
  // DIR-010-introduced) asymmetry in how the three bindings' own launcher
  // code reads workspace config -- distinct from the capability-set symmetry
  // this test itself asserts on, and worth naming for a future iteration's
  // own DESIGN.md gap list (see "Problems identified for next iteration").
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir}"`,
      `    tasks_dir: "${tasksDir}"`,
      `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir}"`,
      "",
    ].join("\n")
  );

  let webServer;
  let mcpClient;
  try {
    // ============================================================
    // Capability 1: task-list rendering
    // ============================================================

    // -- CLI leg --
    const cliListOut = execFileSync("node", [coreBin, "task", "list", "--json"], { cwd: workspaceRoot }).toString();
    const cliList = JSON.parse(cliListOut);
    assert(Array.isArray(cliList) && cliList.some((t) => t.id === "SYM-1"), "CLI leg: `quay task list --json` includes the fixture task SYM-1");

    // -- Core MCP leg --
    mcpClient = await connectStdio("node", [coreBin, "mcp"], workspaceRoot);
    const mcpList = await mcpClient.callTool({ name: "task_list", arguments: {} });
    const mcpListIds = mcpList.structuredContent.tasks.map((t) => t.id);
    assert(mcpListIds.includes("SYM-1"), "Core MCP leg: task_list tool includes the fixture task SYM-1");

    // -- Web UI leg --
    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    webServer = await startServer({ port: 0 });
    const port = webServer.address().port;
    process.chdir(originalCwd);

    const listPage = await get(port, "/");
    assert(listPage.status === 200, `Web UI leg: GET / returns 200 (got ${listPage.status})`);
    assert(listPage.body.includes("SYM-1"), "Web UI leg: task-list page renders the fixture task's id");
    assert(listPage.body.includes("Three-way symmetry fixture"), "Web UI leg: task-list page renders the fixture task's title");
    assert(listPage.body.includes("todo"), "Web UI leg: task-list page renders the fixture task's status");

    // Cross-leg agreement: the SAME underlying task (id, title, status) is
    // present in all three surfaces' own rendering of "the task list."
    const cliRow = cliList.find((t) => t.id === "SYM-1");
    const mcpRow = mcpList.structuredContent.tasks.find((t) => t.id === "SYM-1");
    assert(
      cliRow.title === mcpRow.title && cliRow.status === mcpRow.status,
      "task-list rendering: CLI and Core MCP agree on SYM-1's title/status"
    );
    assert(
      listPage.body.includes(cliRow.title) && listPage.body.includes(cliRow.status),
      "task-list rendering: Web UI's rendered content agrees with the CLI/MCP legs' own title/status for SYM-1"
    );

    // ============================================================
    // Capability 2: task-detail rendering
    // ============================================================

    // -- CLI leg --
    const cliViewOut = execFileSync("node", [coreBin, "task", "view", "SYM-1", "--json"], { cwd: workspaceRoot }).toString();
    const cliDetail = JSON.parse(cliViewOut);
    assert(cliDetail.id === "SYM-1" && cliDetail.title === "Three-way symmetry fixture", "CLI leg: `quay task view SYM-1 --json` returns the fixture task's id/title");

    // -- Core MCP leg --
    const mcpGet = await mcpClient.callTool({ name: "task_get", arguments: { id: "SYM-1" } });
    assert(
      mcpGet.structuredContent.task.id === "SYM-1" && mcpGet.structuredContent.task.title === cliDetail.title,
      "Core MCP leg: task_get tool agrees with the CLI leg on SYM-1's id/title"
    );

    // -- Web UI leg --
    const detailPage = await get(port, "/task/SYM-1");
    assert(detailPage.status === 200, `Web UI leg: GET /task/SYM-1 returns 200 (got ${detailPage.status})`);
    assert(detailPage.body.includes(cliDetail.title), "Web UI leg: task-detail page renders the same title the CLI/MCP legs return");
    assert(detailPage.body.includes(cliDetail.status), "Web UI leg: task-detail page renders the same status the CLI/MCP legs return");
    // QW-002 (experiment 3, iteration 1): the Web UI now renders the task body
    // via renderMarkdown() instead of a bare <pre> block. The raw markdown
    // text ("## Proposal") no longer appears literally in the HTML — it is
    // rendered as <h3>Proposal</h3>. The assertion is updated to check for the
    // rendered heading text (stripping the markdown prefix), which confirms the
    // body content IS present and rendered, just not as raw syntax.
    // The first line of VALID_SECTIONS is "## Proposal"; rendered: "Proposal"
    // appears in an <h3> tag. Extract the text content of the first heading.
    const firstBodyLine = cliDetail.body.trim().split("\n")[0];
    const firstBodyText = firstBodyLine.replace(/^#+\s*/, "").replace(/^[-*+]\s*/, "");
    assert(
      detailPage.body.includes(firstBodyText),
      `Web UI leg: task-detail page renders (a line of) the same body content the CLI/MCP legs return (rendered: "${firstBodyText}")`
    );

    // Explicitly out of scope, per DIR-010's own Finding (quay-proposal.md
    // §9 never listed `task edit`/`task check` as part of the shared
    // capability set) -- NOT asserted as a Web UI gap:
    // the Web UI has no edit form or gate-check page, and that is correct,
    // not a symmetry failure. This comment documents the exclusion; no
    // assertion is made about their absence, per the directive's own
    // instruction not to report it as a gap.

    // ============================================================
    // Capability 3: action-button triggering
    // ============================================================

    // -- CLI leg: action list --
    const cliActionListOut = execFileSync("node", [coreBin, "action", "list", "SYM-1", "--json"], { cwd: workspaceRoot }).toString();
    const cliButtons = JSON.parse(cliActionListOut);
    assert(
      Array.isArray(cliButtons) && cliButtons.length === 1 && cliButtons[0].id === "advance",
      `CLI leg: 'quay action list SYM-1 --json' returns the one applicable 'advance' button (got ${cliActionListOut})`
    );

    // -- Core MCP leg: action_list --
    const mcpActionList = await mcpClient.callTool({ name: "action_list", arguments: { id: "SYM-1" } });
    assert(
      mcpActionList.structuredContent.buttons.length === 1 && mcpActionList.structuredContent.buttons[0].id === "advance",
      "Core MCP leg: action_list tool returns the same one applicable 'advance' button as the CLI leg"
    );

    // -- CLI leg: action run (mock delivery mode, DIR-009, so this
    //    assertion never depends on live manda) --
    const cliRunEnv = { ...process.env, QUAY_ACTION_MOCK_LOG: mockLogPath };
    const cliRunOut = execFileSync("node", [coreBin, "action", "run", "SYM-1", "advance"], { cwd: workspaceRoot, env: cliRunEnv }).toString();
    // `quay action run`'s own printJson() pretty-prints (JSON.stringify(obj,
    // null, 2)), and two human-readable console.log lines precede it -- so
    // the JSON is a *multi-line* block, not a single trailing line. Extract
    // from the first "{" onward rather than just popping the last line.
    const cliRunJsonStart = cliRunOut.indexOf("{");
    const cliRunResult = JSON.parse(cliRunOut.slice(cliRunJsonStart));
    assert(cliRunResult.delivered === "mock", `CLI leg: 'quay action run SYM-1 advance' with QUAY_ACTION_MOCK_LOG delivers via mock mode (got ${cliRunResult.delivered})`);

    // -- Core MCP leg: action_run, same task, same mock log (explicit
    //    mockLogPath tool argument rather than env var) --
    const mcpRun = await mcpClient.callTool({ name: "action_run", arguments: { id: "SYM-1", actionId: "advance", mockLogPath } });
    assert(mcpRun.structuredContent.delivered === "mock", `Core MCP leg: action_run tool with mockLogPath delivers via mock mode (got ${mcpRun.structuredContent?.delivered})`);
    assert(
      mcpRun.structuredContent.payload === cliRunResult.payload,
      "action-button triggering: CLI and Core MCP legs compose the byte-identical payload for the same task/action"
    );

    // Cross-leg agreement on the delivery-mode-tagged result: both surviving
    // legs (CLI + Core MCP) produced a "mock"-delivered record for the same
    // task/action, on the same underlying mock log — the "action-button
    // triggering" capability agrees across both bindings, per DIR-010's own
    // item 2 wording ("same delivery-mode-tagged result on trigger").
    // NOTE (2026-08-06): the Web UI leg of this symmetry was REMOVED with the
    // web action-buttons route
    // (gap-web-action-buttons-unused-route-and-open-redirect-delete), so the
    // expected record count is now 2, not 3.
    const allRecords = fs
      .readFileSync(mockLogPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert(
      allRecords.every((r) => r.taskId === "SYM-1" && r.channel === "task-SYM-1"),
      "both surviving legs' mock-delivery records agree on taskId/channel for the same fixture task"
    );
    assert(allRecords.length === 2, `exactly 2 mock-delivery records were appended, one per leg (CLI, Core MCP) (got ${allRecords.length})`);
  } finally {
    if (mcpClient) await mcpClient.close();
    if (webServer) {
      webServer.close();
      if (webServer.client) await webServer.client.close();
    }
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  console.log(
    failures === 0
      ? "\nAll QN-044 Core-level three-way symmetry (CLI/MCP/Web UI, DIR-010) tests passed."
      : `\n${failures} test(s) FAILED`
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
