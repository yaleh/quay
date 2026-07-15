#!/usr/bin/env node
// quay — the Core CLI (glossary.md). Provider-agnostic, MCP client, sibling
// to the Web UI (proposal §9): `serve` / `task` / `action`.

import path from "node:path";
import { loadConfig, activeProvider } from "../src/config.js";
import { connectProvider } from "../src/provider-client.js";
import { composePayload, deliverTrigger } from "../src/action.js";

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

// Resolve a provider's declared `env` map (proposal §10's `.quay/config.yml`
// shape) against the workspace root. Values that look like a relative path
// (start with "./" or "../") are resolved to absolute paths; anything else
// (e.g. "owner/repo") is passed through verbatim. This is what makes adding
// a second, heterogeneous Provider (github) require zero changes to this
// file beyond config — the env-building logic is provider-agnostic.
function resolveProviderEnv(cfg, provider) {
  const env = {};
  for (const [key, value] of Object.entries(provider.env ?? {})) {
    if (typeof value === "string" && (value.startsWith("./") || value.startsWith("../"))) {
      env[key] = path.resolve(cfg.workspaceRoot, value);
    } else {
      env[key] = value;
    }
  }
  return env;
}

async function withProvider(fn, { providerId } = {}) {
  const cfg = loadConfig();
  const provider = activeProvider(cfg, providerId);
  const providerDir = path.resolve(cfg.workspaceRoot, provider.path ?? ".");
  const [command, ...args] = provider.mcp_entry;
  const client = await connectProvider({
    command,
    args,
    cwd: providerDir,
    env: resolveProviderEnv(cfg, provider),
  });
  try {
    return await fn(client, cfg, provider);
  } finally {
    await client.close();
  }
}

async function main() {
  const [, , cmd, sub, ...rest] = process.argv;
  const { flags, positional } = parseFlags(rest);

  if (cmd === "task" && sub === "list") {
    await withProvider(async (client) => {
      const tasks = await client.taskList({ status: flags.status, label: flags.label });
      if (flags.json) {
        printJson(tasks);
      } else {
        for (const t of tasks) console.log(`${t.id}\t${t.status}\t${t.role}\t${t.title}`);
      }
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "task" && sub === "view") {
    const id = positional[0];
    await withProvider(async (client) => {
      const t = await client.taskGet(id);
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
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "action" && sub === "list") {
    const id = positional[0];
    await withProvider(async (client) => {
      const manifest = await client.manifest();
      const t = await client.taskGet(id);
      if (!t) {
        console.error(`no such task: ${id}`);
        process.exitCode = 1;
        return;
      }
      const buttons = (manifest.action_buttons ?? []).filter(
        (b) => !b.whenStatus || b.whenStatus.includes(t.status)
      );
      if (flags.json) printJson(buttons);
      else for (const b of buttons) console.log(`${b.id}\t${b.label}`);
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "action" && sub === "run") {
    const [id, actionId] = positional;
    await withProvider(async (client, cfg) => {
      const manifest = await client.manifest();
      const t = await client.taskGet(id);
      if (!t) {
        console.error(`no such task: ${id}`);
        process.exitCode = 1;
        return;
      }
      const payloadObj = composePayload({ providerManifest: manifest, task: t, actionId });
      console.log(`[quay action run] composed trigger for ${id} (status=${t.status}, skill=${payloadObj.skill}):`);
      console.log(`  ${payloadObj.payload}`);
      const channel = `task-${id}`;
      const result = await deliverTrigger({ root: cfg.workspaceRoot, channel, payloadObj });
      printJson({ ...payloadObj, channel, ...result });
    }, { providerId: flags.provider });
    return;
  }

  if (cmd === "serve") {
    const { startServer } = await import("../src/serve.js");
    // `serve` has no subcommand token — reparse from argv[2] so `--port` etc.
    // is read correctly instead of being swallowed into `sub`.
    const { flags: serveFlags } = parseFlags(process.argv.slice(3));
    await startServer({ port: serveFlags.port ? Number(serveFlags.port) : undefined });
    return;
  }

  console.error("usage: quay <task list|view|action list|run|serve> ...");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
