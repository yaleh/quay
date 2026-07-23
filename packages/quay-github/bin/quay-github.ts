#!/usr/bin/env node
// @ts-nocheck — TS gradual-adoption ramp list (ADR-012): tsc --noEmit real-checked this file and found pre-existing untyped-JS structural diagnostics; fixing them means real JSDoc typing / a product-code touch, out of the tooling-only phase that introduced this gate. Remove this line once this file is migrated/annotated.
// quay-github — the GitHub Provider's binary (glossary.md pattern:
// quay-<providerId>). `mcp` is the formal ABI transport; `task` subcommands
// below are a convenience CLI mirroring quay-native's own, reusing the same
// github-client.js core the MCP server uses (symmetry, design §6, applied
// to whatever subset of the ABI this Provider implements — not required by
// the ABI itself, QN-002 Plan Phase 1). `task edit` now covers the full
// write surface (status/title/body/labels/parent/children — QN-024,
// M09-gh-write, M12-abi-parent-write); `task create` (DIR-041, M57) closes
// the last remaining write gap: a real issue CREATE (--title required,
// optional --body/--labels/--status/--parent/--children), printing the REAL
// "gh-<n>" id GitHub assigned (issue numbers cannot be chosen by the
// caller, unlike quay-native's filename-derived ids).

import { createGithubClient } from "../src/github-client.ts";

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
    const { startMcpServer } = await import("../src/mcp-server.ts");
    await startMcpServer({ owner, repo });
    return;
  }

  if (cmd === "manifest") {
    const { readManifest } = await import("../src/manifest.ts");
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

    if (sub === "create") {
      // DIR-041 (M57): real issue CREATE. --title is required (GitHub
      // issues cannot exist without one; client.create() itself also
      // enforces this, fail-closed); --status/--parent/--children, if
      // given, are applied as follow-up writes against the REAL id
      // client.create() returns (mirrors mcp-server.js's task_write
      // create-then-follow-up decomposition for the SAME reason: GitHub
      // assigns the issue number, so no id exists to write relations
      // against until after the POST completes).
      if (typeof flags.title !== "string" || flags.title.trim() === "") {
        console.error("quay-github task create: --title <title> is required (and must be non-empty)");
        process.exitCode = 1;
        return;
      }
      const labels = flags.labels !== undefined
        ? String(flags.labels).split(",").filter(Boolean)
        : undefined;
      let t = client.create({ title: flags.title, body: flags.body, labels });
      if (flags.status !== undefined) t = client.setStatus(t.id, flags.status);
      const relationFields = {};
      if (flags.parent !== undefined) relationFields.parent = flags.parent;
      if (flags.children !== undefined) {
        relationFields.children = String(flags.children).split(",").filter(Boolean);
      }
      if (Object.keys(relationFields).length > 0) {
        t = client.writeRelations(t.id, relationFields);
      }
      if (flags.json) printJson(t);
      else console.log(`${t.id}: ${t.title} [${t.status}]`);
      return;
    }

    if (sub === "edit") {
      const id = positional[0];
      const hasAnyWriteFlag =
        flags.status !== undefined ||
        flags.title !== undefined ||
        flags.body !== undefined ||
        flags.labels !== undefined ||
        flags.parent !== undefined ||
        flags.children !== undefined;
      if (!hasAnyWriteFlag) {
        console.error(
          "quay-github task edit: at least one of --status/--title/--body/--labels/--parent/--children is required"
        );
        process.exitCode = 1;
        return;
      }
      let t;
      if (flags.status !== undefined) {
        t = client.setStatus(id, flags.status);
      }
      const otherFields = {};
      if (flags.title !== undefined) otherFields.title = flags.title;
      if (flags.body !== undefined) otherFields.body = flags.body;
      if (flags.labels !== undefined) {
        otherFields.labels = String(flags.labels).split(",").filter(Boolean);
      }
      if (Object.keys(otherFields).length > 0) {
        t = client.writeFields(id, otherFields);
      }
      const relationFields = {};
      if (flags.parent !== undefined) relationFields.parent = flags.parent;
      if (flags.children !== undefined) {
        relationFields.children = String(flags.children).split(",").filter(Boolean);
      }
      if (Object.keys(relationFields).length > 0) {
        t = client.writeRelations(id, relationFields);
      }
      if (flags.json) printJson(t);
      else console.log(`${t.id}: ${t.title} [${t.status}]`);
      return;
    }

    if (sub === "check") {
      // QN-028 (iteration 17): gate capability CLI surface, mirroring
      // quay-native's own `task check` convention (JSON if --json, else a
      // human-readable PASS/FAIL summary line; process.exitCode from ok).
      const id = positional[0];
      const result = client.check(id);
      if (flags.json) printJson(result);
      else console.log(`${id}: ${result.ok ? "PASS" : "FAIL"} — ${result.reason}`);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    console.error(`unknown task subcommand: ${sub} (supports list/get/create/edit/check)`);
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
