// QN-036 (DIR-007): regression test for Core's own MCP server
// (packages/quay/src/mcp-server.js, wired into bin/quay.js's `mcp`
// subcommand). Spawns the REAL `quay mcp` binary as a subprocess MCP
// server, connects a real MCP client to it (same SDK usage as
// abi-symmetry.mjs's own client-side pattern), and confirms:
//
//   1. it correctly proxies task_list/task_get/task_check (and
//      provider://manifest) through to a live Provider's own MCP server,
//      with results matching what calling that Provider's own `mcp`
//      subcommand directly would return (byte-identical structuredContent);
//   2. genuine multi-Provider aggregation/routing works: two independently
//      isolated native task stores, configured as two distinct enabled
//      Providers ("native" and "native-2") in one .quay/config.yml, are
//      both reachable through the ONE `quay mcp` endpoint via the optional
//      `provider` tool argument — this is the live proof of DIR-007 point 2
//      ("genuinely proxy/aggregate... for each Provider currently
//      enabled: true"), without depending on live `gh`/GitHub network
//      access inside this automated test file (github+live-repo
//      aggregation was separately live-verified by hand this iteration,
//      see experiments/quay-native-bootstrap/iterations/iteration-26.md — this file exercises the
//      same code path against a second, fully local/isolated Provider
//      instance instead, so the test suite has zero external-network
//      dependency, consistent with this package's existing test-isolation
//      conventions, e.g. cli.test.mjs/serve.test.mjs);
//   3. error paths: unknown provider id, unknown task id;
//   4. resource enumeration: provider://manifest (default alias) and
//      provider://manifest/<id> per enabled Provider -- including (QN-041)
//      that each listed resource carries a distinct `name` field (display/
//      enumeration-only) separate from its `uri` (the actual lookup key),
//      and that `readResource({ name })` (uri omitted) genuinely fails
//      rather than silently succeeding -- closing the gap DESIGN.md §2.5
//      named ("not been checked against any MCP client that enumerates
//      resources by name rather than uri").
//   5. (QN-043) task_write's expectedStatus (CAS) option, live, through
//      this Core MCP path specifically -- the second DESIGN.md §2.5-named
//      gap ("forwarded but not specifically exercised through the Core MCP
//      path"): a matching expectedStatus succeeds and persists; a
//      mismatched one returns isError:true (not a crash) naming both the
//      expected and actual status; and a follow-up task_get confirms
//      nothing was written to disk on the conflict path.
//   6. (QN-044/DIR-010 item 1) action_list/action_run -- the two new tools
//      that close the CLI-vs-MCP capability gap DIR-010 identified: an
//      Agent connected only via `quay mcp` can now enumerate and trigger
//      action buttons, the same way bin/quay.js's own `action list`/`action
//      run` subcommands already could. action_run supports the DIR-009
//      mock/file-log delivery mode via an explicit `mockLogPath` tool
//      argument, so this test never depends on live manda delivery.
//   7. (QN-060) live cross-Provider (GitHub) aggregation through the ONE
//      `quay mcp` endpoint -- point 2 above deliberately used a second
//      local/isolated native Provider instead of live GitHub "so the test
//      suite has zero external-network dependency," and explicitly deferred
//      the real github+live-repo aggregation proof to a one-time, by-hand
//      check (iteration 26, never captured as an automated regression
//      test). This mirrors, at the MCP layer, the exact CLI-layer gap
//      iterations 54/55 closed for bin/quay.js's own `--provider github`
//      subcommands (action run; task view/action list/task check) -- this
//      is the analogous MCP-level gap the same systematic-sweep discipline
//      surfaces. Block 10 below adds `task_list`/`task_get`/`task_check`/
//      `action_list`, all `provider: "github"`, against the real, live
//      `yaleh/quay` issue gh-3, through the real `quay mcp` subprocess (not
//      a direct `quay-github mcp` spawn -- the aggregation/fan-out path
//      itself is what's under test). `task_write`/`action_run` remain
//      excluded for GitHub in this block, matching `write.test.mjs`'s own
//      precedent (this repo's real issue count is too small/precious to
//      safely target with destructive live writes in an automated,
//      repeatable test file) and iteration 55's identical CLI-layer
//      exclusion of `task edit --provider github` for the same reason.
//   8. (QN-062, iteration 58) Provider-subprocess STARTUP-FAILURE
//      propagation through `quay mcp`'s tool-call surface -- a genuinely
//      new angle from the read-path cross-Provider sweeps above: what
//      happens when an enabled Provider's own mcp_entry crashes on launch
//      (malformed QUAY_GITHUB_REPO), not what happens when a live,
//      correctly-configured Provider returns ordinary data. Requires no
//      live GitHub network access (the failure is local/synchronous).
//      Block 11 below documents, honestly, a real asymmetry: mcp-server.js
//      connects LAZILY (so `quay mcp` itself starts up fine even with a
//      broken Provider, only failing -- gracefully, isError:true -- on the
//      first tool call that targets it), unlike serve.js/bin/quay.js which
//      connect eagerly and fail fast; and the resulting MCP-level error
//      text is opaque ("Connection closed"), NOT the same name-bearing
//      diagnostic cli.test.mjs's sibling test (test 12 there) observes on
//      the CLI/Web-UI layer's stderr.
//
// Run: node test/mcp-server.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = path.join(__dirname, "..", "bin", "quay.js");
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.js");
const nativeProviderDir = path.dirname(nativeBin);
const githubBin = path.join(__dirname, "..", "..", "quay-github", "bin", "quay-github.js");
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

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
const AC_DOD_CHECKED =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

async function connectStdio(command, args, cwd, env) {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
  });
  const client = new Client({ name: "test-agent", version: "0.0.1" });
  await client.connect(transport);
  return { client, transport };
}

async function main() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-workspace-"));
  const tasksDirA = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-tasks-a-"));
  const tasksDirB = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-tasks-b-"));

  // Two independently isolated native task stores, both declared as
  // enabled: true Providers ("native" and "native-2") — the multi-Provider
  // aggregation fixture (see file header). Distinct tasks_dir values make
  // cross-contamination between them immediately detectable.
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir}"`,
      `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDirA}"`,
      "  native-2:",
      "    enabled: true",
      `    path: "${nativeProviderDir}"`,
      `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDirB}"`,
      "",
    ].join("\n")
  );

  execFileSync("node", [nativeBin, "task", "create", "MCP-A1", "--title", "Provider-A-only task",
    "--status", "todo", "--body", VALID_SECTIONS + AC_DOD_CHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDirA },
  });
  execFileSync("node", [nativeBin, "task", "create", "MCP-B1", "--title", "Provider-B-only task",
    "--status", "todo", "--body", VALID_SECTIONS + AC_DOD_CHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDirB },
  });

  // ---- 1. Connect the real `quay mcp` subprocess ----
  const { client: core, transport: coreTransport } = await connectStdio("node", [coreBin, "mcp"], workspaceRoot);

  // ---- 2. Resource enumeration ----
  const resources = await core.listResources();
  const uris = resources.resources.map((r) => r.uri).sort();
  assert(
    uris.includes("provider://manifest") &&
      uris.includes("provider://manifest/native") &&
      uris.includes("provider://manifest/native-2"),
    "quay mcp lists provider://manifest (default alias) plus one provider://manifest/<id> resource per enabled Provider"
  );

  // QN-041: close the DESIGN.md §2.5 "name vs. uri" gap -- confirm each
  // listed resource carries both a distinct `name` and a `uri` field, and
  // that `name` cannot be used as an alternate lookup key (MCP's
  // resources/read request is uri-keyed by protocol; `name` is
  // listing/display-only). This was previously asserted only via
  // uri-based readResource() calls -- never checked against `name`.
  const defaultEntry = resources.resources.find((r) => r.uri === "provider://manifest");
  const nativeEntry = resources.resources.find((r) => r.uri === "provider://manifest/native");
  assert(
    typeof defaultEntry?.name === "string" && defaultEntry.name === "manifest",
    `provider://manifest's listed entry carries a distinct name field ("manifest"), got: ${JSON.stringify(defaultEntry)}`
  );
  assert(
    typeof nativeEntry?.name === "string" && nativeEntry.name === "manifest-native",
    `provider://manifest/native's listed entry carries a distinct name field ("manifest-native"), got: ${JSON.stringify(nativeEntry)}`
  );
  assert(
    nativeEntry.name !== nativeEntry.uri,
    "the per-Provider resource's name and uri are genuinely distinct strings, not the same value under two keys"
  );
  let nameLookupThrew = false;
  let nameLookupErrorText = "";
  try {
    await core.readResource({ name: "manifest" });
  } catch (err) {
    nameLookupThrew = true;
    nameLookupErrorText = err.message || String(err);
  }
  assert(
    nameLookupThrew,
    `readResource({ name: "manifest" }) (uri omitted) rejects rather than silently succeeding or resolving the wrong resource -- confirms an Agent cannot use the listing-only "name" field as an alternate lookup key (got error: ${nameLookupErrorText})`
  );

  const defaultManifest = await core.readResource({ uri: "provider://manifest" });
  const defaultManifestId = JSON.parse(defaultManifest.contents[0].text).id;
  assert(defaultManifestId === "native", "provider://manifest (default alias) resolves to the first-enabled Provider (native)");

  const manifestB = await core.readResource({ uri: "provider://manifest/native-2" });
  assert(
    JSON.parse(manifestB.contents[0].text).id === "native",
    "provider://manifest/native-2 still reports the underlying native Provider's own declared id (provider.yml's id field is per-code, not per-config-alias) — a real, honestly-named quirk of reusing the native binary as a second config-level Provider in this fixture"
  );

  // ---- 3. task_list: default Provider (omitted `provider` arg) ----
  {
    const r = await core.callTool({ name: "task_list", arguments: {} });
    const ids = r.structuredContent.tasks.map((t) => t.id);
    assert(ids.includes("MCP-A1") && !ids.includes("MCP-B1"), "task_list with no `provider` arg defaults to the first-enabled Provider (native / tasksDirA) and does not leak Provider B's tasks");
  }

  // ---- 4. task_list: explicit provider=native-2 ----
  {
    const r = await core.callTool({ name: "task_list", arguments: { provider: "native-2" } });
    const ids = r.structuredContent.tasks.map((t) => t.id);
    assert(ids.includes("MCP-B1") && !ids.includes("MCP-A1"), "task_list with provider='native-2' routes to Provider B's own isolated task store and does not leak Provider A's tasks");
  }

  // ---- 5. task_get + task_check, cross-checked byte-identical against
  //      each Provider's own `quay-native mcp` server called directly ----
  {
    const { client: directA } = await connectStdio("node", [nativeBin, "mcp"], nativeProviderDir, {
      QUAY_NATIVE_TASKS_DIR: tasksDirA,
    });
    const direct = await directA.callTool({ name: "task_get", arguments: { id: "MCP-A1" } });
    const viaCore = await core.callTool({ name: "task_get", arguments: { id: "MCP-A1", provider: "native" } });
    assert(
      JSON.stringify(direct.structuredContent) === JSON.stringify(viaCore.structuredContent),
      "task_get via `quay mcp` (provider=native) is byte-identical to calling quay-native's own mcp server directly"
    );

    const directCheck = await directA.callTool({ name: "task_check", arguments: { id: "MCP-A1" } });
    const viaCoreCheck = await core.callTool({ name: "task_check", arguments: { id: "MCP-A1", provider: "native" } });
    assert(
      JSON.stringify(directCheck.structuredContent) === JSON.stringify(viaCoreCheck.structuredContent),
      "task_check via `quay mcp` (provider=native) is byte-identical to calling quay-native's own mcp server directly"
    );
    await directA.close();
  }

  // ---- 6. task_write passthrough (generic, provider-agnostic) ----
  {
    const r = await core.callTool({ name: "task_write", arguments: { id: "MCP-A1", status: "ready", provider: "native" } });
    assert(r.structuredContent.task.status === "ready", "task_write via `quay mcp` persists the new status on the correct Provider (native)");
    const rB = await core.callTool({ name: "task_list", arguments: { provider: "native-2" } });
    assert(
      rB.structuredContent.tasks.find((t) => t.id === "MCP-B1").status === "todo",
      "task_write against Provider native left Provider native-2's own MCP-B1 task untouched (no cross-Provider leakage)"
    );
  }

  // ---- 7. task_write expectedStatus (CAS) passthrough, live (QN-043) ----
  {
    // MCP-A1's status is currently "ready" (set by step 6 above).
    const okResult = await core.callTool({
      name: "task_write",
      arguments: { id: "MCP-A1", status: "done", expectedStatus: "ready", provider: "native" },
    });
    assert(
      okResult.structuredContent?.task?.status === "done",
      "task_write via `quay mcp` with a matching expectedStatus (ready) succeeds and persists the new status (done)"
    );

    // Now MCP-A1 is "done". Attempt a CAS write premised on a stale
    // expectedStatus ("ready") -- must be refused, not silently applied.
    const conflictResult = await core.callTool({
      name: "task_write",
      arguments: { id: "MCP-A1", status: "needs-human", expectedStatus: "ready", provider: "native" },
    });
    assert(
      conflictResult.isError === true,
      "task_write via `quay mcp` with a mismatched expectedStatus returns isError:true, not a crash or a silent write"
    );
    const conflictText = conflictResult.content?.[0]?.text ?? "";
    assert(
      /expected status "ready"/.test(conflictText),
      `the CAS conflict error message names the expected status (got: ${conflictText})`
    );
    assert(
      /actual current status is "done"/.test(conflictText),
      `the CAS conflict error message names the actual current status (got: ${conflictText})`
    );

    const afterConflict = await core.callTool({ name: "task_get", arguments: { id: "MCP-A1", provider: "native" } });
    assert(
      afterConflict.structuredContent.task.status === "done",
      "after the refused CAS write, MCP-A1's status is still 'done' (the earlier successful write) -- the conflicting write did NOT get silently applied"
    );
  }

  // ---- 8. Error paths ----
  {
    const rUnknownProvider = await core.callTool({ name: "task_list", arguments: { provider: "does-not-exist" } });
    assert(rUnknownProvider.isError === true, "task_list with an unknown/non-enabled provider id returns isError:true, not a crash");
    assert(
      /not enabled/.test(rUnknownProvider.content?.[0]?.text ?? ""),
      "the unknown-provider error message names the enabled-provider set"
    );

    const rUnknownId = await core.callTool({ name: "task_get", arguments: { id: "NOPE-999" } });
    assert(rUnknownId.isError === true, "task_get with an unknown task id returns isError:true, not a crash");
  }

  // ---- 9. action_list / action_run (QN-044/DIR-010 item 1) ----
  {
    // MCP-B1 is still "todo" on Provider native-2 (untouched by steps 6-7,
    // which only ever wrote to Provider "native"'s MCP-A1).
    const listResult = await core.callTool({ name: "action_list", arguments: { id: "MCP-B1", provider: "native-2" } });
    assert(
      Array.isArray(listResult.structuredContent?.buttons) && listResult.structuredContent.buttons.length === 1 &&
        listResult.structuredContent.buttons[0].id === "advance",
      `action_list via quay mcp returns the one "advance" button applicable to MCP-B1's "todo" status (got: ${JSON.stringify(listResult.structuredContent)})`
    );

    // action_list on an unknown task id -> isError, not a crash.
    const listUnknown = await core.callTool({ name: "action_list", arguments: { id: "NOPE-999", provider: "native-2" } });
    assert(listUnknown.isError === true, "action_list with an unknown task id returns isError:true, not a crash");

    // action_run, mock delivery mode selected via the explicit mockLogPath
    // tool argument (not the QUAY_ACTION_MOCK_LOG env var) -- deterministic,
    // no live manda dependency.
    const mockLogPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-action-run-")), "log.jsonl");
    const runResult = await core.callTool({
      name: "action_run",
      arguments: { id: "MCP-B1", actionId: "advance", provider: "native-2", mockLogPath },
    });
    assert(runResult.structuredContent?.delivered === "mock", `action_run via quay mcp with mockLogPath returns delivered:"mock" (got ${JSON.stringify(runResult.structuredContent?.delivered)})`);
    assert(runResult.structuredContent?.taskId === "MCP-B1", "action_run's returned payload carries the correct taskId (MCP-B1)");
    assert(runResult.structuredContent?.skill === "quay:author", "action_run's returned payload resolves skill from status_skill_map for MCP-B1's current status (todo)");
    assert(fs.existsSync(mockLogPath), "action_run's mock delivery actually wrote the log file");
    const logLines = fs.readFileSync(mockLogPath, "utf8").trim().split("\n").filter(Boolean);
    assert(logLines.length === 1, `action_run's mock log has exactly 1 record after 1 call (got ${logLines.length})`);
    const logRecord = JSON.parse(logLines[0]);
    assert(logRecord.taskId === "MCP-B1" && logRecord.channel === "task-MCP-B1", "the mock log record's own content matches the composed payload (taskId, channel)");

    // action_run on an unknown task id -> isError, not a crash.
    const runUnknownTask = await core.callTool({
      name: "action_run",
      arguments: { id: "NOPE-999", actionId: "advance", provider: "native-2", mockLogPath },
    });
    assert(runUnknownTask.isError === true, "action_run with an unknown task id returns isError:true, not a crash");

    // action_run on an unknown actionId -> isError, not a crash (composePayload() throws).
    const runUnknownAction = await core.callTool({
      name: "action_run",
      arguments: { id: "MCP-B1", actionId: "does-not-exist", provider: "native-2", mockLogPath },
    });
    assert(runUnknownAction.isError === true, "action_run with an unknown actionId returns isError:true, not a crash");
    assert(
      /no such action button/.test(runUnknownAction.content?.[0]?.text ?? ""),
      "the unknown-actionId error message names the problem (composePayload()'s own error text surfaces through)"
    );

    fs.rmSync(path.dirname(mockLogPath), { recursive: true, force: true });
  }

  await core.close();

  // ---- 10. (QN-060) live cross-Provider (GitHub) aggregation through
  //      `quay mcp`, against the real, live yaleh/quay issue gh-3 ----
  // A separate workspace/config fixture (native + github both enabled) is
  // used here rather than reusing the native/native-2 fixture above, so this
  // block's real-network dependency is isolated to its own connection and
  // cleanup, matching cli.test.mjs's own per-block github fixture convention
  // (tests 8/10/11 there each stand up their own config.yml).
  {
    const ghWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-workspace-gh-"));
    fs.mkdirSync(path.join(ghWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(ghWorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir}"`,
        `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${tasksDirA}"`,
        "  github:",
        "    enabled: true",
        `    path: "${githubProviderDir}"`,
        `    mcp_entry: ["node", "${githubBin}", "mcp"]`,
        "    env:",
        "      QUAY_GITHUB_REPO: \"yaleh/quay\"",
        "",
      ].join("\n")
    );

    const { client: coreGh, transport: coreGhTransport } = await connectStdio("node", [coreBin, "mcp"], ghWorkspaceRoot);

    const tl = await coreGh.callTool({ name: "task_list", arguments: { provider: "github" } });
    assert(
      Array.isArray(tl.structuredContent?.tasks) && tl.structuredContent.tasks.length > 0,
      "task_list via quay mcp (provider=github) returns real, non-empty task data aggregated live from the yaleh/quay repo"
    );
    assert(
      tl.structuredContent.tasks.some((t) => t.id === "gh-3"),
      "task_list via quay mcp (provider=github) includes the real, live gh-3 task"
    );

    const tg = await coreGh.callTool({ name: "task_get", arguments: { id: "gh-3", provider: "github" } });
    assert(tg.structuredContent?.task?.id === "gh-3", "task_get via quay mcp (provider=github) returns gh-3's real id");
    assert(
      typeof tg.structuredContent?.task?.title === "string" && tg.structuredContent.task.title.length > 0,
      "task_get via quay mcp (provider=github) returns a non-empty title read live from the real issue"
    );
    assert(
      tg.structuredContent?.task?.status === "ready",
      `task_get via quay mcp (provider=github) reflects gh-3's real live status (got ${tg.structuredContent?.task?.status})`
    );

    const tc = await coreGh.callTool({ name: "task_check", arguments: { id: "gh-3", provider: "github" } });
    assert(tc.isError !== true, "task_check via quay mcp (provider=github) does not error for gh-3 (the gate itself may still report ok:false)");
    assert(
      tc.structuredContent?.ok === false,
      `task_check via quay mcp (provider=github) reports ok:false for gh-3's real, currently-unchecked AC state (got ${JSON.stringify(tc.structuredContent)})`
    );
    assert(
      typeof tc.structuredContent?.acTotal === "number" && typeof tc.structuredContent?.acChecked === "number",
      "task_check via quay mcp (provider=github) reports real numeric acTotal/acChecked counts read live from the issue body"
    );

    const al = await coreGh.callTool({ name: "action_list", arguments: { id: "gh-3", provider: "github" } });
    assert(
      Array.isArray(al.structuredContent?.buttons) &&
        al.structuredContent.buttons.some((b) => b.id === "advance"),
      `action_list via quay mcp (provider=github) includes the "advance" button for gh-3 (its real live status is in the button's whenStatus); got ${JSON.stringify(al.structuredContent)}`
    );

    // task_write / action_run are deliberately NOT exercised against GitHub
    // here -- both have a real `gh api` write path (github-client.js's
    // setStatus()), and per write.test.mjs's own precedent (this repo's real
    // issue count is too small/precious to safely target with destructive
    // live writes in an automated, repeatable test file) and iteration 55's
    // identical `task edit --provider github` CLI-layer exclusion, this
    // exclusion is intentional, not an oversight.

    await coreGh.close();
    fs.rmSync(ghWorkspaceRoot, { recursive: true, force: true });
  }

  // ---- 11. (QN-062, iteration 58) Provider-subprocess STARTUP-FAILURE
  //      propagation through `quay mcp`'s tool-call surface, local-only (no
  //      live network) — the MCP-layer sibling of cli.test.mjs's new test
  //      12. Unlike serve.js/bin/quay.js (which connect to every Provider
  //      eagerly, so a crashing Provider fails fast at startup, before
  //      anything is served), mcp-server.js's own getClient() connects
  //      LAZILY, on first tool call that names the Provider (see this
  //      file's header / mcp-server.js's own doc comment) -- so `quay mcp`
  //      itself starts up successfully even with a Provider whose mcp_entry
  //      will crash, and the failure only surfaces on the first tool call
  //      that actually targets it. This test proves that first call returns
  //      isError:true (a graceful MCP-protocol-level failure), not a
  //      hang or an uncaught-exception crash of the `quay mcp` process
  //      itself -- but ALSO documents, honestly, that the resulting error
  //      text is opaque ("MCP error -32000: Connection closed") and does
  //      NOT surface bin/quay-github.js's own actual diagnostic
  //      ("QUAY_GITHUB_REPO must be \"owner/repo\""), which is only ever
  //      visible on the crashed child's own stderr (verified by hand this
  //      iteration, not asserted here since a torn-down child process's
  //      stderr is not retained by the MCP SDK's client transport). This is
  //      a real, previously-undocumented asymmetry between the CLI/Web-UI
  //      layer (verbose but name-bearing stderr diagnostic) and the MCP
  //      layer (a protocol-level error code only) for the identical root
  //      cause -- named honestly here rather than glossed over.
  {
    const brokenWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-workspace-broken-"));
    fs.mkdirSync(path.join(brokenWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(brokenWorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  broken-github:",
        "    enabled: true",
        `    path: "${githubProviderDir}"`,
        `    mcp_entry: ["node", "${githubBin}", "mcp"]`,
        "    env:",
        "      QUAY_GITHUB_REPO: \"this-is-not-owner-slash-repo\"",
        "",
      ].join("\n")
    );

    const { client: coreBroken, transport: coreBrokenTransport } = await connectStdio("node", [coreBin, "mcp"], brokenWorkspaceRoot);

    const tl = await coreBroken.callTool({ name: "task_list", arguments: {} });
    assert(tl.isError === true, "task_list against a Provider whose mcp_entry crashes on launch returns isError:true (a graceful MCP-level failure, not a hang or an uncaught crash of quay mcp itself)");
    assert(
      typeof tl.content?.[0]?.text === "string" && tl.content[0].text.length > 0,
      `task_list against a crashing Provider still returns a non-empty error text field (got: ${JSON.stringify(tl.content)})`
    );

    // A second, independent call proves `quay mcp` itself is still alive
    // and responsive after the first call's underlying connection attempt
    // failed -- the crash is scoped to that one Provider's connection, not
    // fatal to the aggregator process as a whole.
    const tl2 = await coreBroken.callTool({ name: "task_list", arguments: {} });
    assert(tl2.isError === true, "a second task_list call against the same broken Provider also returns isError:true (quay mcp itself did not crash or hang after the first failure)");

    await coreBroken.close();
    fs.rmSync(brokenWorkspaceRoot, { recursive: true, force: true });
  }

  // ---- 12. (QX-003, experiment 4 iteration 1): task_list prefix filter ----
  // Tests the new optional `prefix` parameter on the task_list MCP tool, which
  // closes CB-009 (no prefix filter on MCP task_list) and partially addresses
  // CB-010 (response size reduced when prefix is used). Uses a fresh isolated
  // workspace with tasks across two distinct prefixes.
  {
    const prefixTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-prefix-tasks-"));
    const prefixWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-prefix-workspace-"));
    fs.mkdirSync(path.join(prefixWorkspaceRoot, ".quay"), { recursive: true });

    // Seed tasks with two distinct prefixes: PFXA and PFXB
    const MINIMAL_BODY =
      "## Proposal\nA sufficiently long proposal section.\n" +
      "## Plan\nA sufficiently long plan section.\n" +
      "## AC\n- [x] a sufficiently long acceptance criterion line\n" +
      "## DoD\n- [x] a sufficiently long definition-of-done line\n";

    execFileSync("node", [nativeBin, "task", "create", "PFXA-001", "--title", "Prefix A task 1",
      "--status", "todo", "--body", MINIMAL_BODY], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: prefixTasksDir },
    });
    execFileSync("node", [nativeBin, "task", "create", "PFXA-002", "--title", "Prefix A task 2",
      "--status", "todo", "--body", MINIMAL_BODY], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: prefixTasksDir },
    });
    execFileSync("node", [nativeBin, "task", "create", "PFXB-001", "--title", "Prefix B task 1",
      "--status", "done", "--body", MINIMAL_BODY], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: prefixTasksDir },
    });

    fs.writeFileSync(
      path.join(prefixWorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir}"`,
        `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${prefixTasksDir}"`,
        "",
      ].join("\n")
    );

    const { client: corePrefix } = await connectStdio("node", [coreBin, "mcp"], prefixWorkspaceRoot);

    // task_list with prefix: returns only matching tasks
    const filtered = await corePrefix.callTool({ name: "task_list", arguments: { prefix: "PFXA" } });
    assert(filtered.isError !== true, "task_list with prefix='PFXA' does not return isError:true");
    assert(
      Array.isArray(filtered.structuredContent?.tasks),
      "task_list with prefix='PFXA' returns structuredContent.tasks array"
    );
    const filteredTasks = filtered.structuredContent?.tasks ?? [];
    assert(
      filteredTasks.every((t) => t.id.toUpperCase().startsWith("PFXA")),
      `task_list with prefix='PFXA' returns only tasks whose id starts with PFXA (got: ${filteredTasks.map(t => t.id).join(", ")})`
    );
    assert(
      filteredTasks.some((t) => t.id === "PFXA-001") && filteredTasks.some((t) => t.id === "PFXA-002"),
      "task_list with prefix='PFXA' includes both PFXA-001 and PFXA-002"
    );
    assert(
      !filteredTasks.some((t) => t.id === "PFXB-001"),
      "task_list with prefix='PFXA' excludes PFXB-001 (different prefix)"
    );

    // task_list with prefix: case-insensitive
    const filteredLower = await corePrefix.callTool({ name: "task_list", arguments: { prefix: "pfxa" } });
    const filteredLowerTasks = filteredLower.structuredContent?.tasks ?? [];
    assert(
      filteredLowerTasks.some((t) => t.id === "PFXA-001"),
      "task_list with prefix='pfxa' (lowercase) includes PFXA-001 (case-insensitive match)"
    );

    // task_list without prefix: returns all tasks (no regression)
    const all = await corePrefix.callTool({ name: "task_list", arguments: {} });
    assert(all.isError !== true, "task_list without prefix does not return isError:true (no regression)");
    const allTasks = all.structuredContent?.tasks ?? [];
    assert(
      allTasks.length === 3,
      `task_list without prefix returns all 3 seeded tasks (got ${allTasks.length})`
    );
    assert(
      allTasks.some((t) => t.id === "PFXA-001") && allTasks.some((t) => t.id === "PFXB-001"),
      "task_list without prefix includes tasks from both prefixes"
    );

    // task_list with prefix that matches nothing: returns empty array (not an error)
    const empty = await corePrefix.callTool({ name: "task_list", arguments: { prefix: "ZZZZ" } });
    assert(empty.isError !== true, "task_list with non-matching prefix does not return isError:true");
    const emptyTasks = empty.structuredContent?.tasks ?? [];
    assert(emptyTasks.length === 0, "task_list with non-matching prefix returns empty array");

    await corePrefix.close();
    fs.rmSync(prefixWorkspaceRoot, { recursive: true, force: true });
    fs.rmSync(prefixTasksDir, { recursive: true, force: true });
  }

  // ---- Cleanup ----
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.rmSync(tasksDirA, { recursive: true, force: true });
  fs.rmSync(tasksDirB, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} FAILURE(S)`);
    process.exitCode = 1;
  } else {
    console.log("\nAll QN-036 Core MCP server (DIR-007) tests passed.");
  }
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
