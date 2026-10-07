// @test-group product
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

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import YAML from "yaml";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// gap-tests-spawn-cli-from-ts-source (AC9): route CLI subprocess spawns through
// the prebuilt dist bundles (freshness-checked by cli-entry.mjs) instead of the
// .ts sources. coreBin is the Core MCP server's 15 connectStdio() handshakes;
// nativeBin seeds fixtures + the provider MCP server. nativeProviderDir stays
// pinned to the SOURCE bin dir (provider cwd via config.yml `path:`).
const coreBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// gap-tests-use-cli-where-module-import-suffices (AC1/AC2): fixture seeding goes
// through the quay-native store module's write() — the SAME validated write
// path bin/quay-native.ts's `task create`/`task edit` are thin wrappers over
// (status whitelist, ADV-004 path guard, M89 post-write YAML validation, M35
// relation sync), without a Node subprocess per fixture. `task edit --extra`
// is expressed directly via write()'s `extra` field (one call instead of
// create+edit). Every fixture below is a flat id/title/status/labels/body/extra
// pure-data task with no cross-file write-semantic dependency → seedTask().
function seedTask(tasksDir, id, fields) {
  return createStore(tasksDir).write(id, { labels: [], ...fields });
}
const githubBin = path.join(__dirname, "..", "..", "quay-github", "bin", "quay-github.ts");
const githubProviderDir = path.dirname(githubBin);

// ADR-019/DIR-109 + gap-release-run-tests-hangs-on-shared-mcp-client-leak (AC-266): live-GitHub
// blocks run ONLY when opted in, mirroring cli.test.mjs:189-190's own LIVE_GITHUB_ENV /
// liveGithubEnabled pair rather than inventing a second spelling of the same opt-in. The release
// job deliberately does not set this (nor GH_TOKEN), so block 10 must self-skip there.
const LIVE_GITHUB_ENV = "QUAY_TEST_LIVE_GITHUB";
const liveGithubEnabled = process.env[LIVE_GITHUB_ENV] === "1";

let failures = 0;
let _lastAssertMs = 0; // AC1b assertion-gap timing (gap-suite-cost-model-is-wrong-optimizations-buy-nothing)
function assert(cond, msg) {
  if (process.env.QUAY_TEST_ASSERT_TIMING) {
    const now = Date.now();
    if (_lastAssertMs) {
      const gap = now - _lastAssertMs;
      if (gap >= 1000) console.error(`[timing] +${Math.round(gap)}ms: ${String(msg).slice(0, 80)}`);
    }
    _lastAssertMs = now;
  }
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

  // Pure-data fixtures → store write (same validated path as `task create`).
  seedTask(tasksDirA, "MCP-A1", { title: "Provider-A-only task", status: "todo", body: VALID_SECTIONS + AC_DOD_CHECKED });
  seedTask(tasksDirB, "MCP-B1", { title: "Provider-B-only task", status: "todo", body: VALID_SECTIONS + AC_DOD_CHECKED });

  // instrument entry-point fixture (gap-eighty-one-instruments...): a real
  // plugin/scripts subtree under the workspace so the `instrument` tool's
  // list/run actions have something derived. The REAL inventory tool is copied
  // in (its --instruments-json mode is what `instrument action:list` spawns);
  // the three fixtures below exercise the admission filter (declared vs not).
  fs.mkdirSync(path.join(workspaceRoot, "plugin", "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, "..", "..", "..", "plugin", "scripts", "runtime-usage-inventory.ts"),
    path.join(workspaceRoot, "plugin", "scripts", "runtime-usage-inventory.ts")
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "plugin", "scripts", "fixture-say-hello.ts"),
    '// fixture-say-hello.ts — answers the fixture\'s greeting question.\n// @instrument "answers the fixture greeting question"\nexport const greeting = "hello-from-fixture";\n'
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "plugin", "scripts", "fixture-echo.sh"),
    "#!/usr/bin/env bash\n# fixture-echo.sh — answers what the fixture echo instrument prints.\necho 'instrument-ran-ok'\n"
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "plugin", "scripts", "fixture-undeclared.sh"),
    "#!/usr/bin/env bash\necho 'no declaration'\n"
  );

  // AC4 (connection consolidation): blocks 17 (QN-035 _version) and 19
  // (QN-044 fence-search) are READ-ONLY and id/search-scoped (no store-wide
  // count assertions, no writes), so they share the primary `core` connection
  // (default provider "native" = tasksDirA) instead of spawning their own
  // `quay mcp` subprocess. Their fixture tasks live here in tasksDirA.
  seedTask(tasksDirA, "VSN-1", { title: "Version test task", status: "todo", body: "# VSN-1 body" });
  seedTask(tasksDirA, "FENCE-1", { title: "Task with fenced code block", status: "todo",
    body: "## Proposal\nSome prose.\n```bash\n# bash-comment-token\necho hello\n```\n## AC\n- [x] done\n## DoD\n- [x] done\n" });
  seedTask(tasksDirA, "FENCE-2", { title: "Task with heading outside fence", status: "todo",
    body: "## Proposal-outside-fence\nSome prose.\n## AC\n- [x] done\n## DoD\n- [x] done\n" });

  // ---- 1. Connect the real `quay mcp` subprocess ----
  const { client: core, transport: coreTransport } = await connectStdio("node", [coreBin, "mcp"], workspaceRoot);

  // gap-release-run-tests-hangs-on-shared-mcp-client-leak (AC-266): EVERY client this file opens is
  // wrapped in `try { … } finally { await <client>.close(); }` so that a throwing block cannot skip
  // the close. Before this, `core.close()` sat only on the happy path (its old position is the
  // `} finally {` that now ends this block); any block that threw left the `quay mcp` child — and
  // that child's own provider subprocess — alive, the stdio handle held the event loop open, and
  // `node --test` never exited. That is the release job's 30m21s/30m17s zero-output hang (AC-266),
  // and the repo's known `detached-test-child-leak-hangs-suite` shape. The trigger in release is
  // block 10 below (live GitHub, and release.yml deliberately sets no token), but the ROOT is this
  // lifecycle, not that block: on the machine the defect was filed from the first throw was block
  // 7b's `dir.total`, i.e. a different block with the identical shape.
  //
  // The wrapped bodies below are deliberately NOT re-indented — a whole-file re-indent would bury
  // the one-line change that matters under ~3800 lines of churn. `git diff -w` on this commit shows
  // only the added `try {` / `} finally { … }` pairs.
  try {

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
    try {
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
    } finally {
      await directA.close();
    }
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

    // SILENT-COMPLETION GUARD (gap-silent-completion-path-writes-no-gate-event): a bare
    // status:"done" write produces ZERO `complete` GateEvents — the 2026-09-30 defect that stalled
    // every code delta's fan-in for a day. Core now refuses that shape and points at the two
    // sanctioned routes (lifecycle_complete / the completeReason channel). Negative control: the
    // refusal must be isError:true AND leave the task untouched.
    const refusedResult = await core.callTool({
      name: "task_write",
      arguments: { id: "MCP-A1", status: "done", provider: "native" },
    });
    assert(
      refusedResult.isError === true,
      "task_write via `quay mcp` with status:'done' and NO completeReason is refused (isError:true)"
    );
    assert(
      /complete\b/.test(refusedResult.content?.[0]?.text ?? "") && /completeReason/.test(refusedResult.content?.[0]?.text ?? ""),
      `the refusal names the completion channel (got: ${refusedResult.content?.[0]?.text ?? ""})`
    );
    const afterRefusal = await core.callTool({ name: "task_get", arguments: { id: "MCP-A1", provider: "native" } });
    assert(
      afterRefusal.structuredContent.task.status === "ready",
      "the refused done-write left MCP-A1 at 'ready' (refusal is not a silent write)"
    );

    // The sanctioned out-of-band channel: same write, but it must say WHY. It writes the status AND
    // the `complete` GateEvent itself, so the landing is covered by construction.
    const gateLog = path.join(workspaceRoot, ".quay", "gate-events.jsonl");
    const before = fs.existsSync(gateLog) ? fs.readFileSync(gateLog, "utf8") : "";
    const okResult = await core.callTool({
      name: "task_write",
      arguments: { id: "MCP-A1", status: "done", expectedStatus: "ready", completeReason: "QN-043 CAS regression: completion channel", provider: "native" },
    });
    assert(
      okResult.structuredContent?.task?.status === "done",
      "task_write via `quay mcp` with a matching expectedStatus (ready) succeeds and persists the new status (done)"
    );
    const appended = (fs.existsSync(gateLog) ? fs.readFileSync(gateLog, "utf8") : "").slice(before.length);
    assert(
      /"gate":\s*"complete"/.test(appended) && /"verdict":\s*"pass"/.test(appended) && /QN-043 CAS regression/.test(appended),
      `the completion channel wrote a complete/pass GateEvent carrying the reason (appended: ${appended})`
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

  // ---- 7b. superseded is a writable status via MCP (gap-superseded-modeled-as-task-lifecycle-terminal) ----
  {
    // MCP-A1 is currently "done" (set by step 7). Writing it to superseded
    // proves the Core MCP layer accepts the newly modeled terminal status.
    const r = await core.callTool({ name: "task_write", arguments: { id: "MCP-A1", status: "superseded", provider: "native" } });
    assert(
      r.structuredContent?.task?.status === "superseded",
      "task_write via `quay mcp` can write the modeled superseded terminal status"
    );
    const afterSup = await core.callTool({ name: "task_get", arguments: { id: "MCP-A1", provider: "native" } });
    assert(
      afterSup.structuredContent.task.status === "superseded",
      "task_get confirms MCP-A1 persisted as superseded (read-back after MCP write)"
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

  // ---- 7b. (gap-eighty-one-instruments...) the `instrument` entry point ----
  // One tool (not 36 schemas); `action: "list"` derives the directory from the
  // fixture's plugin/scripts subtree (count is DERIVED, never hardcoded); the
  // admission filter is visible (fixture-undeclared.sh stays out); `action:
  // "run"` spawns an admitted instrument and returns its real stdout (the
  // AC9 contract assertion — spawn, argv, exit code and stdout are all real).
  {
    const list = await core.callTool({ name: "instrument", arguments: { action: "list" } });
    assert(list.isError !== true, "instrument action:list succeeds through quay mcp");
    const dir = list.structuredContent;
    // runtime-usage-inventory.ts + 3 fixture instruments = 4; >=4 keeps it a derived bound.
    assert(dir.total >= 4, `instrument directory total is DERIVED from the fixture (>=4), got ${dir.total}`);
    assert(dir.admitted >= 3, `fixture instruments admitted (>=3), got ${dir.admitted}`);
    const sayHello = dir.instruments.find((i) => i.name === "fixture-say-hello");
    assert(
      sayHello && sayHello.description === "answers the fixture greeting question",
      `fixture-say-hello is admitted with its declared question (got ${sayHello?.description})`
    );
    const undeclared = dir.notAdmitted.includes("plugin/scripts/fixture-undeclared.sh");
    assert(undeclared, "the undeclared fixture is kept OUT (notAdmitted) — the admission filter is visible, not silent");

    const run = await core.callTool({ name: "instrument", arguments: { action: "run", name: "fixture-echo", args: [] } });
    assert(run.isError !== true, "instrument action:run on an admitted .sh instrument succeeds");
    assert(run.structuredContent?.exitCode === 0, `fixture-echo exits 0 (got ${run.structuredContent?.exitCode})`);
    assert(
      String(run.structuredContent?.stdout ?? "").includes("instrument-ran-ok"),
      "fixture-echo's real stdout carries its payload (real spawn contract assertion)"
    );

    const unknown = await core.callTool({ name: "instrument", arguments: { action: "run", name: "no-such-instrument" } });
    assert(unknown.isError === true, "instrument run with an unknown name is isError:true, not a crash");

    const noName = await core.callTool({ name: "instrument", arguments: { action: "run" } });
    assert(noName.isError === true, "instrument run without a name is isError:true, not a crash");
  }

  // ---- 7c. (gap-needs-human-raw-fan-in-reason-observation-surface) driver_log ----
  // 人 2026-09-20：「driver 当然应当记录相应的日志，人类观测面（如 quay cli/mcp/web）也应提供这些日志的
  // 访问。」 The driver already wrote one record per attempt into `.quay/worker-outcome.jsonl`; the MCP
  // tool and the `quay driver log` CLI must return the SAME record FIELD FOR FIELD — the deepEqual
  // below is what makes "both go through the one reader" a measurement rather than an intention
  // (⛔ three surfaces each writing their own parse is exactly what this task forbids).
  {
    const fixtureReason = "AssertionError [ERR_ASSERTION]: stdout differs between symlink and real invocation";
    fs.writeFileSync(
      path.join(workspaceRoot, ".quay", "worker-outcome.jsonl"),
      [
        JSON.stringify({
          ts: "2026-09-20T04:00:00.000Z", task: "MCP-A1", run_id: "r-landed",
          started_at: "2026-09-20T03:50:00.000Z", ended_at: "2026-09-20T04:00:00.000Z",
          final_state: "completed", mechanical_fan_in: { outcome: "landed", step: null, reason: null },
        }),
        JSON.stringify({
          ts: "2026-09-20T05:25:06.591Z", task: "MCP-A1", run_id: "r-red",
          started_at: "2026-09-20T04:36:41.511Z", ended_at: "2026-09-20T05:25:06.591Z",
          final_state: "exited-not-landed",
          mechanical_fan_in: {
            outcome: "red", step: "suite", reason: fixtureReason,
            suiteLog: "fan-in-suite-MCP-A1.log", fanInLog: "fan-in-MCP-A1.log",
          },
        }),
      ].join("\n") + "\n"
    );

    const viaMcp = await core.callTool({ name: "driver_log", arguments: { kind: "worker", task: "MCP-A1" } });
    assert(viaMcp.isError !== true, "driver_log succeeds through quay mcp");
    const mcpRec = viaMcp.structuredContent;
    assert(mcpRec.status === "ok", "the MCP result carries the reader's own tri-state status");
    assert(mcpRec.attempts.length === 2, "both of this task's attempts come back");
    assert(mcpRec.attempts[1].step === "suite", "the failing step is lifted onto the attempt");
    assert(mcpRec.attempts[1].reason === fixtureReason, "the RAW failure text comes back untruncated and unclassified");

    const cliOut = execFileSync(
      "node",
      [coreBin, "driver", "log", "--kind", "worker", "--task", "MCP-A1", "--json", "--root", workspaceRoot],
      { encoding: "utf8" }
    );
    // Field-identical, key-order-insensitively: both sides are the SAME `readFanInAttempts` result,
    // serialized by two different transports (the CLI's own JSON.stringify vs MCP's
    // structuredContent). `stableJson` sorts keys recursively so the comparison measures the VALUES,
    // not the serializers' key order.
    const stableJson = (v) =>
      Array.isArray(v)
        ? `[${v.map(stableJson).join(",")}]`
        : v && typeof v === "object"
          ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`
          : JSON.stringify(v ?? null);
    assert(
      stableJson(JSON.parse(cliOut)) === stableJson(mcpRec),
      "AC4: `quay driver log --json` and MCP `driver_log` return FIELD-IDENTICAL records (one shared reader)"
    );
    assert(
      JSON.parse(cliOut).attempts[1].reason === mcpRec.attempts[1].reason,
      "AC4: the RAW failure text is byte-identical across the CLI and MCP arms"
    );

    // A kind with no attempt carrier is reported as NOT COVERED — never as an empty log (硬规则 3b).
    const notCovered = await core.callTool({ name: "driver_log", arguments: { kind: "promotion" } });
    assert(notCovered.isError === true, "a not-covered kind is isError:true, not an empty log");

    // A carrier that could not be read is an ERROR too, and it says WHY rather than answering [].
    const carrierPath = path.join(workspaceRoot, ".quay", "worker-outcome.jsonl");
    const saved = fs.readFileSync(carrierPath, "utf8");
    fs.rmSync(carrierPath);
    fs.mkdirSync(carrierPath, { recursive: true }); // a DIRECTORY at the carrier path: EISDIR, not ENOENT
    try {
      const unreadable = await core.callTool({ name: "driver_log", arguments: { kind: "worker" } });
      assert(unreadable.isError === true, "an unreadable carrier is isError:true (读不出 ≠ 空)");
      assert(unreadable.structuredContent?.status === "carrier-unreadable", "and the status names the state");
    } finally {
      fs.rmSync(carrierPath, { recursive: true, force: true });
      fs.writeFileSync(carrierPath, saved);
    }
  }

  // NOTE (AC4 connection consolidation): `core` is deliberately NOT closed here
  // — blocks 17 (QX-035) and 19 (QX-044) below are read-only and id/search-
  // scoped, so they reuse this same connection (default provider "native" =
  // tasksDirA, where their VSN-1/FENCE-1/FENCE-2 fixtures were seeded). The
  // close now lives in this try's `finally` (see the `try {` above block 2),
  // so it runs on the throwing path too, not only on the happy path.

  // ---- 10. (QN-060) live cross-Provider (GitHub) aggregation through
  //      `quay mcp`, against the real, live yaleh/quay issue gh-3 ----
  // A separate workspace/config fixture (native + github both enabled) is
  // used here rather than reusing the native/native-2 fixture above, so this
  // block's real-network dependency is isolated to its own connection and
  // cleanup, matching cli.test.mjs's own per-block github fixture convention
  // (tests 8/10/11 there each stand up their own config.yml).
  //
  // ⚠️ This block is an async IIFE, not a bare `{}` block, because of the opt-in guard below:
  // the guard's `return` must exit THIS BLOCK only. A bare `return` at that point would exit
  // main() and silently skip blocks 11-19 plus the entire QENG gate section — and scripts/test.sh
  // does not set QUAY_TEST_LIVE_GITHUB either, so the ordinary suite would keep a green tick while
  // ~1500 lines of assertions never ran (a green that means nothing, hard rule 3b).
  await (async () => {
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

    try {
    // ADR-019/DIR-109 + AC-266 arm (b): this block talks to the REAL, LIVE yaleh/quay issue store,
    // and release.yml deliberately sets no GH_TOKEN (its own comment says live-GitHub tests
    // self-skip unless opted in, and this file's header says the suite has zero external-network
    // dependency -- both were FALSE for this block before this guard). Without it the tokenless
    // release run dereferenced undefined at `tl.structuredContent.tasks` a few lines down, which
    // threw, which leaked this client (see the try/finally) and hung the job for 30 minutes.
    if (!liveGithubEnabled) { console.log("skip: block 10 needs live GitHub — opt in with QUAY_TEST_LIVE_GITHUB=1"); return; }

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
    } finally {
      await coreGh.close();
    }
    fs.rmSync(ghWorkspaceRoot, { recursive: true, force: true });
  })();

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
  //      NOT surface bin/quay-github.ts's own actual diagnostic
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
    try {
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

    } finally {
      await coreBroken.close();
    }
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

    // Pure-data fixtures → store write.
    seedTask(prefixTasksDir, "PFXA-001", { title: "Prefix A task 1", status: "todo", body: MINIMAL_BODY });
    seedTask(prefixTasksDir, "PFXA-002", { title: "Prefix A task 2", status: "todo", body: MINIMAL_BODY });
    seedTask(prefixTasksDir, "PFXB-001", { title: "Prefix B task 1", status: "done", body: MINIMAL_BODY });

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
    try {

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

    } finally {
      await corePrefix.close();
    }
    fs.rmSync(prefixWorkspaceRoot, { recursive: true, force: true });
    fs.rmSync(prefixTasksDir, { recursive: true, force: true });
  }

  // ---- Block 13: QX-010 (experiment 4, iteration 2) — tools/list schema
  //      correctness for task_list (prefix parameter, CB-011). ----
  //
  // CB-011 was filed because Claude Code's cached MCP schema for this session
  // (opened BEFORE QX-003 was committed) lacked the `prefix` parameter.
  // The server code has had `prefix` in its inputSchema since QX-003 (iteration
  // 1). This block verifies that fact via the MCP SDK's own `listTools()` call
  // (the same wire mechanism Claude Code would use on a fresh session).
  //
  // Also verifies that `task_list`'s response objects include `updatedAt`
  // (QX-008, experiment 4, iteration 2) — the file mtime field added to
  // quay-native's store.js list() path, closing CB-004/CB-005/CB-012.
  {
    const schemaTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-schema-tasks-"));
    const schemaWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-schema-workspace-"));
    fs.mkdirSync(path.join(schemaWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(schemaWorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir}"`,
        `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${schemaTasksDir}"`,
        "",
      ].join("\n")
    );

    // Seed one task so task_list returns a real object to inspect for updatedAt.
    const MINIMAL_BODY =
      "## Proposal\nA sufficiently long proposal section.\n" +
      "## Plan\nA sufficiently long plan section.\n" +
      "## AC\n- [x] a sufficiently long acceptance criterion line\n" +
      "## DoD\n- [x] a sufficiently long definition-of-done line\n";
    // Pure-data fixture → store write.
    seedTask(schemaTasksDir, "SCH-001", { title: "Schema test task", status: "todo", body: MINIMAL_BODY });

    const { client: coreSchema } = await connectStdio("node", [coreBin, "mcp"], schemaWorkspaceRoot);
    try {

    // QX-010: listTools() response includes all 6 expected tools.
    const toolsResult = await coreSchema.listTools();
    const tools = toolsResult.tools ?? [];
    const toolNames = tools.map((t) => t.name);
    const EXPECTED_TOOLS = ["task_list", "task_get", "task_write", "task_check", "action_list", "action_run"];
    for (const name of EXPECTED_TOOLS) {
      assert(
        toolNames.includes(name),
        `tools/list includes expected tool: ${name}`
      );
    }

    // QX-010: task_list inputSchema includes 'prefix' as a string property.
    const taskListTool = tools.find((t) => t.name === "task_list");
    assert(
      !!taskListTool,
      "tools/list contains 'task_list' tool definition"
    );
    if (taskListTool) {
      const props = taskListTool.inputSchema?.properties ?? {};
      assert(
        "prefix" in props,
        "task_list inputSchema.properties includes 'prefix' (CB-011: stale session snapshot had this missing)"
      );
      assert(
        props.prefix?.type === "string" || props.prefix?.anyOf?.some?.((x) => x.type === "string"),
        "task_list inputSchema.properties.prefix is declared as a string type"
      );
      // Also confirm the other expected parameters are present.
      assert("status" in props, "task_list inputSchema.properties includes 'status'");
      assert("label" in props, "task_list inputSchema.properties includes 'label'");
      assert("provider" in props, "task_list inputSchema.properties includes 'provider'");
    }

    // QX-008: task_list response objects include 'updatedAt' (file mtime in ms).
    const listResult = await coreSchema.callTool({ name: "task_list", arguments: {} });
    assert(listResult.isError !== true, "task_list for updatedAt test does not return isError:true");
    const listTasks = listResult.structuredContent?.tasks ?? [];
    assert(listTasks.length === 1, `task_list for updatedAt test returns exactly 1 seeded task (got ${listTasks.length})`);
    if (listTasks.length === 1) {
      const t = listTasks[0];
      assert(
        typeof t.updatedAt === "number" && t.updatedAt > 0,
        `task_list response includes 'updatedAt' as a positive number (ms since epoch) on each task (got: ${JSON.stringify(t.updatedAt)})`
      );
      assert(
        t.id === "SCH-001",
        "task_list response returns the seeded SCH-001 task"
      );
    }

    } finally {
      await coreSchema.close();
    }
    fs.rmSync(schemaTasksDir, { recursive: true, force: true });
    fs.rmSync(schemaWorkspaceRoot, { recursive: true, force: true });
  }

  // ---- Block 14: QX-029 (experiment 4, iteration 8) — task_list search
  //      parameter (CB-014 partial). ----
  //
  // task_list now supports an optional `search` parameter: case-insensitive
  // substring match on task title + body, with heading lines excluded from
  // the body match (same stripHeadings() logic as bin/quay.js + serve.js's
  // QX-028 heading-exclusion implementation).
  //
  // Fixture: a dedicated workspace with 3 tasks —
  //   SRCH-1: title "toggle feature", body prose only (no headings)
  //   SRCH-2: title "regular task", body = heading-only ("## Proposal\n## Plan")
  //   SRCH-3: title "another task", body prose containing "unique-xyzzy-prose"
  //
  // Assertions:
  //   a. search="toggle" returns SRCH-1, not SRCH-2 or SRCH-3 (title match)
  //   b. search="Proposal" returns NOTHING (heading excluded from match)
  //   c. search="unique-xyzzy-prose" returns SRCH-3 (prose body match)
  //   d. no search: returns all 3 tasks (no regression)
  //   e. listTools() schema includes 'search' in task_list.inputSchema.properties
  {
    const srchTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-srch-tasks-"));
    const srchWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-srch-workspace-"));
    fs.mkdirSync(path.join(srchWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(srchWorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir}"`,
        `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${srchTasksDir}"`,
        "",
      ].join("\n")
    );

    // Pure-data fixtures → store write (search-behavior distinction lives in body text).
    seedTask(srchTasksDir, "SRCH-1", { title: "toggle feature task", status: "todo",
      body: "## Proposal\nThis task is about toggling something.\n## Plan\nImplement the toggle.\n## AC\n- [x] toggle works\n## DoD\n- [x] toggle is tested\n" });
    // SRCH-2: heading-only body — "Proposal" only appears in ## Proposal heading
    seedTask(srchTasksDir, "SRCH-2", { title: "regular task", status: "todo",
      body: "## Proposal\n## Plan\n## AC\n- [x] criterion\n## DoD\n- [x] done criterion\n" });
    // SRCH-3: prose body containing unique token
    seedTask(srchTasksDir, "SRCH-3", { title: "another task", status: "todo",
      body: "## Proposal\nContains unique-xyzzy-prose token in a prose line.\n## Plan\nN/A\n## AC\n- [x] criterion\n## DoD\n- [x] done criterion\n" });

    const { client: coreSrch } = await connectStdio("node", [coreBin, "mcp"], srchWorkspaceRoot);
    try {

    // (a) search="toggle" — title match on SRCH-1 only
    {
      const r = await coreSrch.callTool({ name: "task_list", arguments: { search: "toggle" } });
      assert(r.isError !== true, "task_list with search='toggle' does not return isError:true");
      const ids = (r.structuredContent?.tasks ?? []).map((t) => t.id);
      assert(ids.includes("SRCH-1"), "task_list search='toggle' includes SRCH-1 (title contains 'toggle feature task')");
      assert(!ids.includes("SRCH-2"), "task_list search='toggle' excludes SRCH-2 (no 'toggle' in title or prose body)");
      assert(!ids.includes("SRCH-3"), "task_list search='toggle' excludes SRCH-3 (no 'toggle' in title or prose body)");
    }

    // (b) search="Proposal" — heading excluded from match; all tasks use ## Proposal heading
    //     but NONE have "Proposal" as prose content → returns nothing
    {
      const r = await coreSrch.callTool({ name: "task_list", arguments: { search: "Proposal" } });
      assert(r.isError !== true, "task_list with search='Proposal' does not return isError:true");
      const tasks = r.structuredContent?.tasks ?? [];
      assert(
        tasks.length === 0,
        `task_list search='Proposal' returns 0 tasks (heading exclusion prevents ## Proposal from matching); got ${tasks.length} task(s): ${tasks.map(t => t.id).join(", ")}`
      );
    }

    // (c) search="unique-xyzzy-prose" — prose body match on SRCH-3 only
    {
      const r = await coreSrch.callTool({ name: "task_list", arguments: { search: "unique-xyzzy-prose" } });
      assert(r.isError !== true, "task_list with search='unique-xyzzy-prose' does not return isError:true");
      const ids = (r.structuredContent?.tasks ?? []).map((t) => t.id);
      assert(ids.includes("SRCH-3"), "task_list search='unique-xyzzy-prose' includes SRCH-3 (prose body match)");
      assert(!ids.includes("SRCH-1"), "task_list search='unique-xyzzy-prose' excludes SRCH-1 (no match in title or prose body)");
      assert(!ids.includes("SRCH-2"), "task_list search='unique-xyzzy-prose' excludes SRCH-2 (no match in title or prose body)");
    }

    // (d) no search: returns all 3 tasks (no regression from search addition)
    {
      const r = await coreSrch.callTool({ name: "task_list", arguments: {} });
      assert(r.isError !== true, "task_list with no search returns no error (no regression)");
      const tasks = r.structuredContent?.tasks ?? [];
      assert(
        tasks.length === 3,
        `task_list with no search returns all 3 seeded tasks (no regression); got ${tasks.length}`
      );
    }

    // (e) listTools() schema includes 'search' in task_list.inputSchema.properties
    {
      const toolsResult = await coreSrch.listTools();
      const taskListTool = (toolsResult.tools ?? []).find((t) => t.name === "task_list");
      assert(!!taskListTool, "listTools() includes task_list tool definition (QX-029 schema check)");
      if (taskListTool) {
        const props = taskListTool.inputSchema?.properties ?? {};
        assert(
          "search" in props,
          "task_list inputSchema.properties includes 'search' (QX-029: search parameter registered)"
        );
        assert(
          props.search?.type === "string" || props.search?.anyOf?.some?.((x) => x.type === "string"),
          "task_list inputSchema.properties.search is declared as a string type"
        );
      }
    }

    } finally {
      await coreSrch.close();
    }
    fs.rmSync(srchTasksDir, { recursive: true, force: true });
    fs.rmSync(srchWorkspaceRoot, { recursive: true, force: true });
  }

  // ---- Block 15: QX-030 (experiment 4, iteration 8) — task_list
  //      page/pageSize pagination (CB-010, UQ-008). ----
  //
  // task_list now supports optional `page` (1-based, default 1) and
  // `pageSize` (default 50, max 200) parameters. Applied after all other
  // filters. Response structuredContent includes `total`, `page`,
  // `pageSize`, and `totalPages` alongside the `tasks` array.
  //
  // Fixture: a dedicated workspace with 4 tasks (PAG-1..PAG-4), all todo,
  // with unique title tokens for combined search+pagination test.
  //
  // Assertions:
  //   a. Default (no page/pageSize): structuredContent has total=4 metadata
  //   b. page=1, pageSize=2: returns PAG-1 and PAG-2 (first 2)
  //   c. page=2, pageSize=2: returns PAG-3 and PAG-4 (second 2)
  //   d. totalPages = ceil(total/pageSize) = ceil(4/2) = 2
  //   e. page beyond last page: returns empty tasks array, total still accurate
  //   f. pagination applies AFTER filters: search for "pag-special" (only PAG-4
  //      has this in title), page=1, pageSize=2 → total=1, tasks=[PAG-4]
  //   g. listTools() schema includes 'page' and 'pageSize' in task_list
  {
    const pagTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-pag-tasks-"));
    const pagWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-pag-workspace-"));
    fs.mkdirSync(path.join(pagWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(pagWorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir}"`,
        `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${pagTasksDir}"`,
        "",
      ].join("\n")
    );

    const PAG_BODY =
      "## Proposal\nPagination fixture task.\n## Plan\nN/A\n## AC\n- [x] criterion\n## DoD\n- [x] done criterion\n";

    // Pure-data fixtures → store write.
    for (const id of ["PAG-1", "PAG-2", "PAG-3"]) {
      seedTask(pagTasksDir, id, { title: `Pagination task ${id}`, status: "todo", body: PAG_BODY });
    }
    // PAG-4 has a unique title token for combined search+pagination test
    seedTask(pagTasksDir, "PAG-4", { title: "pag-special token task", status: "todo", body: PAG_BODY });

    const { client: corePag } = await connectStdio("node", [coreBin, "mcp"], pagWorkspaceRoot);
    try {

    // (a) default: structuredContent has total=4, page=1, pageSize=50 metadata
    {
      const r = await corePag.callTool({ name: "task_list", arguments: {} });
      assert(r.isError !== true, "task_list with no pagination params returns no error");
      const sc = r.structuredContent ?? {};
      assert(sc.total === 4, `default task_list total=4 (got ${sc.total})`);
      assert(sc.page === 1, `default task_list page=1 (got ${sc.page})`);
      assert(sc.pageSize === 50, `default task_list pageSize=50 (got ${sc.pageSize})`);
      assert(Array.isArray(sc.tasks), "default task_list returns tasks array in structuredContent");
      assert(
        sc.tasks.length === 4,
        `default task_list returns all 4 tasks (pageSize=50 > 4 total) (got ${sc.tasks.length})`
      );
      assert(
        typeof sc.totalPages === "number",
        `default task_list includes totalPages field (got ${JSON.stringify(sc.totalPages)})`
      );
    }

    // (b) page=1, pageSize=2: returns first 2 tasks
    {
      const r = await corePag.callTool({ name: "task_list", arguments: { page: 1, pageSize: 2 } });
      assert(r.isError !== true, "task_list page=1 pageSize=2 returns no error");
      const sc = r.structuredContent ?? {};
      assert(sc.total === 4, `page=1,pageSize=2: total=4 (got ${sc.total})`);
      assert(sc.page === 1, `page=1,pageSize=2: page=1 (got ${sc.page})`);
      assert(sc.pageSize === 2, `page=1,pageSize=2: pageSize=2 (got ${sc.pageSize})`);
      assert(sc.totalPages === 2, `page=1,pageSize=2: totalPages=2 (ceil(4/2)) (got ${sc.totalPages})`);
      assert((sc.tasks ?? []).length === 2, `page=1,pageSize=2: returns 2 tasks (got ${(sc.tasks ?? []).length})`);
    }

    // (c) page=2, pageSize=2: returns next 2 tasks (disjoint from page 1)
    {
      const r1 = await corePag.callTool({ name: "task_list", arguments: { page: 1, pageSize: 2 } });
      const r2 = await corePag.callTool({ name: "task_list", arguments: { page: 2, pageSize: 2 } });
      const ids1 = (r1.structuredContent?.tasks ?? []).map((t) => t.id);
      const ids2 = (r2.structuredContent?.tasks ?? []).map((t) => t.id);
      assert(
        ids2.length === 2,
        `page=2,pageSize=2: returns 2 tasks (got ${ids2.length})`
      );
      const overlap = ids1.filter((id) => ids2.includes(id));
      assert(
        overlap.length === 0,
        `page=1 and page=2 (pageSize=2) return disjoint task sets (overlap: ${overlap.join(", ")})`
      );
      assert(
        r2.structuredContent?.totalPages === 2,
        `page=2,pageSize=2: totalPages=2 (got ${r2.structuredContent?.totalPages})`
      );
    }

    // (d) page beyond last: empty tasks array, total still reflects filtered count
    {
      const r = await corePag.callTool({ name: "task_list", arguments: { page: 99, pageSize: 2 } });
      assert(r.isError !== true, "task_list page=99 (beyond last) returns no error");
      const sc = r.structuredContent ?? {};
      assert(sc.total === 4, `page=99,pageSize=2: total still 4 (got ${sc.total})`);
      assert((sc.tasks ?? []).length === 0, `page=99,pageSize=2: tasks array is empty (beyond last page) (got ${(sc.tasks ?? []).length})`);
    }

    // (e) search + pagination: filter first, then page
    {
      const r = await corePag.callTool({
        name: "task_list",
        arguments: { search: "pag-special", page: 1, pageSize: 2 },
      });
      assert(r.isError !== true, "task_list search+pagination returns no error");
      const sc = r.structuredContent ?? {};
      assert(sc.total === 1, `search='pag-special' + pagination: total=1 (only PAG-4 matches) (got ${sc.total})`);
      assert((sc.tasks ?? []).length === 1, `search='pag-special' + pagination: 1 task returned (got ${(sc.tasks ?? []).length})`);
      const returnedId = (sc.tasks ?? [])[0]?.id;
      assert(returnedId === "PAG-4", `search='pag-special' returns PAG-4 (got ${returnedId})`);
    }

    // (f) listTools() schema includes 'page' and 'pageSize'
    {
      const toolsResult = await corePag.listTools();
      const taskListTool = (toolsResult.tools ?? []).find((t) => t.name === "task_list");
      assert(!!taskListTool, "listTools() includes task_list (QX-030 schema check)");
      if (taskListTool) {
        const props = taskListTool.inputSchema?.properties ?? {};
        assert("page" in props, "task_list inputSchema.properties includes 'page' (QX-030)");
        assert("pageSize" in props, "task_list inputSchema.properties includes 'pageSize' (QX-030)");
      }
    }

    } finally {
      await corePag.close();
    }
    fs.rmSync(pagTasksDir, { recursive: true, force: true });
    fs.rmSync(pagWorkspaceRoot, { recursive: true, force: true });
  }

  // ---- Block 16: QX-032 (experiment 4, iteration 9) — task_list multi-label
  //      AND-join filter parity (CB-015). ----
  //
  // task_list now accepts `label` as either an array of strings (AND-join) or
  // a single string (backward-compat). This closes CB-015: CLI and Web UI both
  // support multi-label AND-filtering; MCP previously only accepted a single string.
  //
  // Fixture: a workspace with 4 tasks carrying various label combinations:
  //   MLT-1: labels ["experiment-4", "iteration-5"]
  //   MLT-2: labels ["experiment-4", "iteration-9"]
  //   MLT-3: labels ["experiment-4"]
  //   MLT-4: labels ["iteration-9"]
  //
  // Assertions:
  //   a. label: ["experiment-4", "iteration-9"] → returns only MLT-2 (BOTH labels)
  //   b. label: ["experiment-4"] (single-element array) → MLT-1, MLT-2, MLT-3 (3 tasks)
  //   c. label: "experiment-4" (string, backward-compat) → same as (b)
  //   d. label: [] (empty array) → no filter applied; all 4 tasks returned
  //   e. listTools() schema shows label as accepting array type
  {
    const mltTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-mlt-tasks-"));
    const mltWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-mlt-workspace-"));
    fs.mkdirSync(path.join(mltWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(mltWorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir}"`,
        `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${mltTasksDir}"`,
        "",
      ].join("\n")
    );

    const MLT_BODY = "## Proposal\nMulti-label fixture.\n## AC\n- [x] ok\n## DoD\n- [x] done\n";

    // Pure-data fixtures (labels as plain arrays) → store write.
    seedTask(mltTasksDir, "MLT-1", { title: "Multi-label task 1", status: "todo", body: MLT_BODY, labels: ["experiment-4", "iteration-5"] });
    seedTask(mltTasksDir, "MLT-2", { title: "Multi-label task 2", status: "todo", body: MLT_BODY, labels: ["experiment-4", "iteration-9"] });
    seedTask(mltTasksDir, "MLT-3", { title: "Multi-label task 3", status: "todo", body: MLT_BODY, labels: ["experiment-4"] });
    seedTask(mltTasksDir, "MLT-4", { title: "Multi-label task 4", status: "todo", body: MLT_BODY, labels: ["iteration-9"] });

    const { client: coreMlt } = await connectStdio("node", [coreBin, "mcp"], mltWorkspaceRoot);
    try {

    // (a) AND-join: label array with 2 elements — only MLT-2 has both
    {
      const r = await coreMlt.callTool({
        name: "task_list",
        arguments: { label: ["experiment-4", "iteration-9"] },
      });
      assert(r.isError !== true, "task_list label=['experiment-4','iteration-9'] returns no error (QX-032)");
      const sc = r.structuredContent ?? {};
      const ids = (sc.tasks ?? []).map((t) => t.id).sort();
      assert(ids.length === 1, `AND-join filter: exactly 1 task has both labels (got ${JSON.stringify(ids)})`);
      assert(ids[0] === "MLT-2", `AND-join filter: that task is MLT-2 (got ${ids[0]})`);
    }

    // (b) single-element array: label: ["experiment-4"] → MLT-1, MLT-2, MLT-3
    {
      const r = await coreMlt.callTool({
        name: "task_list",
        arguments: { label: ["experiment-4"] },
      });
      assert(r.isError !== true, "task_list label=['experiment-4'] (single-element array) returns no error (QX-032)");
      const sc = r.structuredContent ?? {};
      const ids = (sc.tasks ?? []).map((t) => t.id).sort();
      assert(ids.length === 3, `single-element array label filter: 3 tasks have experiment-4 (got ${JSON.stringify(ids)})`);
      assert(ids.includes("MLT-1") && ids.includes("MLT-2") && ids.includes("MLT-3"),
        `single-element array: MLT-1/MLT-2/MLT-3 all returned (got ${JSON.stringify(ids)})`);
    }

    // (c) backward compat: label as string → same as (b)
    {
      const r = await coreMlt.callTool({
        name: "task_list",
        arguments: { label: "experiment-4" },
      });
      assert(r.isError !== true, "task_list label='experiment-4' (string, backward-compat) returns no error (QX-032)");
      const sc = r.structuredContent ?? {};
      const ids = (sc.tasks ?? []).map((t) => t.id).sort();
      assert(ids.length === 3, `string label (backward-compat): 3 tasks have experiment-4 (got ${JSON.stringify(ids)})`);
    }

    // (d) empty array: label: [] → no filter, all 4 tasks
    {
      const r = await coreMlt.callTool({
        name: "task_list",
        arguments: { label: [] },
      });
      assert(r.isError !== true, "task_list label=[] (empty array) returns no error (QX-032)");
      const sc = r.structuredContent ?? {};
      assert((sc.tasks ?? []).length === 4, `label=[] returns all 4 tasks (no filter) (got ${(sc.tasks ?? []).length})`);
    }

    // (e) schema check: listTools() shows label parameter
    {
      const toolsResult = await coreMlt.listTools();
      const taskListTool = (toolsResult.tools ?? []).find((t) => t.name === "task_list");
      assert(!!taskListTool, "listTools() includes task_list (QX-032 schema check)");
      if (taskListTool) {
        const props = taskListTool.inputSchema?.properties ?? {};
        assert("label" in props, "task_list inputSchema.properties includes 'label' (QX-032)");
      }
    }

    } finally {
      await coreMlt.close();
    }
    fs.rmSync(mltTasksDir, { recursive: true, force: true });
    fs.rmSync(mltWorkspaceRoot, { recursive: true, force: true });
  }

  // ---- Block 17: QX-035 (experiment 4, iteration 10) — task_list _version field
  //   and tool description Version: mitigation for ENV-001. ----
  {
    // AC4 (connection consolidation): this block is READ-ONLY and asserts only
    // the `_version` field + tool description — it has no store-wide count and
    // no writes — so it shares the primary `core` connection (default provider
    // "native" = tasksDirA, where VSN-1 was seeded at the top) instead of
    // spawning its own `quay mcp` subprocess. Isolation is preserved: no other
    // assertion depends on the exact task set in tasksDirA (all are id-scoped),
    // and VSN-1 is never written to by any other block.
    // (a) task_list response includes _version field (string, non-empty) — Mitigation A
    {
      const r = await core.callTool({
        name: "task_list",
        arguments: {},
      });
      assert(r.isError !== true, "task_list returns no error (QX-035 _version check)");
      const sc = r.structuredContent ?? {};
      assert(typeof sc._version === "string", `task_list structuredContent._version is a string (got ${typeof sc._version}) (QX-035)`);
      assert(sc._version.length > 0, `task_list structuredContent._version is non-empty (got '${sc._version}') (QX-035)`);
    }

    // (b) task_list tool description includes "Version:" — Mitigation B
    {
      const toolsResult = await core.listTools();
      const taskListTool = (toolsResult.tools ?? []).find((t) => t.name === "task_list");
      assert(!!taskListTool, "listTools() includes task_list (QX-035 description check)");
      if (taskListTool) {
        assert(
          (taskListTool.description ?? "").includes("Version:"),
          `task_list tool description includes "Version:" (QX-035) (got: "${(taskListTool.description ?? "").slice(0, 80)}")`
        );
      }
    }
  }

  // ---- Block 18: QX-042 (experiment 4, iteration 11) — pagination edge cases (SH-004) ----
  //
  // Regression-protects three pagination contract edge cases identified by G3
  // PASS-WITH-NOTES (iteration 8) that were previously not test-locked:
  //
  //   (a) empty result set: total=0 → totalPages=0 (Math.ceil(0/50)=0; deterministic).
  //       Documents and locks this as the API contract. If future code changes
  //       normalise to totalPages=1, this test catches the regression.
  //   (b) pageSize=0 → clamped to 1 by Math.max(1, ...). No error; tasks returned.
  //   (c) pageSize=201 → clamped to 200 by Math.min(200, ...). Tasks array bounded.
  //
  // Fixture: a fresh workspace with a small number of tasks (3) for clamping tests.
  {
    const qx42TasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-qx42-tasks-"));
    const qx42WorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-qx42-workspace-"));
    fs.mkdirSync(path.join(qx42WorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(qx42WorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir}"`,
        `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${qx42TasksDir}"`,
        "",
      ].join("\n")
    );

    const QX42_BODY = "## Proposal\nEdge case fixture.\n## AC\n- [x] done\n## DoD\n- [x] done\n";

    // Create 3 tasks for clamping assertions. Pure-data fixtures → store write.
    for (let i = 1; i <= 3; i++) {
      seedTask(qx42TasksDir, `QX42-${i}`, { title: `Edge case task ${i}`, status: "todo", body: QX42_BODY });
    }

    const { client: coreQx42, transport: coreQx42Transport } = await connectStdio(
      "node", [coreBin, "mcp"], qx42WorkspaceRoot
    );
    try {

    // (a) empty result: filter to non-existent status → total=0, totalPages=0
    {
      const r = await coreQx42.callTool({ name: "task_list", arguments: { status: "nonexistent-status-xyz" } });
      assert(r.isError !== true, "task_list with non-matching status returns no error (QX-042 empty case)");
      const sc = r.structuredContent ?? {};
      assert(sc.total === 0, `empty result: total=0 (got ${sc.total}) (SH-004, QX-042)`);
      assert((sc.tasks ?? []).length === 0, `empty result: tasks=[] (got ${(sc.tasks ?? []).length}) (SH-004, QX-042)`);
      assert(sc.totalPages === 0, `empty result: totalPages=0 (Math.ceil(0/50)=0) (SH-004, QX-042 — documents API contract)`);
    }

    // (b) pageSize=0 → treated as default (50) by the `|| 50` fallback in mcp-server.js.
    // The expression `Math.min(200, Math.max(1, parseInt(pageSize) || 50))` evaluates
    // parseInt(0)=0, and 0||50=50 (0 is falsy), so pageSize=0 yields 50 not 1.
    // This test documents and regression-locks that actual behavior (SH-004, QX-042).
    {
      const r = await coreQx42.callTool({ name: "task_list", arguments: { pageSize: 0 } });
      assert(r.isError !== true, "task_list with pageSize=0 returns no error (QX-042 clamp-low)");
      const sc = r.structuredContent ?? {};
      assert(sc.pageSize === 50, `pageSize=0 treated as default 50 (parseInt(0)||50=50) (got ${sc.pageSize}) (SH-004, QX-042 — documents actual behavior)`);
      assert(sc.total === 3, `pageSize=0 as default: all 3 tasks present in total (got ${sc.total}) (SH-004, QX-042)`);
    }

    // (c) pageSize=201 → clamped to 200 by Math.min(200, ...)
    {
      const r = await coreQx42.callTool({ name: "task_list", arguments: { pageSize: 201 } });
      assert(r.isError !== true, "task_list with pageSize=201 returns no error (QX-042 clamp-high)");
      const sc = r.structuredContent ?? {};
      assert(sc.pageSize === 200, `pageSize=201 clamped to 200 (got ${sc.pageSize}) (SH-004, QX-042)`);
      assert(sc.total === 3, `pageSize=201 clamped: all 3 tasks present in total (got ${sc.total}) (SH-004, QX-042)`);
    }

    } finally {
      await coreQx42.close();
    }
    fs.rmSync(qx42TasksDir, { recursive: true, force: true });
    fs.rmSync(qx42WorkspaceRoot, { recursive: true, force: true });
  }

  // ---- Block 19: QX-044 (experiment 4, iteration 12) — mcp-server.js inFence fix (SH-005) ----
  //
  // QX-041 (iteration 11) fixed serve.js's stripHeadings() to track inFence state so that
  // `# comment` lines inside fenced code blocks are NOT stripped from the search index.
  // SH-005 (G3 audit, iteration 11) found that mcp-server.js's INLINE copy of stripHeadings()
  // was not updated by QX-041 — the MCP task_list search still stripped # lines inside fences.
  // QX-044 syncs the fix to mcp-server.js.
  //
  // Fixture: a workspace with 2 tasks —
  //   FENCE-1: body contains `# bash-comment-token` INSIDE a fenced code block
  //            → search for "bash-comment-token" must MATCH (not stripped in fence)
  //   FENCE-2: body has `## Proposal-outside-fence` heading OUTSIDE any fence
  //            → search for "Proposal-outside-fence" must NOT MATCH (heading stripped)
  // The FENCE-1/FENCE-2 fixture tasks live in tasksDirA (seeded at the top) and
  // this block reuses the shared `core` connection (see AC4 comment below).
  {

    // AC4 (connection consolidation): this block is READ-ONLY and search-scoped
    // (asserts only which ids a given search term returns) — no store-wide count,
    // no writes — so it shares the primary `core` connection (default provider
    // "native" = tasksDirA, where FENCE-1/FENCE-2 were seeded at the top) instead
    // of spawning its own `quay mcp` subprocess. Isolation preserved: the two
    // search terms match only FENCE-1/FENCE-2, so the presence of the other
    // tasksDirA tasks (MCP-A1/VSN-1/…) does not affect either assertion.

    // Positive: "bash-comment-token" is inside a fenced code block — must be findable
    {
      const r = await core.callTool({ name: "task_list", arguments: { search: "bash-comment-token" } });
      assert(r.isError !== true, "task_list search='bash-comment-token' returns no error (QX-044, SH-005)");
      const ids = (r.structuredContent?.tasks ?? []).map((t) => t.id);
      assert(
        ids.includes("FENCE-1"),
        `task_list search='bash-comment-token': FENCE-1 IS found (# inside fence not stripped) (SH-005, QX-044). Got: [${ids.join(", ")}]`
      );
    }

    // Negative: "Proposal-outside-fence" is a ## heading outside any fence — must NOT be findable
    {
      const r = await core.callTool({ name: "task_list", arguments: { search: "Proposal-outside-fence" } });
      assert(r.isError !== true, "task_list search='Proposal-outside-fence' returns no error (QX-044, SH-005)");
      const ids = (r.structuredContent?.tasks ?? []).map((t) => t.id);
      assert(
        !ids.includes("FENCE-2"),
        `task_list search='Proposal-outside-fence': FENCE-2 is NOT found (heading outside fence IS stripped) (SH-005, QX-044). Got: [${ids.join(", ")}]`
      );
    }
  }

  // All blocks that reuse the primary `core` connection (2-9, 17, 19) are done —
  // close it before the gate block, which needs its own workspace/connection
  // (write operations + default-cwd semantics tied to its own workspace root).
  // This is the `finally` of the try opened above block 2: same position, same
  // ordering (before the gate block), but now reached on every exit path.
  } finally {
    await core.close();
  }

  // ---- 12. QENG gate/lifecycle MCP tools (M53/exp5-M-GATE-MCP-PARITY-GAP) ----
  // gate_run, gate_log, lifecycle_complete, lifecycle_adjudicate,
  // lifecycle_promote, lifecycle_retreat -- one happy path + at least one
  // guarded-failure path each, against a fresh isolated workspace/task store.
  {
    const gateTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-gate-tasks-"));
    const gateWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-gate-workspace-"));
    fs.mkdirSync(path.join(gateWorkspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(gateWorkspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  native:",
        "    enabled: true",
        `    path: "${nativeProviderDir}"`,
        `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
        "    env:",
        `      QUAY_NATIVE_TASKS_DIR: "${gateTasksDir}"`,
        "",
      ].join("\n")
    );

    // GATE-PASS: status=ready, extra.acceptance is a trivially-true shell
    // command -- gate_run should PASS and lifecycle_complete should advance
    // it to done. GATE-FAIL: extra.acceptance is a trivially-false command.
    // GATE-TODO: status=todo (lifecycle_promote target + illegal-retreat target).
    // Pure-data fixtures (the acceptance meter lives in `extra`, expressed in one
    // store write instead of the CLI's create+edit pair) → store write.
    seedTask(gateTasksDir, "GATE-PASS", { title: "Gate MCP tool demo (pass)", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: "true" } });
    seedTask(gateTasksDir, "GATE-FAIL", { title: "Gate MCP tool demo (fail)", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: "false" } });
    seedTask(gateTasksDir, "GATE-TODO", { title: "Gate MCP tool demo (todo)", status: "todo", body: VALID_SECTIONS + AC_DOD_CHECKED });

    const { client: coreGate, transport: coreGateTransport } = await connectStdio(
      "node", [coreBin, "mcp"], gateWorkspaceRoot
    );
    // Declared OUTSIDE the try below so the `finally` can remove it even when an assertion throws
    // (it is created by the cwd-threading block further down; its own comment lives there).
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-gate-cwd-"));
    try {

    // gate_run: happy path (PASS).
    {
      const r = await coreGate.callTool({ name: "gate_run", arguments: { id: "GATE-PASS" } });
      assert(r.isError !== true, "gate_run on GATE-PASS returns no error");
      assert(r.structuredContent?.ok === true, `gate_run on GATE-PASS returns ok:true (got: ${JSON.stringify(r.structuredContent)})`);
    }
    // gate_run: guarded-failure path (meter FAIL is ok:false, not isError).
    {
      const r = await coreGate.callTool({ name: "gate_run", arguments: { id: "GATE-FAIL" } });
      assert(r.isError !== true, "gate_run on GATE-FAIL (failing meter) is NOT isError -- a gate FAIL is a normal successful call");
      assert(r.structuredContent?.ok === false, `gate_run on GATE-FAIL returns ok:false (got: ${JSON.stringify(r.structuredContent)})`);
    }
    // gate_run: unknown task id -> isError.
    {
      const r = await coreGate.callTool({ name: "gate_run", arguments: { id: "NOPE-999" } });
      assert(r.isError === true, "gate_run with an unknown task id returns isError:true");
    }

    // gate_run: cwd parameter threading (M94/DIR-046 regression guard).
    // The CLI path (quay gate --cwd) is already fixed via pinAcceptanceEnv in bin/quay.js.
    // These assertions target the MCP cwd parameter specifically.
    // (worktreeDir is created just above this try — see the declaration there.)
    // GATE-CWD-EXPLICIT: acceptance command checks that pwd equals worktreeDir (not gateWorkspaceRoot).
    // GATE-CWD-DEFAULT: acceptance command checks that pwd equals gateWorkspaceRoot (default).
    // Pure-data fixtures (the acceptance command lives in `extra`) → store write.
    seedTask(gateTasksDir, "GATE-CWD-EXPLICIT", { title: "Gate cwd explicit (MCP)", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: `test "$(pwd)" = "${worktreeDir}"` } });
    seedTask(gateTasksDir, "GATE-CWD-DEFAULT", { title: "Gate cwd default (MCP)", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: `test "$(pwd)" = "${gateWorkspaceRoot}"` } });

    // Assertion 1: explicit cwd wins (MCP path) -- gate runs in worktreeDir, not gateWorkspaceRoot.
    {
      const r = await coreGate.callTool({ name: "gate_run", arguments: { id: "GATE-CWD-EXPLICIT", cwd: worktreeDir } });
      assert(r.isError !== true, "gate_run with explicit cwd returns no error");
      assert(r.structuredContent?.ok === true, `gate_run with cwd:worktreeDir on GATE-CWD-EXPLICIT returns ok:true (ran in worktreeDir) (got: ${JSON.stringify(r.structuredContent)})`);
    }
    // Assertion 2: without cwd, gate runs in gateWorkspaceRoot (not worktreeDir) -> ok:false for GATE-CWD-EXPLICIT.
    {
      const r = await coreGate.callTool({ name: "gate_run", arguments: { id: "GATE-CWD-EXPLICIT" } });
      assert(r.isError !== true, "gate_run without cwd (on GATE-CWD-EXPLICIT) returns no error");
      assert(r.structuredContent?.ok === false, `gate_run without cwd on GATE-CWD-EXPLICIT returns ok:false (ran in gateWorkspaceRoot, not worktreeDir) (got: ${JSON.stringify(r.structuredContent)})`);
    }
    // Assertion 3: default -> workspaceRoot -- gate runs in gateWorkspaceRoot -> ok:true.
    {
      const r = await coreGate.callTool({ name: "gate_run", arguments: { id: "GATE-CWD-DEFAULT" } });
      assert(r.isError !== true, "gate_run with no cwd (GATE-CWD-DEFAULT) returns no error");
      assert(r.structuredContent?.ok === true, `gate_run with no cwd on GATE-CWD-DEFAULT returns ok:true (default is gateWorkspaceRoot) (got: ${JSON.stringify(r.structuredContent)})`);
    }
    // Note: the pre-set env case (QUAY_ACCEPTANCE_CWD already set in the outer process)
    // is structurally covered by the conditional `else if (!process.env.QUAY_ACCEPTANCE_CWD)`
    // branch and CLI-layer tests in gate-ergonomics.test.mjs -- not tested here to avoid
    // env-var isolation complexity in the MCP subprocess test.

    // gate_log: read back the two gate_run calls above (no append -- pure read).
    {
      const r = await coreGate.callTool({ name: "gate_log", arguments: { id: "GATE-PASS" } });
      assert(r.isError !== true, "gate_log on GATE-PASS returns no error");
      const events = r.structuredContent?.events ?? [];
      assert(
        events.length >= 1 && events[events.length - 1].verdict === "pass" && events[events.length - 1].gate === "acceptance",
        `gate_log on GATE-PASS returns the prior gate_run's pass GateEvent (got: ${JSON.stringify(events)})`
      );
    }
    {
      const r = await coreGate.callTool({ name: "gate_log", arguments: { id: "GATE-FAIL" } });
      const events = r.structuredContent?.events ?? [];
      assert(
        events.length >= 1 && events[events.length - 1].verdict === "fail",
        `gate_log on GATE-FAIL returns the prior gate_run's fail GateEvent (got: ${JSON.stringify(events)})`
      );
    }
    // gate_log: a task with no GateEvents yet -> empty array, no error.
    {
      const r = await coreGate.callTool({ name: "gate_log", arguments: { id: "GATE-TODO" } });
      assert(r.isError !== true, "gate_log on a task with no GateEvents returns no error");
      assert(Array.isArray(r.structuredContent?.events) && r.structuredContent.events.length === 0, "gate_log on GATE-TODO (no gate run yet) returns an empty events array");
    }

    // lifecycle_complete: happy path -- GATE-PASS (status=ready, meter true) -> done.
    {
      const r = await coreGate.callTool({ name: "lifecycle_complete", arguments: { id: "GATE-PASS" } });
      assert(r.isError !== true, "lifecycle_complete on GATE-PASS returns no error");
      assert(r.structuredContent?.ok === true, `lifecycle_complete on GATE-PASS returns ok:true (got: ${JSON.stringify(r.structuredContent)})`);
      const after = await coreGate.callTool({ name: "task_get", arguments: { id: "GATE-PASS" } });
      assert(after.structuredContent?.task?.status === "done", "lifecycle_complete on GATE-PASS persists status=done");
    }
    // lifecycle_complete: guarded-failure path -- GATE-TODO is not 'ready' -> ok:false, no write.
    {
      const r = await coreGate.callTool({ name: "lifecycle_complete", arguments: { id: "GATE-TODO" } });
      assert(r.isError !== true, "lifecycle_complete on a non-ready task (GATE-TODO) returns no error (a normal ok:false result)");
      assert(r.structuredContent?.ok === false, `lifecycle_complete on GATE-TODO (status=todo, not ready) returns ok:false (got: ${JSON.stringify(r.structuredContent)})`);
      const after = await coreGate.callTool({ name: "task_get", arguments: { id: "GATE-TODO" } });
      assert(after.structuredContent?.task?.status === "todo", "lifecycle_complete's precondition failure left GATE-TODO's status unchanged (todo)");
    }

    // lifecycle_adjudicate: read-only audit pass over the task's OWN
    // ready/done gate (client.taskCheck -- AC-checkbox based), NOT the
    // extra.acceptance meter gate_run/lifecycle_complete use -- so GATE-FAIL
    // (AC/DoD boxes are checked, meter is merely false) reports ok:true here;
    // it never writes status either way.
    {
      const r = await coreGate.callTool({ name: "lifecycle_adjudicate", arguments: { id: "GATE-FAIL" } });
      assert(r.isError !== true, "lifecycle_adjudicate on GATE-FAIL returns no error");
      assert(r.structuredContent?.ok === true, `lifecycle_adjudicate on GATE-FAIL reports ok:true (its check is the AC/DoD-checkbox gate, not the acceptance meter -- got: ${JSON.stringify(r.structuredContent)})`);
      const after = await coreGate.callTool({ name: "task_get", arguments: { id: "GATE-FAIL" } });
      assert(after.structuredContent?.task?.status === "ready", "lifecycle_adjudicate never writes status -- GATE-FAIL is still 'ready'");
    }
    // lifecycle_adjudicate: unknown task id -> isError.
    {
      const r = await coreGate.callTool({ name: "lifecycle_adjudicate", arguments: { id: "NOPE-999" } });
      assert(r.isError === true, "lifecycle_adjudicate with an unknown task id returns isError:true");
    }

    // lifecycle_promote: happy path -- GATE-TODO (todo) -> ready via the 'dod' gate.
    {
      const r = await coreGate.callTool({ name: "lifecycle_promote", arguments: { id: "GATE-TODO" } });
      assert(r.isError !== true, "lifecycle_promote on GATE-TODO returns no error");
      assert(r.structuredContent?.ok === true && r.structuredContent?.to === "ready", `lifecycle_promote on GATE-TODO (todo, AC/DoD checked) advances to 'ready' (got: ${JSON.stringify(r.structuredContent)})`);
      const after = await coreGate.callTool({ name: "task_get", arguments: { id: "GATE-TODO" } });
      assert(after.structuredContent?.task?.status === "ready", "lifecycle_promote persisted GATE-TODO's new status (ready)");
    }
    // lifecycle_promote: guarded-failure path -- GATE-TODO is now 'ready';
    // promoting again with a failing meter needs a fresh meter — reuse
    // GATE-FAIL (still 'ready', meter false): promote delegates to complete,
    // which should report ok:false, status unchanged.
    {
      const r = await coreGate.callTool({ name: "lifecycle_promote", arguments: { id: "GATE-FAIL" } });
      assert(r.isError !== true, "lifecycle_promote on GATE-FAIL (ready, failing meter) returns no error (a normal ok:false result)");
      assert(r.structuredContent?.ok === false && r.structuredContent?.to === null, `lifecycle_promote on GATE-FAIL reports ok:false, to:null (delegates to complete, meter fails) (got: ${JSON.stringify(r.structuredContent)})`);
    }
    // lifecycle_promote: illegal forward edge -- GATE-PASS is already 'done' -> isError.
    {
      const r = await coreGate.callTool({ name: "lifecycle_promote", arguments: { id: "GATE-PASS" } });
      assert(r.isError === true, "lifecycle_promote on an already-'done' task (no forward edge) returns isError:true");
      assert(/illegal transition/.test(r.content?.[0]?.text ?? ""), `lifecycle_promote's illegal-edge error names the illegal transition (got: ${r.content?.[0]?.text})`);
    }

    // lifecycle_retreat: happy path -- GATE-TODO is now 'ready'; retreat -> todo.
    {
      const r = await coreGate.callTool({ name: "lifecycle_retreat", arguments: { id: "GATE-TODO", reason: "M53 test: exercising retreat" } });
      assert(r.isError !== true, "lifecycle_retreat on GATE-TODO (ready) returns no error");
      assert(r.structuredContent?.ok === true && r.structuredContent?.to === "todo", `lifecycle_retreat on GATE-TODO (ready) rolls back to 'todo' (got: ${JSON.stringify(r.structuredContent)})`);
      const after = await coreGate.callTool({ name: "task_get", arguments: { id: "GATE-TODO" } });
      assert(after.structuredContent?.task?.status === "todo", "lifecycle_retreat persisted GATE-TODO's rolled-back status (todo)");
    }
    // lifecycle_retreat: illegal backward edge -- GATE-TODO is 'todo' (no back edge) -> isError.
    {
      const r = await coreGate.callTool({ name: "lifecycle_retreat", arguments: { id: "GATE-TODO", reason: "attempting an illegal retreat" } });
      assert(r.isError === true, "lifecycle_retreat on a 'todo' task (no backward edge) returns isError:true");
      assert(/illegal transition/.test(r.content?.[0]?.text ?? ""), `lifecycle_retreat's illegal-edge error names the illegal transition (got: ${r.content?.[0]?.text})`);
    }
    // lifecycle_retreat: missing `reason` is rejected at the MCP input-schema
    // level (zod z.string().min(1)) before the handler runs -- the SDK's
    // own validateToolInput() surfaces this as isError:true with an
    // "Input validation error" message (NOT a rejected/thrown callTool()
    // promise -- confirmed directly against this SDK version), so the
    // handler (and thus runRetreat's own internal empty-reason guard) never
    // executes.
    {
      const r = await coreGate.callTool({ name: "lifecycle_retreat", arguments: { id: "GATE-FAIL" } });
      assert(r.isError === true, "lifecycle_retreat with no `reason` argument returns isError:true (rejected by MCP input validation before the handler runs)");
      assert(
        /Input validation error/.test(r.content?.[0]?.text ?? ""),
        `the missing-reason rejection is an MCP input-validation error, not runRetreat's own internal guard (got: ${r.content?.[0]?.text})`
      );
    }

    // DIR-086: verify lifecycle functions return exitCode in structuredContent
    // and that MCP handlers reset process.exitCode (long-running server context).
    // After a lifecycle_complete on a failing task, exitCode should be 1 in the
    // structuredContent (mirroring what process.exitCode was set to), and the
    // server should still be alive + responsive for the next call.
    {
      // (a) lifecycle_complete on GATE-FAIL (acceptance=false) -> ok:false, exitCode:1
      const r = await coreGate.callTool({ name: "lifecycle_complete", arguments: { id: "GATE-FAIL" } });
      assert(r.isError !== true, "DIR-086 lifecycle_complete on GATE-FAIL returns no error");
      assert(r.structuredContent?.ok === false, `DIR-086 lifecycle_complete on GATE-FAIL returns ok:false (got: ${JSON.stringify(r.structuredContent)})`);
      assert(r.structuredContent?.exitCode === 1, `DIR-086 lifecycle_complete on GATE-FAIL returns exitCode:1 in structuredContent (got: ${JSON.stringify(r.structuredContent)})`);

      // (b) After a failing lifecycle_complete, the server is still alive and responsive —
      // proof that the MCP handler reset process.exitCode (otherwise Node would have
      // a stale exit code and the process would eventually exit with that code).
      const r2 = await coreGate.callTool({ name: "gate_log", arguments: { id: "GATE-FAIL" } });
      assert(r2.isError !== true, "DIR-086 gate_log after failing lifecycle_complete succeeds — MCP server is still alive (exitCode was reset)");
      assert(Array.isArray(r2.structuredContent?.events), "DIR-086 gate_log after failing lifecycle_complete returns events array as expected");
    }

    // DIR-084: env-var-unchanged after lifecycle_complete and lifecycle_promote.
    // Pre-set QUAY_ACCEPTANCE_CWD to a distinct temp dir, call lifecycle handlers,
    // then verify the env var was restored by running a gate on a task whose
    // acceptance command checks that pwd matches the pre-set temp dir.
    // If QUAY_ACCEPTANCE_CWD was NOT restored (old bug), the gate would see
    // cfg.workspaceRoot instead and the pwd check would fail.
    {
      const presetCwdDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-env-preset-cwd-"));
      const envPresetTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-env-preset-tasks-"));
      const envPresetWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-env-preset-workspace-"));
      fs.mkdirSync(path.join(envPresetWorkspaceRoot, ".quay"), { recursive: true });
      fs.writeFileSync(
        path.join(envPresetWorkspaceRoot, ".quay", "config.yml"),
        [
          "providers:",
          "  native:",
          "    enabled: true",
          `    path: "${nativeProviderDir}"`,
          `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
          "    env:",
          `      QUAY_NATIVE_TASKS_DIR: "${envPresetTasksDir}"`,
          "",
        ].join("\n")
      );

      // ENV-LC: ready, acceptance=true -- for lifecycle_complete.
      // ENV-LP: todo, AC/DoD checked -- for lifecycle_promote.
      // ENV-CWD: ready, acceptance checks that pwd == presetCwdDir.
      // Pure-data fixtures (acceptance command lives in `extra`) → store write.
      seedTask(envPresetTasksDir, "ENV-LC", { title: "Env LC test (DIR-084)", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: "true" } });
      seedTask(envPresetTasksDir, "ENV-LP", { title: "Env LP test (DIR-084)", status: "todo", body: VALID_SECTIONS + AC_DOD_CHECKED });
      seedTask(envPresetTasksDir, "ENV-CWD", { title: "Env CWD check (DIR-084)", status: "ready", body: VALID_SECTIONS + AC_DOD_CHECKED, extra: { acceptance: `test "$(pwd)" = "${presetCwdDir}"` } });

      // Start quay mcp with QUAY_ACCEPTANCE_CWD pre-set to presetCwdDir.
      const { client: coreEnv, transport: coreEnvTransport } = await connectStdio(
        "node", [coreBin, "mcp"], envPresetWorkspaceRoot,
        { QUAY_ACCEPTANCE_CWD: presetCwdDir }
      );
      try {

      // (a) lifecycle_complete: call on ENV-LC (ready, acceptance=true) -> should complete.
      {
        const r = await coreEnv.callTool({ name: "lifecycle_complete", arguments: { id: "ENV-LC" } });
        assert(r.isError !== true, "DIR-084 lifecycle_complete on ENV-LC returns no error");
        assert(r.structuredContent?.ok === true, `DIR-084 lifecycle_complete on ENV-LC (acceptance=true) returns ok:true (got: ${JSON.stringify(r.structuredContent)})`);
      }

      // (b) After lifecycle_complete, verify QUAY_ACCEPTANCE_CWD was restored.
      // gate_run on ENV-CWD (no explicit cwd): if env was restored, pwd==presetCwdDir -> ok.
      {
        const r = await coreEnv.callTool({ name: "gate_run", arguments: { id: "ENV-CWD" } });
        assert(r.isError !== true, "DIR-084 gate_run on ENV-CWD after lifecycle_complete returns no error");
        assert(r.structuredContent?.ok === true, `DIR-084 after lifecycle_complete, QUAY_ACCEPTANCE_CWD was restored: gate_run sees presetCwdDir (got: ${JSON.stringify(r.structuredContent)})`);
      }

      // Reset ENV-CWD: the gate_run above saved/restored its own env var (gate_run also does
      // save/restore), so ENV-CWD can be reused for the lifecycle_promote test below.
      // But the task's status is still "ready" after the gate_run (gate_run doesn't change status).

      // (c) lifecycle_promote: call on ENV-LP (todo, AC/DoD checked) -> should promote to ready.
      {
        const r = await coreEnv.callTool({ name: "lifecycle_promote", arguments: { id: "ENV-LP" } });
        assert(r.isError !== true, "DIR-084 lifecycle_promote on ENV-LP returns no error");
        assert(r.structuredContent?.ok === true && r.structuredContent?.to === "ready", `DIR-084 lifecycle_promote on ENV-LP (todo, AC/DoD checked) advances to ready (got: ${JSON.stringify(r.structuredContent)})`);
      }

      // (d) After lifecycle_promote, verify QUAY_ACCEPTANCE_CWD was restored again.
      {
        const r = await coreEnv.callTool({ name: "gate_run", arguments: { id: "ENV-CWD" } });
        assert(r.isError !== true, "DIR-084 gate_run on ENV-CWD after lifecycle_promote returns no error");
        assert(r.structuredContent?.ok === true, `DIR-084 after lifecycle_promote, QUAY_ACCEPTANCE_CWD was restored: gate_run sees presetCwdDir (got: ${JSON.stringify(r.structuredContent)})`);
      }

      } finally {
        await coreEnv.close();
      }
      fs.rmSync(presetCwdDir, { recursive: true, force: true });
      fs.rmSync(envPresetTasksDir, { recursive: true, force: true });
      fs.rmSync(envPresetWorkspaceRoot, { recursive: true, force: true });
    }

    // ---- gate_list (DIR-085): list registered gate names via MCP ----
    // Tests the new gate_list MCP tool added by DIR-085 (M143), which exposes
    // listGates() from the gate registry. Agents need this to discover available
    // gates without hardcoding names or inspecting files directly.
    {
      // (a) listTools() includes gate_list
      {
        const toolsResult = await coreGate.listTools();
        const toolNames = (toolsResult.tools ?? []).map((t) => t.name);
        assert(
          toolNames.includes("gate_list"),
          `listTools() includes 'gate_list' tool (DIR-085). Tools: [${toolNames.join(", ")}]`
        );
        const gateListTool = (toolsResult.tools ?? []).find((t) => t.name === "gate_list");
        assert(!!gateListTool, "gate_list tool definition is present in listTools()");
        if (gateListTool) {
          const props = gateListTool.inputSchema?.properties ?? {};
          assert("provider" in props, "gate_list inputSchema.properties includes 'provider' (DIR-085)");
        }
      }

      // (b) gate_list returns built-in gates (dod, acceptance) via default provider
      {
        const r = await coreGate.callTool({ name: "gate_list", arguments: {} });
        assert(r.isError !== true, "gate_list (default provider) returns no error (DIR-085)");
        const gates = r.structuredContent?.gates ?? [];
        assert(Array.isArray(gates), `gate_list returns gates array (got: ${JSON.stringify(r.structuredContent)})`);
        assert(
          gates.includes("dod"),
          `gate_list includes built-in 'dod' gate (got: [${gates.join(", ")}])`
        );
        assert(
          gates.includes("acceptance"),
          `gate_list includes built-in 'acceptance' gate (got: [${gates.join(", ")}])`
        );
      }

      // (c) gate_list works with explicit provider argument
      {
        const r = await coreGate.callTool({ name: "gate_list", arguments: { provider: "native" } });
        assert(r.isError !== true, "gate_list with provider='native' returns no error (DIR-085)");
        const gates = r.structuredContent?.gates ?? [];
        assert(
          gates.includes("dod") && gates.includes("acceptance"),
          `gate_list provider='native' includes dod and acceptance (got: [${gates.join(", ")}])`
        );
      }

      // (d) gate_list with unknown provider -> isError
      {
        const r = await coreGate.callTool({ name: "gate_list", arguments: { provider: "does-not-exist" } });
        assert(r.isError === true, "gate_list with unknown provider returns isError:true (DIR-085)");
      }
    }

    } finally {
      await coreGate.close();
      fs.rmSync(gateTasksDir, { recursive: true, force: true });
      fs.rmSync(gateWorkspaceRoot, { recursive: true, force: true });
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  }

  // ── AC4 (gap-quay-init-native-reconcile): a workspace whose `.quay/config.yml` is MISSING or
  // UNPARSEABLE must not take the whole MCP server down with it.
  //
  // Why this is a different input class from block 11 above (the broken-PROVIDER block): there the
  // config PARSED and a provider launch failed; here the config cannot be read at all. The startup
  // sequence used to be `loadConfig()` → `enabledProviderIds()` → `new McpServer()` → register
  // everything, both throwing steps BEFORE the server object existed ⇒ zero tools, and the MCP
  // client saw the process exit 1, indistinguishable from a crash — including for `init`, the one
  // tool whose job is to repair exactly this condition (硬规则 3b: "could not read the input" was
  // being reported with the shape of "there is nothing here").
  //
  // The three assertions below are the structural falsifier: (a) the server is reachable AT ALL,
  // (b) it lists the bootstrap tool, (c) that tool actually repairs the workspace. Re-point (b)/(c)
  // at any config-dependent tool and it goes red — e.g. `task_list` cannot be served in this
  // workspace, so a fix that merely kept the OLD registration order would fail here.
  // Both shapes of "no usable config" are exercised: the AC names them as one scenario
  // ("没有/损坏"), and they fail the startup sequence at DIFFERENT points (no file ⇒ `findConfig()`
  // walks to the filesystem root and returns null; unparseable file ⇒ the walk SUCCEEDS and the
  // parser throws), so a fix that only survives one of them would look complete.
  // shape -> the three-state value `classifyConfig` must report for it (the shape name describes the
  // INPUT; the state name describes the VERDICT, and they differ for the parser case on purpose —
  // "unparseable bytes" is reported as `corrupt`, the vocabulary every caller reads).
  for (const [shape, expectedState] of [["absent", "absent"], ["unparseable", "corrupt"]]) {
    const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), `quay-mcp-${shape}-cfg-`));
    fs.mkdirSync(path.join(brokenRoot, ".quay"), { recursive: true });
    if (shape === "unparseable") {
      // Not a config with a semantic problem (DIR-099-C's scope, deliberately not re-opened) — a
      // file the YAML parser cannot read at all.
      fs.writeFileSync(path.join(brokenRoot, ".quay", "config.yml"), "providers: [unclosed\n  bad: : :\n");
    } else {
      // ABSENT: remove the directory the walk would find, so findConfig() finds nothing at all.
      fs.rmdirSync(path.join(brokenRoot, ".quay"));
    }

    const { client: brokenCfgClient, transport: brokenCfgTransport } = await connectStdio(
      "node",
      [coreBin, "mcp"],
      brokenRoot
    );

    try {
      const toolsResult = await brokenCfgClient.listTools();
      const toolNames = (toolsResult.tools ?? []).map((t) => t.name);
      assert(
        toolNames.includes("init"),
        `AC4[${shape}]: a workspace with no usable .quay/config.yml still lists the bootstrap 'init' tool (got: [${toolNames.join(", ")}])`
      );
      assert(
        toolNames.includes("config_validate"),
        `AC4[${shape}]: the diagnostic 'config_validate' is registered on the degraded path too (got: [${toolNames.join(", ")}])`
      );

      // AC-330: the MCP tool's schema must NOT carry a reconcile property — the state of the target
      // decides, so there is nothing for the caller to select. (Read off the SCHEMA, not off a call
      // result: an argument the schema does not declare is simply dropped, so a passing call proves
      // nothing about whether the mode is still there.)
      const initTool = (toolsResult.tools ?? []).find((t) => t.name === "init");
      const initProps = Object.keys(initTool?.inputSchema?.properties ?? {});
      assert(
        !initProps.includes("reconcile"),
        `AC4[${shape}]: the MCP init schema must not declare \`reconcile\` (got: [${initProps.join(", ")}])`
      );
      assert(
        !initProps.includes("force"),
        `AC4[${shape}]: …nor the retired overwrite selector (got: [${initProps.join(", ")}])`
      );

      const repaired = await brokenCfgClient.callTool({
        name: "init",
        arguments: { root: brokenRoot },
      });
      assert(repaired.isError !== true, `AC4[${shape}]: init on the broken workspace succeeds (got: ${JSON.stringify(repaired.structuredContent)})`);
      assert(
        repaired.structuredContent?.configState === expectedState,
        `AC4[${shape}]: the repair reports the pre-state honestly (want ${expectedState}, got: ${repaired.structuredContent?.configState})`
      );

      // The SAME report document the CLI's `--json` prints (AC-330): one builder, so the two surfaces
      // cannot drift apart field by field. The field set is asserted here; init.test.mjs owns the
      // per-field semantics.
      for (const field of ["outcome", "configState", "dryRun", "validated", "issues", "warnings", "pluginLink"]) {
        assert(
          field in (repaired.structuredContent ?? {}),
          `AC4[${shape}]: the MCP report must carry \`${field}\` like the CLI's --json does (got: ${Object.keys(repaired.structuredContent ?? {}).join(", ")})`
        );
      }

      const cfgPath = path.join(brokenRoot, ".quay", "config.yml");
      const reparsed = YAML.parse(fs.readFileSync(cfgPath, "utf8"));
      assert(
        reparsed?.loop?.fork_baseline === "develop",
        `AC4[${shape}]: init wrote a PARSEABLE config carrying this version's defaults (loop.fork_baseline=${reparsed?.loop?.fork_baseline})`
      );
    } finally {
      await brokenCfgTransport.close();
      fs.rmSync(brokenRoot, { recursive: true, force: true });
    }
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
