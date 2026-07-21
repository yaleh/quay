// DIR-037 (M55): RED->GREEN regression test for the ENOBUFS/maxBuffer
// overflow live-verified against a REAL foreign repo (yaleh/archguard) —
// `execFileSync("gh", ["api", ...])` with NO `maxBuffer` option overflows
// Node's 1 MiB `child_process` default on a repo with many/large issues,
// throwing `Error: spawnSync gh ENOBUFS`. quay's own tiny backlog never
// triggers this (ADR-001: pin the regression with a real thrown/caught
// exception, not code inspection).
//
// This test feeds `ghApiJson` (the shared `gh api` helper) a SYNTHETIC
// response larger than Node's default 1 MiB `execFileSync` buffer, via a
// stubbed `gh` executable placed first on PATH (a real subprocess spawn,
// same code path production uses — not a mocked `execFileSync`). Before the
// DIR-037 fix (no `maxBuffer` on the shared helper): THROWS `ENOBUFS`. After
// the fix (`maxBuffer` set in the single shared `execGh` choke point):
// parses cleanly.
//
// Run: node --test packages/quay-github/test/gh-api-buffer.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghApiJson } from "../src/github-client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// A payload comfortably over Node's default 1 MiB execFileSync buffer, but
// well under the fixed helper's 64 MiB ceiling -- exercises exactly the gap
// the fix closes without needing network access or a real large repo.
const OVER_DEFAULT_BUFFER_ISSUE_COUNT = 6000; // ~1.3+ MiB of JSON

function buildLargeIssuesPayload() {
  const items = [];
  for (let i = 0; i < OVER_DEFAULT_BUFFER_ISSUE_COUNT; i++) {
    items.push({
      number: i,
      title: `synthetic large-repo issue ${i}`,
      body: "x".repeat(200),
      state: "open",
      labels: [],
      user: { login: "someone" },
      html_url: `https://github.com/example/example/issues/${i}`,
    });
  }
  return items;
}

/** Write a fake `gh` CLI on a scratch dir that emits `payload` as JSON on
 * stdout for any `gh api ...` invocation, and return that dir (to be
 * prepended to PATH). A real subprocess -- exercises the actual
 * execFileSync/spawnSync buffering behavior, not a mock. */
function makeFakeGhBin(payload) {
  const dir = mkdtempSync(join(tmpdir(), "quay-github-fake-gh-"));
  const script = join(dir, "gh");
  writeFileSync(
    script,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(
      JSON.stringify(payload)
    )});\n`
  );
  chmodSync(script, 0o755);
  return dir;
}

test("DIR-037 RED: reproduces ENOBUFS with NO maxBuffer (pins the pre-fix bug against execFileSync directly)", () => {
  const payload = buildLargeIssuesPayload();
  const fakeBinDir = makeFakeGhBin(payload);
  const nodeDir = dirname(process.execPath);
  try {
    assert.throws(
      () => {
        execFileSync("gh", ["api", "repos/x/y/issues"], {
          encoding: "utf8",
          env: { PATH: `${fakeBinDir}:${nodeDir}` },
          // deliberately NO maxBuffer -- this is the exact pre-fix call shape
        });
      },
      (err) => {
        assert.equal(err.code, "ENOBUFS");
        return true;
      },
      "a large gh api response overflows Node's default 1 MiB execFileSync buffer"
    );
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("DIR-037 GREEN: ghApiJson (the shared helper) parses the SAME large response cleanly post-fix", () => {
  const payload = buildLargeIssuesPayload();
  const fakeBinDir = makeFakeGhBin(payload);
  const nodeDir = dirname(process.execPath);
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = `${fakeBinDir}:${nodeDir}`;
    const result = ghApiJson(["repos/x/y/issues"]);
    assert.equal(result.length, OVER_DEFAULT_BUFFER_ISSUE_COUNT);
    assert.equal(result[0].title, "synthetic large-repo issue 0");
    assert.equal(result[result.length - 1].number, OVER_DEFAULT_BUFFER_ISSUE_COUNT - 1);
  } finally {
    process.env.PATH = originalPath;
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("DIR-037: QUAY_GITHUB_MAX_BUFFER override is honored (a caller can still choose a smaller/larger cap)", () => {
  const payload = buildLargeIssuesPayload();
  const fakeBinDir = makeFakeGhBin(payload);
  const nodeDir = dirname(process.execPath);
  const originalPath = process.env.PATH;
  const originalOverride = process.env.QUAY_GITHUB_MAX_BUFFER;
  try {
    process.env.PATH = `${fakeBinDir}:${nodeDir}`;
    // Set the override BELOW the payload size -- should overflow again, on
    // demand, proving the override is actually wired to execFileSync's
    // maxBuffer and not a dead/ignored env var.
    process.env.QUAY_GITHUB_MAX_BUFFER = String(64 * 1024); // 64 KiB, far under payload
    assert.throws(
      () => ghApiJson(["repos/x/y/issues"]),
      (err) => {
        assert.equal(err.code, "ENOBUFS");
        return true;
      },
      "a deliberately-small QUAY_GITHUB_MAX_BUFFER override still overflows on a bigger payload"
    );
  } finally {
    process.env.PATH = originalPath;
    if (originalOverride === undefined) delete process.env.QUAY_GITHUB_MAX_BUFFER;
    else process.env.QUAY_GITHUB_MAX_BUFFER = originalOverride;
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});
