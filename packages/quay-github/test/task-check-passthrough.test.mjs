// @test-group product
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
// QN-072 (iteration 86): added Case 3 — the compound (epic) task
// childrenStatus rollup (QN-035/DIR-006), the one remaining check()/
// checkGate() branch shape never exercised through either Provider's
// taskCheck() MCP passthrough, on either package, until now. See Case 3's
// own comment below and packages/quay/test/task-check.test.mjs's own
// QN-072 addition (the native-Provider sibling of this case).
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
// gap-suite-speedup (task gap-suite-speedup): the non-adversarial cases
// below were originally each served by their OWN freshly-spawned MCP server
// process (11 github-mcp + 4 Core-mcp process spawns). Each spawn costs
// ~1s of node startup; each Core spawn additionally pays the full cost of
// booting a second nested provider process. The cases are stateless per
// call (github-client.js re-fetches via `gh` for every check()/get()), so
// the fake-gh multi-issue fixture (FAKE_GH_ISSUES_JSON, QN-072) lets the
// four direct github-mcp cases share ONE `quay-github mcp` process and the
// four Core-aggregation cases share ONE `quay mcp` process — every
// assertion below is byte-identical to the pre-consolidation version, only
// the process that serves the request differs. The three adversarial
// break/restore cases MUST keep their own fresh spawns, but (since
// gap-github-client-iscompound-sabotaged-uncommitted) they mutate a TEMP COPY
// of github-client.js under os.tmpdir() (withAdversarialCopy), never the
// real packages/quay-github/src/github-client.ts — the old write-the-real-file
// + finally-restore pattern left the isCompound=false mutation behind when the
// test process was killed mid-await (round-190 early-red, 2026-08-09). Also
// relies on the gap-suite-speedup src fix: all three MCP server entry points
// now exit promptly on stdin EOF (previously a disconnected server whose event
// loop held a live child handle waited out the SDK client's full 2s SIGTERM
// timeout — and orphaned Provider processes were left running).
// promptly on stdin EOF (previously a disconnected server whose event loop
// held a live child handle waited out the SDK client's full 2s SIGTERM
// timeout — and orphaned Provider processes were left running).
//
// Run: node test/task-check-passthrough.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { QUAY_CLI } from "../../quay/test/helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = QUAY_CLI;
const githubBin = path.join(__dirname, "..", "bin", "quay-github.ts");
const githubProviderDir = path.dirname(githubBin);
const githubSrcDir = path.join(__dirname, "..", "src");
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

// QN-072 (iteration 86): plain (non-JSON-stringified) issue object builder,
// for use with FAKE_GH_ISSUES_JSON's map (each value must be a real object,
// not a JSON string, since the whole map itself gets JSON.stringify'd once).
// `childRefs` (issue numbers) are rendered as body checkbox lines
// (`- [ ] #<n>`), the GitHub-Provider's own lightweight parent/child
// convention (github-client.js's CHILD_CHECKBOX_RE) — this is what makes
// an issue "compound" (role derivation is children.length > 0).
function mkIssueObj({ number, labels, state = "open", childRefs = [] }) {
  const childLines = childRefs.map((n) => `- [ ] #${n}`).join("\n");
  return {
    number,
    title: `fixture issue ${number}`,
    body: ISSUE_BODY + (childLines ? `\n## Children\n${childLines}\n` : ""),
    labels: labels.map((name) => ({ name })),
    state,
    pull_request: undefined,
    html_url: `https://github.com/yaleh/quay-fixture/issues/${number}`,
    user: { login: "fixture-user" },
  };
}

// gap-github-client-iscompound-sabotaged-uncommitted: `opts` lets the
// adversarial break/restore cases point the spawned MCP server at a TEMP COPY
// of the package (bin + src), never the real source — see withAdversarialCopy
// below. Defaults to the real bin/cwd for the shared-server non-adversarial
// cases (byte-identical behavior).
async function withGithubMcpFor(fakeIssueJson, run, opts = {}) {
  const fakeGhDir = makeFakeGhPathDir();
  const env = {
    ...process.env,
    PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`,
    QUAY_GITHUB_REPO: "yaleh/quay-fixture", // never actually reached over the network — fake gh ignores it
    FAKE_GH_ISSUE_JSON: fakeIssueJson,
  };
  const bin = opts.bin ?? githubBin;
  const cwd = opts.cwd ?? githubProviderDir;
  const { client, transport } = await connectStdio("node", [bin, "mcp"], cwd, env);
  try {
    await run(client);
  } finally {
    await client.close();
    fs.rmSync(fakeGhDir, { recursive: true, force: true });
  }
}

// QN-072 (iteration 86): multi-issue variant of withGithubMcpFor, using
// FAKE_GH_ISSUES_JSON (fake-gh.mjs's own new map-keyed-by-issue-number
// mode) instead of the single-issue FAKE_GH_ISSUE_JSON — needed for a
// compound (epic) task, whose check() recursively fetches each child issue
// by its own number via the identical single-issue GET endpoint.
async function withGithubMcpForMulti(issuesByNumber, run, opts = {}) {
  const fakeGhDir = makeFakeGhPathDir();
  const env = {
    ...process.env,
    PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`,
    QUAY_GITHUB_REPO: "yaleh/quay-fixture",
    FAKE_GH_ISSUES_JSON: JSON.stringify(issuesByNumber),
  };
  const bin = opts.bin ?? githubBin;
  const cwd = opts.cwd ?? githubProviderDir;
  const { client, transport } = await connectStdio("node", [bin, "mcp"], cwd, env);
  try {
    await run(client);
  } finally {
    await client.close();
    fs.rmSync(fakeGhDir, { recursive: true, force: true });
  }
}

// gap-github-client-iscompound-sabotaged-uncommitted (AC3/AC4 root cause): run
// an adversarial break/restore against a TEMP COPY of the quay-github package
// (bin + src), NEVER the real source file. The previous pattern wrote the
// broken variant into packages/quay-github/src/github-client.ts and restored it
// only in a `finally` — a killed/crashed/SIGKILLed run left the mutation behind
// as an uncommitted working-tree edit that bypassed every gate (scoped and
// static checks read HEAD/task files, not the working-tree runtime state) and
// only surfaced at the full-suite red window. Observed twice with the SAME
// signature: 2026-08-03 (done-branch line-566 at 20:21, during a suite run)
// and 2026-08-09 (both isCompound branches at 18:3x, round-190 early-red).
//
// The temp copy lives under os.tmpdir() (the test-isolation SAFE root — R8
// shared-root-mkdtemp forbids mkdtemp rooted in the shared checkout) with the
// repo root node_modules symlinked in so the copied bin/src still resolve
// @modelcontextprotocol/sdk / zod / yaml. The shared checkout is untouchable:
// even a SIGKILL leaves at worst a /tmp/quay-adv-* dir the OS reaps, never a
// broken production source. `mutateCopySrc(srcText)` returns the mutated copy
// text; `run({ bin, cwd })` is invoked with the copied entry point + pkg dir.
async function withAdversarialCopy(mutateCopySrc, run) {
  const tmpPkg = fs.mkdtempSync(path.join(os.tmpdir(), "quay-adv-"));
  try {
    fs.mkdirSync(path.join(tmpPkg, "bin"), { recursive: true });
    fs.mkdirSync(path.join(tmpPkg, "src"), { recursive: true });
    fs.copyFileSync(githubBin, path.join(tmpPkg, "bin", "quay-github.ts"));
    for (const f of fs.readdirSync(githubSrcDir)) {
      fs.copyFileSync(path.join(githubSrcDir, f), path.join(tmpPkg, "src", f));
    }
    fs.symlinkSync(path.join(__dirname, "..", "..", "..", "node_modules"), path.join(tmpPkg, "node_modules"), "dir");
    const copyPath = path.join(tmpPkg, "src", "github-client.ts");
    fs.writeFileSync(copyPath, mutateCopySrc(fs.readFileSync(copyPath, "utf8")));
    await run({
      bin: path.join(tmpPkg, "bin", "quay-github.ts"),
      cwd: tmpPkg,
    });
  } finally {
    fs.rmSync(tmpPkg, { recursive: true, force: true });
  }
}

// gap-suite-speedup: one Core `quay mcp` workspace+env factory shared by all
// four Core-aggregation cases, so a single Core server (which lazily boots
// the nested github Provider once) serves every case.
function makeCoreEnv(fakeGhDir, issuesByNumber) {
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
  return {
    workspaceRoot,
    env: {
      ...process.env,
      PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`,
      FAKE_GH_ISSUES_JSON: JSON.stringify(issuesByNumber),
    },
  };
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

  // --- Cases 1-4 (direct github-mcp layer), served by ONE shared
  //     `quay-github mcp` process (gap-suite-speedup consolidation; see
  //     header note). Assertions are byte-identical to the pre-consolidation
  //     per-case versions. ---
  await withGithubMcpForMulti(
    {
      501: mkIssueObj({ number: 501, labels: ["status:needs-human"] }),
      503: mkIssueObj({ number: 503, labels: ["status:bogus-status-value"] }),
      601: mkIssueObj({ number: 601, labels: ["status:todo"], state: "open" }), // child still todo
      600: mkIssueObj({ number: 600, labels: [], state: "closed", childRefs: [601] }), // epic marked done (closed), one child not done
      611: mkIssueObj({ number: 611, labels: ["status:todo"], state: "open" }), // child still todo
      610: mkIssueObj({ number: 610, labels: ["status:ready"], state: "open", childRefs: [611] }), // epic ready, AC complete, one child not done
    },
    async (client) => {
      // --- Case 1: needs-human — Core's taskCheck() passthrough, over a real
      //     stdio MCP connection to `quay-github mcp` (PATH-shadowed, no live
      //     network), surfaces the soft-stop shape unchanged. ---
      {
        const r = await client.callTool({ name: "task_check", arguments: { id: "gh-501" } });
        assert(r.isError !== true, "task_check via quay-github mcp for a needs-human-labeled fixture issue does not error");
        assert(
          r.structuredContent?.gate === "none" &&
            r.structuredContent?.ok === false &&
            r.structuredContent?.reason === "soft stop; human action required",
          `quay-github's own task_check tool surfaces the needs-human soft-stop shape unchanged (got: ${JSON.stringify(r.structuredContent)})`
        );
      }

      // --- Case 2: unrecognized status — the same direct github-mcp layer,
      //     for a status:* label value the Provider does not recognize. ---
      {
        const r = await client.callTool({ name: "task_check", arguments: { id: "gh-503" } });
        assert(r.isError !== true, "task_check via quay-github mcp for an unrecognized-status-labeled fixture issue does not error");
        assert(
          r.structuredContent?.gate === "unknown" &&
            r.structuredContent?.ok === false &&
            r.structuredContent?.reason === "unrecognized status bogus-status-value",
          `quay-github's own task_check tool surfaces the unrecognized-status shape unchanged (got: ${JSON.stringify(r.structuredContent)})`
        );
      }

      // --- Case 3 (QN-072, iteration 86): compound (epic) task childrenStatus
      //     rollup — genuinely distinct from Cases 1/2 above (different check()
      //     branch entirely: status==="done" with role==="compound", not the
      //     needs-human/unrecognized-status shortcuts). ---
      {
        const r = await client.callTool({ name: "task_check", arguments: { id: "gh-600" } });
        assert(r.isError !== true, "task_check via quay-github mcp for a compound (epic) issue does not error");
        assert(
          r.structuredContent?.gate === "none" &&
            r.structuredContent?.ok === false &&
            typeof r.structuredContent?.reason === "string" &&
            r.structuredContent.reason.includes("gh-601") &&
            Array.isArray(r.structuredContent?.childrenStatus) &&
            r.structuredContent.childrenStatus.length === 1,
          `quay-github's own task_check tool surfaces the compound "done but a child not done" shape unchanged, including childrenStatus (got: ${JSON.stringify(r.structuredContent)})`
        );
      }

      // --- Case 4 (QN-073, iteration 87): a distinct, previously-uncovered
      //     passthrough shape one branch over from Case 3's — the
      //     `status:ready` compound (epic) rollup, i.e. the execute->done gate
      //     (github-client.js#checkGate()'s own `status === "ready"` branch),
      //     NOT the done-terminal branch Case 3 covered. Here `childrenOk` is
      //     directly ANDed into the gate's own `ok` value. ---
      {
        const r = await client.callTool({ name: "task_check", arguments: { id: "gh-610" } });
        assert(r.isError !== true, "task_check via quay-github mcp for a ready-status compound (epic) issue does not error");
        assert(
          r.structuredContent?.gate === "execute->done" &&
            r.structuredContent?.ok === false &&
            typeof r.structuredContent?.reason === "string" &&
            r.structuredContent.reason.includes("gh-611") &&
            Array.isArray(r.structuredContent?.childrenStatus) &&
            r.structuredContent.childrenStatus.length === 1,
          `quay-github's own task_check tool surfaces the ready-compound "AC complete but a child still todo" shape unchanged, including childrenStatus (got: ${JSON.stringify(r.structuredContent)})`
        );
      }
    }
  );

  // --- Cases 1b/2-core/3-core/4-core: the SAME fixture issues now through
  //     Core's `quay mcp` aggregation layer (provider-client.js#taskCheck())
  //     — the actual gap this task closes, matching QN-069's own scope one
  //     layer up from quay-github's own MCP tool. Served by ONE shared Core
  //     server (gap-suite-speedup consolidation). ---
  {
    const fakeGhDir = makeFakeGhPathDir();
    const { workspaceRoot, env: coreEnv } = makeCoreEnv(fakeGhDir, {
      502: mkIssueObj({ number: 502, labels: ["status:needs-human"] }),
      504: mkIssueObj({ number: 504, labels: ["status:bogus-status-value"] }),
      603: mkIssueObj({ number: 603, labels: [], state: "closed" }), // child genuinely done
      602: mkIssueObj({ number: 602, labels: [], state: "closed", childRefs: [603] }), // epic done, child genuinely done -> ok:true
      613: mkIssueObj({ number: 613, labels: [], state: "closed" }), // child genuinely done
      612: mkIssueObj({ number: 612, labels: ["status:ready"], state: "open", childRefs: [613] }), // epic ready, AC complete, child genuinely done -> ok:true
    });
    const { client: core } = await connectStdio("node", [coreBin, "mcp"], workspaceRoot, coreEnv);
    try {
      // Case 1b: the needs-human fixture issue through Core's aggregation.
      {
        const r = await core.callTool({ name: "task_check", arguments: { id: "gh-502", provider: "github" } });
        assert(r.isError !== true, "task_check via quay mcp (provider=github, PATH-shadowed fixture) does not error for a needs-human fixture issue");
        assert(
          r.structuredContent?.gate === "none" &&
            r.structuredContent?.ok === false &&
            r.structuredContent?.reason === "soft stop; human action required",
          `Core's taskCheck() passthrough surfaces the needs-human soft-stop shape unchanged through the GitHub Provider (got: ${JSON.stringify(r.structuredContent)})`
        );
      }

      // Case 2-core: the unrecognized-status fixture issue through Core's
      // aggregation.
      {
        const r = await core.callTool({ name: "task_check", arguments: { id: "gh-504", provider: "github" } });
        assert(r.isError !== true, "task_check via quay mcp (provider=github, PATH-shadowed fixture) does not error for an unrecognized-status fixture issue");
        assert(
          r.structuredContent?.gate === "unknown" &&
            r.structuredContent?.ok === false &&
            r.structuredContent?.reason === "unrecognized status bogus-status-value",
          `Core's taskCheck() passthrough surfaces the unrecognized-status shape unchanged through the GitHub Provider (got: ${JSON.stringify(r.structuredContent)})`
        );
      }

      // Case 3-core: compound epic with a genuinely-done child (positive
      // shape).
      {
        const r = await core.callTool({ name: "task_check", arguments: { id: "gh-602", provider: "github" } });
        assert(r.isError !== true, "task_check via quay mcp (provider=github) does not error for a compound epic with a genuinely-done child");
        assert(
          r.structuredContent?.gate === "none" &&
            r.structuredContent?.ok === true &&
            Array.isArray(r.structuredContent?.childrenStatus) &&
            r.structuredContent.childrenStatus.length === 1 &&
            r.structuredContent.childrenStatus[0].id === "gh-603" &&
            r.structuredContent.childrenStatus[0].status === "done",
          `Core's taskCheck() passthrough surfaces the compound "all children done" positive shape unchanged through the GitHub Provider, including per-child ids/statuses (got: ${JSON.stringify(r.structuredContent)})`
        );
      }

      // Case 4-core: ready-compound epic with a genuinely-done child
      // (positive shape).
      {
        const r = await core.callTool({ name: "task_check", arguments: { id: "gh-612", provider: "github" } });
        assert(r.isError !== true, "task_check via quay mcp (provider=github) does not error for a ready-status compound epic with a genuinely-done child");
        assert(
          r.structuredContent?.gate === "execute->done" &&
            r.structuredContent?.ok === true &&
            Array.isArray(r.structuredContent?.childrenStatus) &&
            r.structuredContent.childrenStatus.length === 1 &&
            r.structuredContent.childrenStatus[0].id === "gh-613" &&
            r.structuredContent.childrenStatus[0].status === "done",
          `Core's taskCheck() passthrough surfaces the ready-compound "AC complete and all children done" positive shape unchanged through the GitHub Provider, including per-child ids/statuses (got: ${JSON.stringify(r.structuredContent)})`
        );
      }
    } finally {
      await core.close();
      fs.rmSync(fakeGhDir, { recursive: true, force: true });
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }

  // --- Adversarial break/restore (QN-072): confirm the compound-rollup
  //     coverage above has real teeth too, not just Cases 1/2's shapes —
  //     temporarily force `isCompound` false in the `done` branch (the same
  //     unconditional-rubber-stamp regression iteration-5's original audit
  //     caught for store.js, QN-012's own motivating bug, applied here to
  //     confirm github-client.js's port would also be caught by this new
  //     passthrough coverage were it ever reintroduced). ---
  {
    const srcPath = path.join(__dirname, "..", "src", "github-client.ts");
    const original = fs.readFileSync(srcPath, "utf8");
    const needle =
      '  if (status === "done") {\n' +
      '    // QN-035 (DIR-006): a `done` compound (epic) task\'s gate check must\n' +
      '    // actually re-verify that its children are still `done`, rather than\n' +
      '    // unconditionally rubber-stamping `ok: true` -- direct port of\n' +
      '    // store.js\'s own QN-012 fix (see file header note). Primitive tasks\n' +
      '    // are unaffected -- degrades to the original unconditional behavior.\n' +
      '    const isCompound = role === "compound" && (children || []).length > 0;';
    if (!original.includes(needle)) {
      assert(false, "adversarial break/restore (QN-072): expected done-branch isCompound text not found verbatim in github-client.js — source may have changed shape; aborting this check honestly rather than silently skipping it");
    } else {
      // gap-github-client-iscompound-sabotaged-uncommitted: mutate a TEMP COPY,
      // never the real source (withAdversarialCopy) — a killed run used to leave
      // the isCompound=false edit behind in the working tree.
      await withAdversarialCopy(
        (copySrc) => copySrc.replace(needle, needle.replace('role === "compound" && (children || []).length > 0', "false")),
        async ({ bin, cwd }) => {
          await withGithubMcpForMulti(
            {
              701: mkIssueObj({ number: 701, labels: ["status:todo"], state: "open" }),
              700: mkIssueObj({ number: 700, labels: [], state: "closed", childRefs: [701] }),
            },
            async (client) => {
              const r = await client.callTool({ name: "task_check", arguments: { id: "gh-700" } });
              assert(
                r.structuredContent?.ok === true && r.structuredContent?.childrenStatus === undefined,
                `adversarial check (QN-072): with isCompound forced false, the same "epic done but child todo" fixture now WRONGLY reports ok:true with no childrenStatus (got: ${JSON.stringify(r.structuredContent)}) — confirms Case 3's ok:false/childrenStatus assertions above have real teeth, not merely checking passthrough plumbing`
              );
            },
            { bin, cwd }
          );
        }
      );
      const restored = fs.readFileSync(srcPath, "utf8");
      assert(restored === original, "adversarial check (QN-072): github-client.js is byte-identical to its original content after the isCompound break/restore cycle");
    }
  }

  // --- Adversarial break/restore (QN-073): confirm the ready-compound
  //     rollup coverage above has real teeth — force isCompound false in
  //     the READY branch specifically (distinct code from Case 3's DONE
  //     branch fix). ---
  {
    const srcPath = path.join(__dirname, "..", "src", "github-client.ts");
    const original = fs.readFileSync(srcPath, "utf8");
    const needle =
      '    // QN-035 (DIR-006): for a compound (epic) task, the execute->done gate\n' +
      '    // must ALSO require every child to already be `done` -- direct port of\n' +
      "    // store.js's own QN-012 fix (see file header note). Primitive tasks\n" +
      "    // (children.length === 0 / role !== \"compound\") are unaffected:\n" +
      '    // childrenStatus is `[]` and `.every(...)` over an empty array is\n' +
      "    // vacuously true.\n" +
      '    const isCompound = role === "compound" && (children || []).length > 0;';
    if (!original.includes(needle)) {
      assert(false, "adversarial break/restore (QN-073): expected ready-branch isCompound text not found verbatim in github-client.js — source may have changed shape; aborting this check honestly rather than silently skipping it");
    } else {
      // gap-github-client-iscompound-sabotaged-uncommitted: temp-copy isolation
      // (same rationale as the QN-072 block above).
      await withAdversarialCopy(
        (copySrc) => copySrc.replace(needle, needle.replace('role === "compound" && (children || []).length > 0', "false")),
        async ({ bin, cwd }) => {
          await withGithubMcpForMulti(
            {
              621: mkIssueObj({ number: 621, labels: ["status:todo"], state: "open" }),
              620: mkIssueObj({ number: 620, labels: ["status:ready"], state: "open", childRefs: [621] }),
            },
            async (client) => {
              const r = await client.callTool({ name: "task_check", arguments: { id: "gh-620" } });
              assert(
                r.structuredContent?.ok === true && r.structuredContent?.childrenStatus === undefined,
                `adversarial check (QN-073): with the ready-branch isCompound forced false, the same "ready epic, child todo" fixture now WRONGLY reports ok:true with no childrenStatus (got: ${JSON.stringify(r.structuredContent)}) — confirms Case 4's ok:false/childrenStatus assertions above have real teeth, and are testing a genuinely distinct code path from Case 3's done-branch fix`
              );
            },
            { bin, cwd }
          );
        }
      );
      const restored = fs.readFileSync(srcPath, "utf8");
      assert(restored === original, "adversarial check (QN-073): github-client.js is byte-identical to its original content after the ready-branch isCompound break/restore cycle");
    }
  }

  // --- Adversarial break/restore: temporarily comment out
  //     github-client.js's needs-human branch, confirm the new test above
  //     actually has teeth (fails with the shape falling through to
  //     "unrecognized status needs-human" instead), then restore and
  //     confirm a clean re-run — same disclosed technique QN-069's own Plan
  //     step 2 used against store.js, applied here to github-client.js. ---
  {
    const srcPath = path.join(__dirname, "..", "src", "github-client.ts");
    const original = fs.readFileSync(srcPath, "utf8");
    const needle = 'if (status === "needs-human") {\n    return { id, gate: "none", ok: false, reason: "soft stop; human action required" };\n  }\n\n  ';
    if (!original.includes(needle)) {
      assert(false, "adversarial break/restore: expected needs-human branch text not found verbatim in github-client.js — source may have changed shape; aborting this check honestly rather than silently skipping it");
    } else {
      // gap-github-client-iscompound-sabotaged-uncommitted: temp-copy isolation
      // (same rationale as the QN-072/QN-073 blocks above).
      await withAdversarialCopy(
        (copySrc) => copySrc.replace(needle, ""),
        async ({ bin, cwd }) => {
          await withGithubMcpFor(
            mkIssueJson({ number: 505, labels: ["status:needs-human"] }),
            async (client) => {
              const r = await client.callTool({ name: "task_check", arguments: { id: "gh-505" } });
              assert(
                r.structuredContent?.gate === "unknown" &&
                  r.structuredContent?.reason === "unrecognized status needs-human",
                `adversarial check: with the needs-human branch removed, the same fixture now falls through to the unrecognized-status shape (got: ${JSON.stringify(r.structuredContent)}) — confirms this test file's needs-human assertions have real teeth, not merely checking the passthrough machinery`
              );
            },
            { bin, cwd }
          );
        }
      );
      const restored = fs.readFileSync(srcPath, "utf8");
      assert(restored === original, "adversarial check: github-client.js is byte-identical to its original content after the break/restore cycle");
    }
  }

  console.log(failures === 0 ? "\nAll QN-071/QN-072/QN-073 GitHub-Provider taskCheck passthrough tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
