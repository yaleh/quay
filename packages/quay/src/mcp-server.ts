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
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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

// ── instrument entry point (gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point) ─────
// The 81+ instruments under plugin/scripts are reachable only by remembering a path and writing
// `node --experimental-strip-types plugin/scripts/<name>.ts`. The `instrument` tool below is the
// discoverable entry point (AC3: ONE tool with `action: "list" | "run"`, not 36 schemas — context
// cost; AC5: discovery becomes a tool call instead of a remembered path). The directory and the
// instrument count are DERIVED from the filesystem by plugin/scripts/runtime-usage-inventory.ts —
// never hardcoded here — and the ADMISSION FILTER (AC4: a script that cannot say what question it
// answers does not get in) is applied in that same derivation. The Core stays decoupled from the
// plugin layer: this file only SPAWNS the inventory tool's CLI and parses its JSON (the JSON shape
// below mirrors the inventory tool's --instruments-json output).

interface InstrumentEntry {
  name: string;
  path: string;
  description: string;
  kind: string;
}
interface InstrumentsManifest {
  generatedAt: string;
  root: string;
  total: number;
  admitted: number;
  notAdmitted: string[];
  instruments: InstrumentEntry[];
}

function spawnCapture(command: string, args: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ exitCode: 1, stdout, stderr: String(err.message ?? err) }));
    child.on("close", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
  });
}

/**
 * Resolve a plugin script path to a runnable executable, preferring the raw source form and
 * falling back to the bundled dist form (gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-
 * the-artifact). The shipped npm-pack artifact carries the plugin's consumer-referenced .ts as
 * bundled `plugin/scripts/dist/*.js` executables (no .ts source), so `plugin/scripts/foo.ts` must
 * resolve to `plugin/scripts/dist/foo.js` there; a source checkout keeps the .ts and is used as-is.
 */
function resolvePluginExecutable(
  workspaceRoot: string,
  relPath: string
): { path: string; stripTypes: boolean } {
  const abs = path.resolve(workspaceRoot, relPath);
  if (fs.existsSync(abs)) return { path: abs, stripTypes: relPath.endsWith(".ts") };
  if (relPath.endsWith(".ts")) {
    const bundled = relPath.replace(/\.ts$/, ".js").replace(/\/(scripts|gate-scripts)\//, "/$1/dist/");
    const absBundled = path.resolve(workspaceRoot, bundled);
    if (fs.existsSync(absBundled)) return { path: absBundled, stripTypes: false };
  }
  return { path: abs, stripTypes: relPath.endsWith(".ts") };
}

/** Spawn the inventory tool's `--instruments-json` mode to DERIVE the instrument directory. */
export async function fetchInstrumentsManifest(workspaceRoot: string): Promise<InstrumentsManifest> {
  const inventoryRel = path.join("plugin", "scripts", "runtime-usage-inventory.ts");
  const resolved = resolvePluginExecutable(workspaceRoot, inventoryRel);
  if (!fs.existsSync(resolved.path)) {
    throw new Error(
      `instrument directory unavailable: ${inventoryRel} (or its dist bundle) is not present under workspace root ${workspaceRoot}`
    );
  }
  const argv = resolved.stripTypes
    ? ["--experimental-strip-types", resolved.path, "--instruments-json", "--root", workspaceRoot]
    : [resolved.path, "--instruments-json", "--root", workspaceRoot];
  const r = await spawnCapture(process.execPath, argv, workspaceRoot);
  if (r.exitCode !== 0) {
    throw new Error(`instrument directory build failed (exit ${r.exitCode}): ${r.stderr || r.stdout}`);
  }
  return JSON.parse(r.stdout) as InstrumentsManifest;
}

/** Resolve an instrument by name from the derived directory, then run it under its interpreter. */
export async function runInstrument(
  workspaceRoot: string,
  name: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const manifest = await fetchInstrumentsManifest(workspaceRoot);
  const entry = manifest.instruments.find((i) => i.name === name);
  if (!entry) {
    throw new Error(
      `no such instrument: "${name}" (the admitted directory has ${manifest.admitted}; call instrument action:list to see them)`
    );
  }
  const resolved = resolvePluginExecutable(workspaceRoot, entry.path);
  const command = entry.kind === "bash" ? "bash" : process.execPath;
  const argv = entry.kind === "bash" ? [resolved.path, ...args] : resolved.stripTypes ? ["--experimental-strip-types", resolved.path, ...args] : [resolved.path, ...args];
  return spawnCapture(command, argv, workspaceRoot);
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

  // instrument — the discoverable entry point for the plugin/scripts instruments
  // (gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point, AC3/AC5). Workspace-scoped
  // (like config_validate), not Provider-routed: there is no `provider` argument. Registered here in
  // mcp-server.ts rather than mcp-handlers.ts because this task's Touches are limited to this file +
  // the inventory tool + its doc; the handler body is the two exported helpers above.
  server.registerTool(
    "instrument",
    {
      description:
        "Discover and run the workspace's plugin/scripts instruments (previously reachable only by remembering " +
        "a path and writing `node --experimental-strip-types plugin/scripts/<name>.ts`). ONE tool, two actions. " +
        "`action: \"list\"` returns the DERIVED instrument directory: every instrument that declares what question " +
        "it answers (via `@instrument \"...\"` in its header comment, or the header's own `<basename> — <description>` " +
        "line), with name/path/description/kind, plus `total` (the derived count — never hardcoded) and `notAdmitted` " +
        "(instruments that could not say what they answer — kept OUT by the admission filter). " +
        "`action: \"run\"` with `name` (+ optional `args`) invokes one instrument: node scripts run under " +
        "`node --experimental-strip-types`, `.sh` scripts under bash; stdout is returned and a non-zero exit is isError.",
      inputSchema: {
        action: z.enum(["list", "run"]),
        name: z.string().optional().describe("instrument name (basename without extension) — required for action: \"run\""),
        args: z.array(z.string()).optional().describe("CLI args forwarded to the instrument (action: \"run\")"),
      },
    },
    async ({ action, name, args }) => {
      try {
        if (action === "list") {
          const manifest = await fetchInstrumentsManifest(cfg.workspaceRoot);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(manifest, null, 2) }],
            structuredContent: manifest as unknown as Record<string, unknown>,
          };
        }
        if (!name) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "instrument run requires a `name` (the instrument's basename without extension)" }],
          };
        }
        const r = await runInstrument(cfg.workspaceRoot, name, args ?? []);
        return {
          isError: r.exitCode !== 0,
          content: [{ type: "text" as const, text: r.exitCode === 0 ? r.stdout : (r.stderr || r.stdout || `exit ${r.exitCode}`) }],
          structuredContent: { name, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }],
        };
      }
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
  //
  // gap-mcp-server-test-deadlocks-at-high-test-concurrency: close providers in
  // PARALLEL (Promise.allSettled) rather than sequentially. The SDK client's
  // StdioClientTransport.close() gives this process only a 2s grace before it
  // SIGTERMs, and 2s more before SIGKILL. Sequential provider closes multiply
  // the cleanup time by the number of enabled providers — under load (a long
  // batch at conc=8/16) that can exceed 2s, so the client SIGTERMs this process
  // MID-cleanup and the not-yet-closed Provider subprocesses are orphaned.
  // Parallel close keeps the whole tree's shutdown inside the grace window.
  //
  // closeAllProviders is extracted (not inline) so BOTH the transport onclose
  // path and the SIGTERM/SIGINT path below run the same provider cleanup.
  async function closeAllProviders(): Promise<void> {
    await Promise.allSettled(
      [...clients.values()].map(async (pending) => {
        try {
          const { client } = await pending;
          await client.close();
        } catch {
          // best-effort cleanup
        }
      })
    );
  }
  transport.onclose = () => {
    void closeAllProviders();
  };

  // gap-suite-speedup (task gap-suite-speedup): when the client disconnects
  // (stdin EOF), close the transport — which runs the onclose handler above
  // and terminates every Provider subprocess this Core server spawned. The
  // SDK StdioServerTransport only watches stdin for 'data'/'error', never
  // 'end'/'close', so without this the Core process (and each still-alive
  // Provider child) survives stdin EOF — an SDK client's
  // StdioClientTransport.close() must then fall back to its 2s SIGTERM
  // timeout, and a Provider child orphaned by that SIGTERM keeps running
  // indefinitely. Closing the transport on stdin EOF makes the whole tree
  // exit promptly on disconnect. No change to serving behavior.
  process.stdin.on("close", () => {
    void transport.close();
  });

  // gap-mcp-server-test-deadlocks-at-high-test-concurrency: if the SDK client's
  // close() SIGTERMs us (its 2s grace elapsed before our stdin-EOF cleanup
  // finished — possible under load), close the providers and exit rather than
  // dying mid-cleanup and orphaning them. SIGKILL (the SDK's last resort) is
  // uncatchable, so this is the final hand we get; after it the providers are
  // piped (see provider-client.ts) so an orphan would not hold the runner's
  // stderr anyway — this just reclaims the subprocesses too.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      void closeAllProviders().finally(() => process.exit(0));
    });
  }
}
