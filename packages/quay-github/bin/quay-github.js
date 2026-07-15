#!/usr/bin/env node
// quay-github — the GitHub Provider's binary (glossary.md pattern:
// quay-<providerId>). v1: `mcp` subcommand only — no raw `task` CLI
// subcommands required by the ABI (QN-002 Plan Phase 1: "a raw local CLI
// mirroring quay-native's convenience commands is not required by the ABI,
// only the MCP surface is"). A thin `task list`/`task get` convenience is
// still provided for manual smoke-testing/debugging, reusing the same
// github-client.js core the MCP server uses (symmetry, design §6, applied
// to whatever subset of the ABI this Provider implements).

import { createGithubClient } from "../src/github-client.js";

function resolveRepo() {
  const envRepo = process.env.QUAY_GITHUB_REPO; // "owner/repo"
  const [owner, repo] = (envRepo || "yaleh/quay").split("/");
  if (!owner || !repo) {
    throw new Error(
      `QUAY_GITHUB_REPO must be "owner/repo" (got: ${envRepo})`
    );
  }
  return { owner, repo };
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function main() {
  const [, , cmd, sub, ...rest] = process.argv;
  const { owner, repo } = resolveRepo();

  if (cmd === "mcp") {
    const { startMcpServer } = await import("../src/mcp-server.js");
    await startMcpServer({ owner, repo });
    return;
  }

  if (cmd === "manifest") {
    const { readManifest } = await import("../src/manifest.js");
    printJson(readManifest());
    return;
  }

  if (cmd === "task") {
    const client = createGithubClient({ owner, repo });
    const { flags, positional } = parseFlags(rest);

    if (sub === "list") {
      const tasks = client.list({ status: flags.status, label: flags.label });
      if (flags.json) printJson(tasks);
      else for (const t of tasks) console.log(`${t.id}\t${t.status}\t${t.role}\t${t.title}`);
      return;
    }

    if (sub === "get") {
      const id = positional[0];
      const t = client.get(id);
      if (!t) {
        console.error(`no such task: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (flags.json) printJson(t);
      else {
        console.log(`${t.id}: ${t.title} [${t.status}]`);
        console.log(t.body);
      }
      return;
    }

    console.error(`unknown task subcommand: ${sub} (v1 supports list/get only — read-only Provider)`);
    process.exitCode = 1;
    return;
  }

  console.error("usage: quay-github <task list|get|mcp|manifest> ...");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
