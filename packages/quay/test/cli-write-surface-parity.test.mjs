// @test-group product
// gap-cli-write-surface-lacks-toplevel-fields (做法 #3): the CLI↔MCP write-field-surface parity
// test. The single machine-readable source of truth for the write surface is the NATIVE MCP
// `task_write` zod inputSchema (packages/quay-native/src/mcp-server.ts:142 — enumerable at runtime
// via MCP `tools/list`). This file machine-reads that schema, then asserts every writable field is
// actually HANDLED by a flag in BOTH the Core CLI (`task edit`, packages/quay/src/cli/task-edit.ts)
// and the native CLI (`task edit`, packages/quay-native/bin/quay-native.ts).
//
// Why this file exists (and why it is NOT folded into cli-edit-parity-conformance.test.mjs): that
// file is skipped by default under ADR-019 (live GitHub writes), so a parity check placed there is
// structurally incapable of catching a drifted flag surface — a "恒绿的检查" (hard rule 3b). This
// file is native-only (isolated temp tasks dir, no network), so it runs in the default suite.
//
// Falsifiability (AC5): removing any one of the newly-added flags (--depends-on / --goal-ac) from
// either CLI implementation removes the `flags["depends-on"]` / `flags["goal-ac"]` access from that
// source file, and this test goes red — the field is still present in the zod schema (the source of
// truth) but its flag handling is gone. A fixture-only assertion would not catch that; this
// grep-against-real-source does.
//
// The `access` string is the exact `flags.<name>` / `flags["<name>"]` read the CLI handler performs
// — the mechanical proof that the flag is wired, not merely a help-text mention. Single-word flags
// use dot access (`flags.title`); hyphenated flags use bracket access (`flags["depends-on"]`). The
// one non-mechanical field→flag transform is `expectedStatus` → `--expect-status` (the flag drops
// the `ed`), reflected in the bracket access `flags["expect-status"]`.
//
// Run: node packages/quay/test/cli-write-surface-parity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// zod field name → the exact CLI source access that proves the flag is handled. `id` is the
// positional <task-id> (always present), not a flag, so it is excluded from this map.
const FIELD_TO_ACCESS = {
  title: "flags.title",
  status: "flags.status",
  labels: "flags.labels",
  parent: "flags.parent",
  children: "flags.children",
  depends_on: 'flags["depends-on"]',
  goal_ac: 'flags["goal-ac"]',
  body: "flags.body",
  extra: "flags.extra",
  expectedStatus: 'flags["expect-status"]',
};

const CLI_SURFACES = {
  "core task-edit.ts": path.join(__dirname, "..", "src", "cli", "task-edit.ts"),
  "native quay-native.ts": path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.ts"),
};

async function main() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-write-surface-parity-"));
  const client = new Client({ name: "cli-write-surface-parity", version: "0.0.1" });
  await client.connect(new StdioClientTransport({
    command: "node",
    args: [QUAY_NATIVE_CLI, "mcp"],
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  }));
  try {
    // ① machine-read the native MCP task_write zod inputSchema (runtime enumeration).
    const { tools } = await client.listTools();
    const taskWrite = tools.find((t) => t.name === "task_write");
    assert.ok(taskWrite, "native MCP exposes a task_write tool");
    const properties = taskWrite.inputSchema?.properties ?? {};
    const zodFields = Object.keys(properties).filter((f) => f !== "id");
    assert.ok(zodFields.length > 0, "task_write inputSchema has writable fields beyond id");

    const gaps = [];

    // ② each zod field must have an access pattern, present in every CLI surface.
    for (const field of zodFields) {
      const access = FIELD_TO_ACCESS[field];
      if (!access) {
        gaps.push(`zod field "${field}" has no FIELD_TO_ACCESS mapping`);
        continue;
      }
      for (const [label, srcPath] of Object.entries(CLI_SURFACES)) {
        const src = fs.readFileSync(srcPath, "utf8");
        if (!src.includes(access)) {
          gaps.push(`access ${access} (zod field "${field}") missing from ${label}`);
        }
      }
    }

    // ③ reverse guard: the mapping must not claim fields the schema no longer declares.
    const zodSet = new Set(zodFields);
    for (const field of Object.keys(FIELD_TO_ACCESS)) {
      if (!zodSet.has(field)) {
        gaps.push(`FIELD_TO_ACCESS entry "${field}" is not in the zod inputSchema (stale mapping)`);
      }
    }

    assert.deepEqual(
      gaps,
      [],
      `CLI↔MCP write-field-surface parity gaps (zod fields: ${zodFields.join(", ")}):\n  ${gaps.join("\n  ")}`
    );
  } finally {
    await client.close();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
}

test("cli-write-surface-parity: every native task_write zod field is CLI-flag-wired in core + native", main);
