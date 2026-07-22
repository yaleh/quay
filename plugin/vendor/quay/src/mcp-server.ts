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
//       own MCP server via connectProvider() (provider-client.ts's existing,
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
//
// Handler implementations live in ./mcp-handlers.ts (ARCH-M93-002
// decomposition) — this file is the thin registration wrapper.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { loadConfig, activeProvider } from "./config.ts";
import { connectProvider } from "./provider-client.ts";
import { resolveProviderEnv } from "./provider-env.ts";
import { type ConnectedProvider, registerAllHandlers } from "./mcp-handlers.ts";

// QX-035 (experiment 4, iteration 10): read package version at startup for
// Mitigation A (_version field in task_list response) and Mitigation B
// (Version: in tool description). ENV-001 mitigation — lets AI agent consumers
// detect MCP server staleness by comparing _version against their expected version.
// (Extracted to ./version.ts so the SEA build can alias it to a
// build-time-embedded shim — see scripts/version-sea-shim.js.)

// resolveProviderEnv is now imported from ./provider-env.ts (QN-045): this
// file, bin/quay.js, and serve.ts all share the single implementation there
// — the "duplicated here rather than imported" note this comment previously
// carried is resolved; see provider-env.ts's own header for why (DESIGN.md
// §4.4's asymmetry).

async function connectToProvider(cfg: ReturnType<typeof loadConfig>, providerId: string | undefined): Promise<ConnectedProvider> {
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
function enabledProviderIds(cfg: ReturnType<typeof loadConfig>): string[] {
  const providers = (cfg.config as Record<string, unknown>).providers as Record<string, { enabled?: boolean }> ?? {};
  return Object.keys(providers).filter((id) => providers[id].enabled);
}

export async function startMcpServer(): Promise<void> {
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
  const clients = new Map<string, Promise<ConnectedProvider>>(); // providerId -> Promise<{id, client}>
  function getClient(providerId: string | undefined): Promise<ConnectedProvider> {
    const id = providerId || defaultId;
    if (!enabledIds.includes(id)) {
      throw new Error(
        `quay mcp: provider "${id}" is not enabled in .quay/config.yml (enabled providers: ${enabledIds.join(", ")})`
      );
    }
    if (!clients.has(id)) {
      clients.set(id, connectToProvider(cfg, id));
    }
    return clients.get(id) as Promise<ConnectedProvider>;
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

  // Delegate tool registrations to domain handler groups (ARCH-M93-002).
  registerAllHandlers(server, getClient, cfg);

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
