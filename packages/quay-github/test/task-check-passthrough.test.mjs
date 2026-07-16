// QN-071 (iteration 76): closes the GitHub-Provider-side sibling of QN-069
// (iteration 66). QN-068 (iteration 64) added direct-Provider unit test
// coverage for the gate's `needs-human` soft-stop and unrecognized-status
// fallthrough shapes on BOTH packages/quay-native/src/store.js#check() and
// packages/quay-github/src/github-client.js#checkGate() directly
// (gate-correctness.test.mjs / gate.test.mjs). QN-069 then closed the
// distinct, previously-uncovered question of whether Core's own generic
// taskCheck() passthrough (provider-client.js, over a REAL stdio MCP
// connection, not the Provider's gate function called directly) forwards
// those same two shapes unchanged — but QN-069 only exercised this against
// the native Provider (packages/quay/test/task-check.test.mjs). It never
// touched the GitHub Provider's own taskCheck() passthrough path at all
// (confirmed by grep: "needs-human"/"unrecognized status" appear nowhere in
// packages/quay/test/mcp-server.test.mjs's github-provider block, which
// only exercises task_check's ok:false/ready-status shape against the real,
// live, read-only-fixture issue gh-3).
//
// This is a genuinely distinct gap, not a repeat of QN-069: does Core's
// taskCheck() passthrough correctly forward the needs-human/unrecognized
// shapes end-to-end over a real stdio MCP connection specifically to a real
// `quay-github mcp` server (not quay-native's)?
//
// Constraint (this project's own standing discipline, repeated in
// write.test.mjs/cli.test.mjs/mcp-server.test.mjs's header comments): the
// real yaleh/quay issue backlog (issues #3/#4) is a strictly READ-ONLY test
// fixture — it must never be mutated, and it cannot honestly be coerced into
// a needs-human/unrecognized-status shape without either (a) writing to it
// (forbidden) or (b) it already happening to carry that exact label
// (neither #3 nor #4 does, and this test must not depend on the live
// fixture's current labels happening to match what it needs). This test
// therefore introduces one new, narrowly-scoped test-infrastructure
// mechanism: a fake `gh` executable (test/fixtures/fake-gh.mjs) that
// PATH-shadows the real `gh` binary for a fresh `quay-github mcp` child
// process, returning a test-supplied canned single-issue JSON body instead
// of a live network response — this is dependency injection at the process
// boundary, one level lower than pageIssues()'s existing injectable-fixture
// convention (which injects at the function-argument level), used here
// because github-client.js's own `check()`/`get()` path has no
// function-argument injection point and mcp-server.js's startMcpServer()
// hardcodes createGithubClient({owner, repo}) directly (both confirmed by
// reading the source this iteration). No live `gh api` call, and no read or
// write of any kind against the real yaleh/quay repository, occurs anywhere
// in this file.
//
// Run: node test/task-check-passthrough.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = path.join(__dirname, "..", "..", "quay", "bin", "quay.js");
const githubBin = path.join(__dirname, "..", "bin", "quay-github.js");
const githubProviderDir = path.dirname(githubBin);
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

async function connectStdio(command, args, cwd, env) {
  const transport = new StdioClientTransport({ command, args, cwd, env });
  const client = new Client({ name: "qn071-test-agent", version: "0.0.1" });
  await client.connect(transport);
  return { client, transport };
}

/** A minimal but well-formed issue body (all four sections present, AC
 * fully checked) — content is irrelevant to the needs-human/unrecognized
 * branches (checkGate() short-circuits on status before reading AC/DoD for
 * either shape), but a realistic body keeps this fixture honest. */
const ISSUE_BODY =
  "## Proposal\nA sufficiently long proposal section for this fixture issue.\n" +
  "## Plan\nA sufficiently long plan section for this fixture issue.\n" +
  "## AC\n- [x] a checked acceptance criterion\n" +
  "## DoD\n- [x] a checked definition of done\n";

function mkIssueJson({ number, labels, state = "open" }) {
  return JSON.stringify({
    number,
    title: `fixture issue ${number}`,
    body: ISSUE_BODY,
    labels: labels.map((name) => ({ name })),
    state,
    pull_request: undefined,
    html_url: `https://github.com/yaleh/quay-fixture/issues/${number}`,
    user: { login: "fixture-user" },
  });
}

async function withGithubMcpFor(fakeIssueJson, run) {
  const fakeGhDir = makeFakeGhPathDir();
  const env = {
    ...process.env,
    PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`,
    QUAY_GITHUB_REPO: "yaleh/quay-fixture", // never actually reached over the network — fake gh ignores it
    FAKE_GH_ISSUE_JSON: fakeIssueJson,
  };
  const { client, transport } = await connectStdio("node", [githubBin, "mcp"], githubProviderDir, env);
  try {
    await run(client);
  } finally {
    await client.close();
    fs.rmSync(fakeGhDir, { recursive: true, force: true });
  }
}

async function main() {
  // --- Sanity check: the fake gh binary itself, invoked directly, returns
  //     exactly the canned issue and nothing else (confirms the fixture's
  //     own mechanism works before trusting it as a test double). ---
  {
    const fakeGhDir = makeFakeGhPathDir();
    const sanityJson = mkIssueJson({ number: 999, labels: ["status:ready"] });
    const out = execFileSync("gh", ["api", "repos/a/b/issues/999"], {
      env: { ...process.env, PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`, FAKE_GH_ISSUE_JSON: sanityJson },
      encoding: "utf8",
    });
    assert(JSON.parse(out).number === 999, "sanity check: fake gh shim returns the exact FAKE_GH_ISSUE_JSON payload for a single-issue GET");
    let unsupportedThrew = null;
    try {
      execFileSync("gh", ["api", "repos/a/b/issues"], {
        env: { ...process.env, PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}` },
        encoding: "utf8",
      });
    } catch (err) {
      unsupportedThrew = err;
    }
    assert(unsupportedThrew !== null, "sanity check: fake gh shim exits non-zero for an unsupported invocation shape (list, not single-issue GET)");
    fs.rmSync(fakeGhDir, { recursive: true, force: true });
  }

  // --- Case 1: needs-human — Core's taskCheck() passthrough, over a real
  //     stdio MCP connection to `quay-github mcp` (PATH-shadowed, no live
  //     network), surfaces the soft-stop shape unchanged. ---
  await withGithubMcpFor(mkIssueJson({ number: 501, labels: ["status:needs-human"] }), async (client) => {
    const r = await client.callTool({ name: "task_check", arguments: { id: "gh-501" } });
    assert(r.isError !== true, "task_check via quay-github mcp for a needs-human-labeled fixture issue does not error");
    assert(
      r.structuredContent?.gate === "none" &&
        r.structuredContent?.ok === false &&
        r.structuredContent?.reason === "soft stop; human action required",
      `quay-github's own task_check tool surfaces the needs-human soft-stop shape unchanged (got: ${JSON.stringify(r.structuredContent)})`
    );
  });

  // --- Case 1b: the same needs-human fixture issue, now through Core's
  //     `quay mcp` aggregation layer (provider-client.js#taskCheck()) —
  //     the actual gap this task closes, matching QN-069's own scope one
  //     layer up from quay-github's own MCP tool. ---
  {
    const fakeGhDir = makeFakeGhPathDir();
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-qn071-workspace-"));
    fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  github:",
        "    enabled: true",
        `    path: "${githubProviderDir}"`,
        `    mcp_entry: ["node", "${githubBin}", "mcp"]`,
        "    env:",
        '      QUAY_GITHUB_REPO: "yaleh/quay-fixture"',
        "",
      ].join("\n")
    );
    const coreEnv = {
      ...process.env,
      PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`,
      FAKE_GH_ISSUE_JSON: mkIssueJson({ number: 502, labels: ["status:needs-human"] }),
    };
    const { client: core } = await connectStdio("node", [coreBin, "mcp"], workspaceRoot, coreEnv);
    try {
      const r = await core.callTool({ name: "task_check", arguments: { id: "gh-502", provider: "github" } });
      assert(r.isError !== true, "task_check via quay mcp (provider=github, PATH-shadowed fixture) does not error for a needs-human fixture issue");
      assert(
        r.structuredContent?.gate === "none" &&
          r.structuredContent?.ok === false &&
          r.structuredContent?.reason === "soft stop; human action required",
        `Core's taskCheck() passthrough surfaces the needs-human soft-stop shape unchanged through the GitHub Provider (got: ${JSON.stringify(r.structuredContent)})`
      );
    } finally {
      await core.close();
      fs.rmSync(fakeGhDir, { recursive: true, force: true });
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }

  // --- Case 2: unrecognized status — same two layers (quay-github's own
  //     tool, then Core's aggregated passthrough), for a status:* label
  //     value the Provider does not recognize at all. ---
  await withGithubMcpFor(mkIssueJson({ number: 503, labels: ["status:bogus-status-value"] }), async (client) => {
    const r = await client.callTool({ name: "task_check", arguments: { id: "gh-503" } });
    assert(r.isError !== true, "task_check via quay-github mcp for an unrecognized-status-labeled fixture issue does not error");
    assert(
      r.structuredContent?.gate === "unknown" &&
        r.structuredContent?.ok === false &&
        r.structuredContent?.reason === "unrecognized status bogus-status-value",
      `quay-github's own task_check tool surfaces the unrecognized-status shape unchanged (got: ${JSON.stringify(r.structuredContent)})`
    );
  });

  {
    const fakeGhDir = makeFakeGhPathDir();
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-qn071-workspace2-"));
    fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".quay", "config.yml"),
      [
        "providers:",
        "  github:",
        "    enabled: true",
        `    path: "${githubProviderDir}"`,
        `    mcp_entry: ["node", "${githubBin}", "mcp"]`,
        "    env:",
        '      QUAY_GITHUB_REPO: "yaleh/quay-fixture"',
        "",
      ].join("\n")
    );
    const coreEnv = {
      ...process.env,
      PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`,
      FAKE_GH_ISSUE_JSON: mkIssueJson({ number: 504, labels: ["status:bogus-status-value"] }),
    };
    const { client: core } = await connectStdio("node", [coreBin, "mcp"], workspaceRoot, coreEnv);
    try {
      const r = await core.callTool({ name: "task_check", arguments: { id: "gh-504", provider: "github" } });
      assert(r.isError !== true, "task_check via quay mcp (provider=github, PATH-shadowed fixture) does not error for an unrecognized-status fixture issue");
      assert(
        r.structuredContent?.gate === "unknown" &&
          r.structuredContent?.ok === false &&
          r.structuredContent?.reason === "unrecognized status bogus-status-value",
        `Core's taskCheck() passthrough surfaces the unrecognized-status shape unchanged through the GitHub Provider (got: ${JSON.stringify(r.structuredContent)})`
      );
    } finally {
      await core.close();
      fs.rmSync(fakeGhDir, { recursive: true, force: true });
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }

  // --- Adversarial break/restore: temporarily comment out
  //     github-client.js's needs-human branch, confirm the new test above
  //     actually has teeth (fails with the shape falling through to
  //     "unrecognized status needs-human" instead), then restore and
  //     confirm a clean re-run — same disclosed technique QN-069's own Plan
  //     step 2 used against store.js, applied here to github-client.js. ---
  {
    const srcPath = path.join(__dirname, "..", "src", "github-client.js");
    const original = fs.readFileSync(srcPath, "utf8");
    const needle = 'if (status === "needs-human") {\n    return { id, gate: "none", ok: false, reason: "soft stop; human action required" };\n  }\n\n  ';
    if (!original.includes(needle)) {
      assert(false, "adversarial break/restore: expected needs-human branch text not found verbatim in github-client.js — source may have changed shape; aborting this check honestly rather than silently skipping it");
    } else {
      const broken = original.replace(needle, "");
      fs.writeFileSync(srcPath, broken);
      try {
        await withGithubMcpFor(mkIssueJson({ number: 505, labels: ["status:needs-human"] }), async (client) => {
          const r = await client.callTool({ name: "task_check", arguments: { id: "gh-505" } });
          assert(
            r.structuredContent?.gate === "unknown" &&
              r.structuredContent?.reason === "unrecognized status needs-human",
            `adversarial check: with the needs-human branch removed, the same fixture now falls through to the unrecognized-status shape (got: ${JSON.stringify(r.structuredContent)}) — confirms this test file's needs-human assertions have real teeth, not merely checking the passthrough machinery`
          );
        });
      } finally {
        fs.writeFileSync(srcPath, original);
      }
      const restored = fs.readFileSync(srcPath, "utf8");
      assert(restored === original, "adversarial check: github-client.js is byte-identical to its original content after the break/restore cycle");
    }
  }

  console.log(failures === 0 ? "\nAll QN-071 GitHub-Provider taskCheck passthrough tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
