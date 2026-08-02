// QN-048 (iteration 37): regression test for quay-github's own MCP stdio
// transport (packages/quay-github/src/mcp-server.js, wired into
// bin/quay-github.ts's `mcp` subcommand). Sibling gap to QN-034 (iteration
// 24), which closed the identical class of gap for quay-github.ts's CLI
// dispatch layer but explicitly named "the `mcp` subcommand (starting the
// stdio MCP transport)" as out of scope for that task -- this file closes
// exactly that named residual. Also the GitHub-Provider-side sibling of
// packages/quay/test/mcp-server.test.mjs (Core's own MCP transport test).
//
// Same live-repo constraint already established by this package's own
// write.test.mjs/cli.test.mjs header comments: the real yaleh/quay issue
// backlog is too small/precious to target with destructive live writes in
// an automated, repeatable test file. This file spawns the real
// `bin/quay-github.ts mcp` subprocess via a real MCP client
// (StdioClientTransport) and exercises only:
//   1. provider://manifest resource enumeration (correct `name` field).
//   2. task_list (json array, includes real issues #3/#4).
//   3. task_get for gh-3, cross-checked byte-identical against the direct
//      CLI's own `task get gh-3 --json` output.
//   4. task_get for an unknown id (isError:true, not a crash).
//   5. task_check for gh-3 and gh-4, cross-checked byte-identical against
//      the direct CLI's own `task check <id> --json` output for both.
//   6. task_write for an unknown id (isError:true) -- the only task_write
//      call this file ever makes; client.setStatus is never reached with a
//      real, existing task id, so no live write to any real GitHub issue
//      ever occurs.
//   7. (QN-064, iteration 60) task_list against a SEPARATE subprocess
//      started with a well-formed but unreachable owner/repo -- the fake gh
//      fails the paged-list call with gh's own "Not Found (HTTP 404)"
//      diagnostic, exercising list()'s completely unhandled fetchAllIssues()
//      failure path (github-client.js has no try/catch around it, unlike
//      get()'s already-caught not-found path). Distinct from QN-062
//      (iteration 58, Core's own Provider subprocess-STARTUP-crash angle via
//      a malformed QUAY_GITHUB_REPO value, caught before any gh api call)
//      and QN-063 (iteration 59, malformed input VALUE inside an existing
//      issue's body) -- this is a `gh api` call FAILING mid-session, against
//      quay-github's own MCP server (not Core's), from a Provider process
//      that started and connected successfully. Asserts isError:true and
//      that a second, independent call also returns isError:true (the
//      quay-github mcp process itself survives the failure).
//
// gap-suite-speedup (task gap-suite-speedup) — CONTRACT DECISION: as with
// cli.test.mjs, this file now runs against the fake `gh` executable
// (test/fixtures/fake-gh.mjs, PATH-shadowed), NOT the live yaleh/quay repo.
// The live-network dependence was the dominant wall-clock cost (30.6s in
// CI, ~12s here) and made the suite network-flaky; the fake gh makes every
// surface exercisable hermetically. Every assertion is preserved unchanged:
// task_list still yields gh-3/gh-4 (now the canned fixture issues), the
// MCP-vs-CLI byte-identical cross-checks still hold (both legs shell out to
// the same fake gh), the unknown-id / unknown-write error paths still
// isError, and QN-064's fetchAllIssues-failure path is still exercised (the
// fake gh fails the unreachable owner/repo with gh's own "Not Found (HTTP
// 404)" diagnostic). The residual "real CLI/MCP against real GitHub"
// coverage lives in the repo's opt-in live files (QUAY_TEST_LIVE_GITHUB=1).
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
const bin = path.join(__dirname, "..", "bin", "quay-github.ts");
const fakeGhScript = path.join(__dirname, "fixtures", "fake-gh.mjs");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

/** Build a fresh PATH-shadow dir containing exactly one executable named
 * `gh` that delegates to fixtures/fake-gh.mjs. A fresh dir per test run
 * avoids any cross-test/cross-process race on a shared shim location. */
function makeFakeGhPathDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-fake-gh-path-"));
  const shimPath = path.join(dir, "gh");
  fs.writeFileSync(
    shimPath,
    `#!/bin/sh\nexec node "${fakeGhScript}" "$@"\n`,
    { mode: 0o755 }
  );
  return dir;
}

// Canned fixture issues #3/#4 served by fake-gh.mjs for the yaleh/quay
// backing repo (same fixture as cli.test.mjs). Realistic enough to make
// check()/get() produce well-formed view-models; content is otherwise
// irrelevant to the assertions (which check id presence and byte-identical
// MCP-vs-CLI consistency, never specific live-repo content).
const FIXTURE_ISSUES = {
  3: {
    number: 3,
    title: "fixture issue 3",
    body:
      "## Proposal\nfixture proposal\n" +
      "## Plan\nfixture plan\n" +
      "## AC\n- [ ] an unchecked acceptance criterion\n" +
      "## DoD\n- [x] a checked definition of done\n",
    labels: [{ name: "status:ready" }],
    state: "open",
    pull_request: undefined,
    html_url: "https://github.com/yaleh/quay/issues/3",
    user: { login: "fixture-user" },
  },
  4: {
    number: 4,
    title: "fixture issue 4",
    body:
      "## Proposal\nfixture proposal\n" +
      "## Plan\nfixture plan\n" +
      "## AC\n- [x] a checked acceptance criterion\n" +
      "## DoD\n- [x] a checked definition of done\n",
    labels: [{ name: "status:ready" }],
    state: "open",
    pull_request: undefined,
    html_url: "https://github.com/yaleh/quay/issues/4",
    user: { login: "fixture-user" },
  },
};

const fakeGhDir = makeFakeGhPathDir();
// Base env shared by the main MCP client, the direct-CLI cross-checks, and
// the broken-repo client: PATH-shadowed fake gh + the canned fixture issues.
const repoEnv = {
  ...process.env,
  PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`,
  QUAY_GITHUB_REPO: "yaleh/quay",
  FAKE_GH_ISSUES_JSON: JSON.stringify(FIXTURE_ISSUES),
};

function cliJson(args) {
  const out = execFileSync("node", [bin, ...args], { env: repoEnv, encoding: "utf8" });
  return JSON.parse(out);
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [bin, "mcp"],
    cwd: __dirname,
    env: repoEnv,
  });
  const client = new Client({ name: "test-agent", version: "0.0.1" });
  await client.connect(transport);

  // NOTE (added iteration 75, CI-hang fix): everything from here to the
  // matching `finally` below MUST stay inside this try/finally. Without
  // it, any unexpected failure (different from the "unknown id"/
  // "unreachable repo" cases explicitly tested below) throws mid-`main()`
  // and skips `client.close()` entirely, leaving the child `quay-github
  // mcp` subprocess (and its stdio pipes) alive -- which hangs `node
  // --test` indefinitely (observed live in GitHub Actions run 29468690142,
  // an HTTP 403 on task_list from an under-scoped CI token left an orphan
  // process and the job only ended via its 10-minute timeout-minutes cap).
  try {
    // ---- 1. Resource enumeration ----
    const resources = await client.listResources();
    const uris = resources.resources.map((r) => r.uri).sort();
    assert(uris.includes("provider://manifest"), "quay-github mcp lists provider://manifest");
    const entry = resources.resources.find((r) => r.uri === "provider://manifest");
    assert(
      typeof entry?.name === "string" && entry.name.length > 0,
      `provider://manifest's listed entry carries a non-empty name field (got: ${JSON.stringify(entry)})`
    );
    const manifestRead = await client.readResource({ uri: "provider://manifest" });
    const manifestJson = JSON.parse(manifestRead.contents[0].text);
    assert(manifestJson.id === "github", `provider://manifest resolves to this Provider's own declared id (got: ${manifestJson.id})`);

    // ---- 2. task_list ----
    const listResult = await client.callTool({ name: "task_list", arguments: {} });
    assert(
      listResult.isError !== true && listResult.structuredContent?.tasks,
      `task_list succeeds against the canned fixture repo, not isError (got: ${JSON.stringify(listResult).slice(0, 300)})`
    );
    const ids = (listResult.structuredContent?.tasks ?? []).map((t) => t.id).sort();
    assert(ids.includes("gh-3") && ids.includes("gh-4"), `task_list includes the fixture issues gh-3 and gh-4 (got: ${JSON.stringify(ids)})`);

    // ---- 3. task_get for gh-3, cross-checked against the direct CLI ----
    {
      const viaMcp = await client.callTool({ name: "task_get", arguments: { id: "gh-3" } });
      const viaCli = cliJson(["task", "get", "gh-3", "--json"]);
      assert(
        JSON.stringify(viaMcp.structuredContent?.task) === JSON.stringify(viaCli),
        "task_get('gh-3') via quay-github mcp is byte-identical to the direct CLI's own `task get gh-3 --json` output"
      );
    }

    // ---- 4. task_get for an unknown id ----
    {
      const r = await client.callTool({ name: "task_get", arguments: { id: "gh-999999" } });
      assert(r.isError === true, "task_get with an unknown id returns isError:true, not a crash");
    }

    // ---- 5. task_check for gh-3 and gh-4, cross-checked against the direct CLI ----
    for (const id of ["gh-3", "gh-4"]) {
      const viaMcp = await client.callTool({ name: "task_check", arguments: { id } });
      let viaCli;
      try {
        viaCli = cliJson(["task", "check", id, "--json"]);
      } catch (err) {
        // the direct CLI sets process.exitCode = 1 on ok:false, which makes
        // execFileSync throw; stdout is still captured on err.stdout.
        viaCli = JSON.parse(err.stdout.toString());
      }
      assert(
        JSON.stringify(viaMcp.structuredContent) === JSON.stringify(viaCli),
        `task_check('${id}') via quay-github mcp is byte-identical to the direct CLI's own \`task check ${id} --json\` output (mcp: ${JSON.stringify(viaMcp.structuredContent)}, cli: ${JSON.stringify(viaCli)})`
      );
    }

    // ---- 6. task_write for an unknown id only -- no real write ever attempted ----
    {
      const r = await client.callTool({ name: "task_write", arguments: { id: "gh-999999", status: "ready" } });
      assert(r.isError === true, "task_write with an unknown id returns isError:true, not a crash (this is the ONLY task_write call this file makes -- no live status write to a real issue ever occurs)");
    }
  } finally {
    await client.close();
  }

  // ---- 7. task_list against an unreachable owner/repo (QN-064) ----
  // Separate subprocess/transport (a distinct env from the main `repoEnv`
  // client above), started with a well-formed but unreachable owner/repo
  // so the process itself starts and connects fine (unlike QN-062's
  // startup-crash angle) and the failure occurs inside list()'s own
  // unhandled fetchAllIssues() call. The fake gh fails the paged-list call
  // for this repo with gh's own 404 diagnostic.
  {
    const brokenEnv = {
      ...process.env,
      PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`,
      QUAY_GITHUB_REPO: "nonexistent-owner-xyz-123/nonexistent-repo-abc",
      FAKE_GH_ISSUES_JSON: JSON.stringify(FIXTURE_ISSUES),
    };
    const brokenTransport = new StdioClientTransport({
      command: "node",
      args: [bin, "mcp"],
      cwd: __dirname,
      env: brokenEnv,
    });
    const brokenClient = new Client({ name: "test-agent-broken", version: "0.0.1" });
    await brokenClient.connect(brokenTransport);
    try {
      const r1 = await brokenClient.callTool({ name: "task_list", arguments: {} });
      assert(r1.isError === true, "task_list against an unreachable owner/repo returns isError:true, not a crash");
      assert(
        typeof r1.content?.[0]?.text === "string" && r1.content[0].text.length > 0,
        "task_list's isError:true result carries non-empty error text"
      );

      const r2 = await brokenClient.callTool({ name: "task_list", arguments: {} });
      assert(
        r2.isError === true,
        "a second, independent task_list call against the same broken Provider ALSO returns isError:true (the quay-github mcp process survives the first failure)"
      );
    } finally {
      await brokenClient.close();
    }
  }

  fs.rmSync(fakeGhDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} FAILURE(S)`);
    process.exitCode = 1;
  } else {
    console.log("\nAll QN-048 quay-github MCP server tests passed.");
  }
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
