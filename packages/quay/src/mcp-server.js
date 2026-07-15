// quay mcp — the Core's own MCP server (DIR-007; quay-proposal.md §5's
// "MCP projection -> Agent" architecture claim). This is the consumer-layer
// binding an Agent (Claude Code) connects to ONCE, regardless of how many
// Providers are enabled in .quay/config.yml — the mechanism the proposal
// names as the alternative to registering each Provider's own MCP server
// separately.
//
// The Core's MCP server is simultaneously:
//   (a) an MCP SERVER — the surface an Agent connects to (McpServer +
//       StdioServerTransport, same SDK usage as quay-native/quay-github's
//       own server files), and
//   (b) an MCP CLIENT (fan-out) — for each Provider currently
//       `enabled: true` in .quay/config.yml, it connects to that Provider's
//       own MCP server via connectProvider() (provider-client.js's existing,
//       unmodified taskList/taskGet/taskWrite/taskCheck/manifest functions —
//       zero changes to that file were needed for this).
//
// Multi-Provider disambiguation (per DIR-007 point 2 — an explicit,
// documented decision, not a silent single-Provider assumption): every tool
// takes an OPTIONAL `provider` argument, mirroring the CLI/withProvider()
// convention already established by bin/quay.js's own `--provider <id>`
// flag (QN-002/QN-032). Rationale for choosing "argument" over "per-Provider
// tool-name namespacing" (e.g. task_list__github): argument-based routing
// keeps the tool surface small and identical in shape to each Provider's own
// task_list/task_get/task_write/task_check tools (design §6 CLI/MCP symmetry
// principle, now lifted one layer: Core's MCP tools are byte-shape-identical
// to a Provider's own, just with one added optional field) — an Agent that
// already knows a single-Provider workspace's tool calls needs zero changes
// to keep working (omitting `provider` selects the default-enabled Provider,
// exactly like withProvider()'s own `providerId` default). Per-Provider tool
// name namespacing was rejected because it would require an Agent to already
// know the full enabled-Provider set before it could even call task_list —
// the opposite of proposal §5's stated goal ("adding a Provider requires
// zero consumer-layer changes").
//
// provider://manifest is exposed per-enabled-Provider as
// provider://manifest/<id> (a real MCP resource per Provider, since MCP
// resources are identified by URI, not by an argument) PLUS a
// provider://manifest alias that resolves to the default-enabled Provider,
// for symmetry with the single-Provider case.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { loadConfig, activeProvider } from "./config.js";
import { connectProvider } from "./provider-client.js";
import { composePayload, deliverTrigger } from "./action.js";
import { resolveProviderEnv } from "./provider-env.js";

// resolveProviderEnv is now imported from ./provider-env.js (QN-045): this
// file, bin/quay.js, and serve.js all share the single implementation there
// — the "duplicated here rather than imported" note this comment previously
// carried is resolved; see provider-env.js's own header for why (DESIGN.md
// §4.4's asymmetry).

async function connectToProvider(cfg, providerId) {
  const provider = activeProvider(cfg, providerId);
  const providerDir = path.resolve(cfg.workspaceRoot, provider.path ?? ".");
  const [command, ...args] = provider.mcp_entry;
  const client = await connectProvider({
    command,
    args,
    cwd: providerDir,
    env: resolveProviderEnv(cfg, provider),
  });
  return { id: provider.id, client };
}

// Enabled-Provider set, per .quay/config.yml (DIR-007 point 2: "for each
// Provider currently enabled: true"). Order follows Object.entries() order
// of the config's `providers` map (insertion order — deterministic given a
// single config file).
function enabledProviderIds(cfg) {
  const providers = cfg.config.providers ?? {};
  return Object.keys(providers).filter((id) => providers[id].enabled);
}

export async function startMcpServer() {
  const cfg = loadConfig();
  const enabledIds = enabledProviderIds(cfg);
  if (enabledIds.length === 0) {
    throw new Error("quay mcp: no enabled provider in .quay/config.yml");
  }
  const defaultId = enabledIds[0];

  // Lazily connect to each enabled Provider on first use (not eagerly at
  // startup) so a workspace with N enabled Providers but a session that only
  // ever touches one doesn't pay the spawn cost for the others. Connections
  // are cached and reused, and closed together on server shutdown.
  const clients = new Map(); // providerId -> Promise<{id, client}>
  function getClient(providerId) {
    const id = providerId || defaultId;
    if (!enabledIds.includes(id)) {
      throw new Error(
        `quay mcp: provider "${id}" is not enabled in .quay/config.yml (enabled providers: ${enabledIds.join(", ")})`
      );
    }
    if (!clients.has(id)) {
      clients.set(id, connectToProvider(cfg, id));
    }
    return clients.get(id);
  }

  const server = new McpServer({
    name: "quay-core",
    version: "0.0.1",
  });

  // provider://manifest — alias for the default-enabled Provider, for
  // single-Provider-workspace symmetry with each Provider's own manifest
  // resource.
  server.registerResource(
    "manifest",
    "provider://manifest",
    { description: "The default-enabled Provider's static self-declaration (provider.yml), proxied through Core." },
    async (uri) => {
      const { client } = await getClient(defaultId);
      const manifest = await client.manifest();
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(manifest, null, 2) }],
      };
    }
  );

  // provider://manifest/<id> — one real resource per enabled Provider, so an
  // Agent can enumerate every enabled Provider's own manifest without first
  // needing to know how many there are or call a tool to find out (MCP's
  // resource-listing mechanism itself answers that).
  for (const id of enabledIds) {
    server.registerResource(
      `manifest-${id}`,
      `provider://manifest/${id}`,
      { description: `Provider "${id}"'s static self-declaration (provider.yml), proxied through Core.` },
      async (uri) => {
        const { client } = await getClient(id);
        const manifest = await client.manifest();
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(manifest, null, 2) }],
        };
      }
    );
  }

  // task_list — aggregates/proxies task_list against one Provider, selected
  // via the optional `provider` argument (defaults to the default-enabled
  // Provider). Same shape as each Provider's own task_list tool, plus the
  // one added `provider` field.
  server.registerTool(
    "task_list",
    {
      description:
        "List tasks from an enabled Provider (defaults to the default-enabled Provider if `provider` is omitted), optionally filtered by status/label. Proxies the Provider's own task_list tool via Core's MCP client fan-out.",
      inputSchema: {
        provider: z.string().optional(),
        status: z.string().optional(),
        label: z.string().optional(),
      },
    },
    async ({ provider, status, label }) => {
      const { client } = await getClient(provider);
      const tasks = await client.taskList({ status, label });
      return {
        content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
        structuredContent: { tasks },
      };
    }
  );

  // task_get
  server.registerTool(
    "task_get",
    {
      description:
        "Get one task by id from an enabled Provider (defaults to the default-enabled Provider if `provider` is omitted). Proxies the Provider's own task_get tool.",
      inputSchema: {
        provider: z.string().optional(),
        id: z.string(),
      },
    },
    async ({ provider, id }) => {
      const { client } = await getClient(provider);
      const task = await client.taskGet(id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text", text: `no such task: ${id} (provider: ${provider || defaultId})` }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
        structuredContent: { task },
      };
    }
  );

  // task_write — generic passthrough (provider-client.js's own taskWrite is
  // already provider-agnostic per QN-024's comment; whether the selected
  // Provider actually implements data.write is between the caller and that
  // Provider's own manifest, same discipline as bin/quay.js's `task edit`).
  server.registerTool(
    "task_write",
    {
      description:
        "Write/patch one task's frontmatter and/or body on an enabled Provider (defaults to the default-enabled Provider). Proxies the Provider's own task_write tool.",
      inputSchema: {
        provider: z.string().optional(),
        id: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        labels: z.array(z.string()).optional(),
        parent: z.string().nullable().optional(),
        children: z.array(z.string()).optional(),
        body: z.string().optional(),
        extra: z.record(z.any()).optional(),
        expectedStatus: z.string().optional(),
      },
    },
    async ({ provider, id, ...patch }) => {
      const { client } = await getClient(provider);
      try {
        const task = await client.taskWrite({ id, ...patch });
        return {
          content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
          structuredContent: { task },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: err?.message ?? String(err) }],
        };
      }
    }
  );

  // task_check — generic passthrough, same pattern as task_write.
  server.registerTool(
    "task_check",
    {
      description:
        "Assert the ready/done gate for one task on an enabled Provider (defaults to the default-enabled Provider). Proxies the Provider's own task_check tool.",
      inputSchema: {
        provider: z.string().optional(),
        id: z.string(),
      },
    },
    async ({ provider, id }) => {
      const { client } = await getClient(provider);
      try {
        const result = await client.taskCheck(id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: err?.message ?? String(err) }],
        };
      }
    }
  );

  // action_list / action_run (DIR-010): mirror bin/quay.js's own `action
  // list`/`action run` subcommands (proposal §9's own "one capability set,
  // three bindings" list), so an Agent connected only via `quay mcp` can
  // enumerate and trigger action buttons, not merely list/get/write/check
  // tasks. Same generic, provider-agnostic passthrough shape as the four
  // existing tools above (optional `provider` argument, same
  // getClient()/error-handling convention) -- zero Provider-specific
  // branching, matching the standing "Core never special-cases a Provider
  // id" discipline (design §6.3, this file's own header comment).

  // action_list — same filtering logic as bin/quay.js's `action list`:
  // manifest.action_buttons filtered by whenStatus against the task's
  // current status.
  server.registerTool(
    "action_list",
    {
      description:
        "List the action buttons applicable to one task's current status, on an enabled Provider (defaults to the default-enabled Provider). Proxies the Provider's own manifest/task_get and applies the same whenStatus filter as `quay action list`.",
      inputSchema: {
        provider: z.string().optional(),
        id: z.string(),
      },
    },
    async ({ provider, id }) => {
      const { client } = await getClient(provider);
      const manifest = await client.manifest();
      const task = await client.taskGet(id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text", text: `no such task: ${id} (provider: ${provider || defaultId})` }],
        };
      }
      const buttons = (manifest.action_buttons ?? []).filter(
        (b) => !b.whenStatus || b.whenStatus.includes(task.status)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(buttons, null, 2) }],
        structuredContent: { buttons },
      };
    }
  );

  // action_run — same compose+deliver logic as bin/quay.js's `action run`.
  // Supports the DIR-009 mock/file-log delivery mode via an explicit
  // `mockLogPath` argument (rather than only the QUAY_ACTION_MOCK_LOG env
  // var bin/quay.js/serve.js read), so this tool's own regression test can
  // select deterministic delivery per-call without relying on process-wide
  // env state -- the same underlying deliverTrigger() contract, just wired
  // through an explicit MCP tool argument instead of an env var, since MCP
  // tool calls are the natural place for a caller-supplied argument rather
  // than ambient environment state.
  server.registerTool(
    "action_run",
    {
      description:
        "Compose and deliver one action-button trigger for a task, on an enabled Provider (defaults to the default-enabled Provider). Mirrors `quay action run`. Pass `mockLogPath` to select the deterministic mock/file-log delivery mode (DIR-009) instead of live manda/print delivery -- the same contract QUAY_ACTION_MOCK_LOG selects for the CLI and Web UI.",
      inputSchema: {
        provider: z.string().optional(),
        id: z.string(),
        actionId: z.string(),
        mockLogPath: z.string().optional(),
      },
    },
    async ({ provider, id, actionId, mockLogPath }) => {
      const { client } = await getClient(provider);
      const manifest = await client.manifest();
      const task = await client.taskGet(id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text", text: `no such task: ${id} (provider: ${provider || defaultId})` }],
        };
      }
      let payloadObj;
      try {
        payloadObj = composePayload({ providerManifest: manifest, task, actionId });
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: err?.message ?? String(err) }],
        };
      }
      const channel = `task-${id}`;
      const envMockLogPath = mockLogPath || process.env.QUAY_ACTION_MOCK_LOG || undefined;
      const result = await deliverTrigger({
        root: cfg.workspaceRoot,
        channel,
        payloadObj,
        mockLogPath: envMockLogPath,
      });
      const combined = { ...payloadObj, channel, ...result };
      return {
        content: [{ type: "text", text: JSON.stringify(combined, null, 2) }],
        structuredContent: combined,
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `quay mcp: aggregating enabled providers [${enabledIds.join(", ")}] (default: ${defaultId})`
  );

  // Close every connected Provider client when the Core server's own
  // transport closes (stdin closes), so no orphaned Provider subprocess is
  // left running after the Agent disconnects.
  transport.onclose = async () => {
    for (const pending of clients.values()) {
      try {
        const { client } = await pending;
        await client.close();
      } catch {
        // best-effort cleanup
      }
    }
  };
}
