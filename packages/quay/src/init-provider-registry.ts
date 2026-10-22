// init-provider-registry.ts — the EXTENSION POINT for "what a provider contributes to a fresh
// install's `.quay/config.yml`" (DIR-133 裁定 2; task gap-init-ts-4214-line-slice-with-extension-
// point-first).
//
// WHY THIS FILE EXISTS: before the slice, adding a provider meant editing `init.ts` — the native
// provider's `providers:` block (its `tasks_dir`, its four `QUAY_NATIVE_*` carrier pins, and the
// ruling that it must declare NO `path:`/`mcp_entry:`) was hardcoded in `generateConfigContent`,
// next to a hardcoded commented-out github example. That is the shape both previous slices in this
// repo regretted: extracting a REGION without building an extension point, after which 82% of the
// growth went straight back into the centre file (quay `worker` 2440b52d0; plantuml-js `elk.ts`
// 570→150→278 lines).
//
// THE EXTENSION POINT: a `ProviderInitDescriptor` is the unit new code registers. `init.ts` calls
// `renderProviderSection` and never names a provider — registering a descriptor HERE (or from any
// other module via `PROVIDER_INIT_REGISTRY.register(...)`) is the whole act of teaching `quay init`
// about a new provider. Nothing in the centre changes.
//
// ⛔ NOT in scope of this axis (deliberately): the EXISTING-config edit paths (`upgradeConfigContent`,
// `ensureProviderCarrierEnvText`'s `CARRIER_KINDS`, `corruptBackupPathFor`). Those mutate a config a
// user already owns; they are a different axis with a different failure mode and are left untouched.
//
// The `wildcard` sentinel: the fallback descriptor renders under whatever id the caller asked for.
// It is EXACT-LOOKUP-INVISIBLE (`lookup("*")` on an unregistered id returns null), which is what
// keeps "no descriptor registered" distinguishable from "a descriptor rendered it" — the negative
// arm of the four-piece criterion set reads that difference (硬规则 3b: an unregistered id must not
// share the shape of a registered one).

/** Everything a descriptor needs to render its slice of the fresh-install template. */
export interface ProviderInitRenderContext {
  /** The provider id the caller asked for (a wildcard descriptor renders under THIS key). */
  providerId: string;
  /** The provider package root, relative to the workspace root (e.g. `./packages/quay-native`). */
  providerPath: string;
  /** Workspace-relative → template path, exactly as the caller resolves it (absolute with a root). */
  abs: (rel: string) => string;
}

/** One provider's contribution to the fresh-install `providers:` section. */
export interface ProviderInitDescriptor {
  /** The `providers.<id>:` key this descriptor renders under. */
  id: string;
  /**
   * Render under the CALLER's provider id instead of `id` — the fallback descriptor's sentinel.
   * Never returned by `lookup()`: the fallback is resolution, not registration.
   */
  wildcard?: boolean;
  /** Lines emitted under the key line (indent 4). The key line is the renderer's, not the body's. */
  renderBody(ctx: ProviderInitRenderContext): string[];
  /** Extra lines emitted after ALL entries (e.g. a commented-out example). */
  renderTrailing?(ctx: ProviderInitRenderContext): string[];
}

/** The lookup table the renderer consults. Same object shape a leaky test double can stand in for. */
export interface ProviderInitRegistry {
  /** Register (or replace) a descriptor by exact id. */
  register(descriptor: ProviderInitDescriptor): void;
  /** EXACT registration only — null for an unregistered id, always including the wildcard fallback. */
  lookup(id: string): ProviderInitDescriptor | null;
  /** What the renderer uses: exact registration, else the wildcard fallback. */
  resolve(id: string): ProviderInitDescriptor;
  /** Every REGISTERED descriptor (the wildcard fallback is not one). */
  list(): ProviderInitDescriptor[];
}

/**
 * Pick the provider MCP server launch entry based on the RESOLVED provider
 * path form (gap-init-scaffolds-mcp-entry-to-raw-ts-fails-on-installed-copy).
 *
 * - INSTALLED form (the provider path contains a `node_modules` segment —
 *   e.g. `./node_modules/quay-native`, an npm-installed copy): launch the
 *   bundled dist ESM `./dist/quay-native.js` — the SAME target package.json's
 *   `bin` field points at. Raw `.ts` under node_modules is refused by Node
 *   ≥23.7 (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so the bundled JS
 *   is the only runnable form there.
 * - DEV form (the provider path is inside the repo tree — e.g.
 *   `./packages/quay-native` or a `../../...` repo-relative path): keep the
 *   raw TypeScript entry `./bin/quay-native.ts`, which runs fine outside
 *   node_modules.
 *
 * The Core's provider launcher resolves mcp_entry relative to provider.path,
 * so both forms are `./`-relative within the provider package root.
 */
export function mcpEntryForProvider(providerPath: string): string {
  const segments = providerPath.split(/[\\/]+/);
  const installed = segments.includes("node_modules");
  return installed
    ? '["node", "./dist/quay-native.js", "mcp"]'
    : '["node", "./bin/quay-native.ts", "mcp"]';
}

// These strings contain characters that confuse Node 26's TypeScript parser
// when embedded in template literals, so they are stored as raw strings.
const GH_TOKEN_SHELL_REF = "${GITHUB_TOKEN}";

/**
 * The generic doc block the `providers:` section opens with — the SHAPE every provider entry has.
 * It lives here, next to the descriptors, because it is provider-surface documentation: a section
 * that documents an entry format the renderer no longer owns is the drift this slice removes.
 */
export const PROVIDER_ENTRIES_HELP: readonly string[] = [
  "# quay is provider-agnostic: tasks can live on a local filesystem",
  "# (native provider), in GitHub Issues (github provider), or in any",
  "# backend that implements the Provider ABI.",
  "#",
  "# Each provider entry declares:",
  "#   enabled: true/false     — exactly ONE provider must be enabled",
  "#   path: <dir>             — provider package root (relative to workspaceRoot). OPTIONAL for the",
  "#                             native provider: Core resolves it from the plugin root when omitted.",
  "#   tasks_dir: <dir>        — where task files live (relative to workspaceRoot)",
  "#   mcp_entry: [cmd, args]  — how to launch the provider's MCP server (relative to provider.path).",
  "#                             OPTIONAL for the native provider (Core derives it from the plugin root);",
  "#                             REQUIRED for every other provider.",
  "#   env: <map>              — environment variables passed to the MCP server process",
  "#   default_task_status: todo|ready  — status for new tasks when none is specified (default: todo)",
  "#",
];

/**
 * The reference provider's fresh-install block.
 *
 * ⛔ NO `path:` / NO `mcp_entry:` here (gap-project-quay-pointer-is-init-plugin-root-and-version-
 * records-derive-from-it (D), human ruling 2026-10-06): a declared path freezes the runtime to the
 * install-cache version that wrote it, so a plugin upgrade never takes effect. Core resolves the
 * native binding from its OWN plugin root (`plugin-root.ts`) — the single resolver — and the shipped
 * shell writer emits the same shape. The two fresh-install writers disagreeing about these two keys
 * is exactly the drift AC-331 removes.
 */
export const NATIVE_PROVIDER_INIT: ProviderInitDescriptor = {
  id: "native",
  renderBody({ abs }) {
    return [
      "    enabled: true",
      "    tasks_dir: " + JSON.stringify(abs("tasks")),
      "    env:",
      "      QUAY_NATIVE_TASKS_DIR: " + JSON.stringify(abs("tasks")),
      "      QUAY_NATIVE_GOAL_DIR: " + JSON.stringify(abs("goals")),
      "      QUAY_NATIVE_ADR_DIR: " + JSON.stringify(abs("adr")),
      "      QUAY_NATIVE_META_DIR: " + JSON.stringify(abs("meta")),
      "    # default_task_status: todo   # uncomment to change default status for new tasks",
    ];
  },
};

/**
 * The second registered provider — a REAL registration, not a doc string: asking for
 * `providerId: "github"` now emits a live block through the same mechanism as native's, and the
 * commented example below is that same descriptor rendered as a template.
 */
export const GITHUB_PROVIDER_INIT: ProviderInitDescriptor = {
  id: "github",
  renderBody({ providerPath, abs }) {
    return [
      "    enabled: true",
      "    path: " + JSON.stringify(providerPath),
      "    tasks_dir: " + JSON.stringify(abs("tasks")),
      "    mcp_entry: " + mcpEntryForProvider(providerPath),
      "    env:",
      '      GITHUB_TOKEN: "' + GH_TOKEN_SHELL_REF + '"',
      '      GITHUB_REPO: "owner/repo"',
    ];
  },
  renderTrailing() {
    return [
      "",
      "  # GitHub provider (uncomment to use GitHub Issues as your task store):",
      "  # github:",
      "  #   enabled: false",
      '  #   path: "./node_modules/quay-github"',
      '  #   tasks_dir: "./tasks"',
      '  #   mcp_entry: ["node", "./bin/quay-github.mjs", "mcp"]',
      "  #   env:",
      '  #     GITHUB_TOKEN: "' + GH_TOKEN_SHELL_REF + '"',
      '  #     GITHUB_REPO: "owner/repo"',
    ];
  },
};

/**
 * The wildcard fallback: a provider with no registered descriptor still gets a valid entry (a
 * declared `path:` + `mcp_entry:` + `tasks_dir:`, i.e. every key a NON-native provider needs). It
 * carries no provider-specific key — that is the point: the centre knows the ABI shape, descriptors
 * know the provider.
 */
export const GENERIC_PROVIDER_INIT: ProviderInitDescriptor = {
  id: "*",
  wildcard: true,
  renderBody({ providerPath, abs }) {
    return [
      "    enabled: true",
      "    path: " + JSON.stringify(providerPath),
      "    tasks_dir: " + JSON.stringify(abs("tasks")),
      "    mcp_entry: " + mcpEntryForProvider(providerPath),
    ];
  },
};

/** The descriptors a fresh registry is seeded with (registration order = trailing-example order). */
export const DEFAULT_PROVIDER_INIT_DESCRIPTORS: readonly ProviderInitDescriptor[] = [
  NATIVE_PROVIDER_INIT,
  GITHUB_PROVIDER_INIT,
];

/** Build a registry. `seed` defaults to the built-ins; a test double can seed nothing and stay empty. */
export function createProviderInitRegistry(
  seed: readonly ProviderInitDescriptor[] = DEFAULT_PROVIDER_INIT_DESCRIPTORS,
): ProviderInitRegistry {
  const byId = new Map<string, ProviderInitDescriptor>();
  for (const descriptor of seed) byId.set(descriptor.id, descriptor);
  return {
    register(descriptor) {
      byId.set(descriptor.id, descriptor);
    },
    lookup(id) {
      return byId.get(id) ?? null;
    },
    resolve(id) {
      return byId.get(id) ?? GENERIC_PROVIDER_INIT;
    },
    list() {
      return [...byId.values()];
    },
  };
}

/** The process-wide registry `quay init` renders from. Register here to extend the fresh install. */
export const PROVIDER_INIT_REGISTRY: ProviderInitRegistry = createProviderInitRegistry();

export interface RenderProviderSectionOpts {
  providerId: string;
  providerPath: string;
  abs: (rel: string) => string;
  /** Defaults to the process-wide registry (the production path; tests inject a double instead). */
  registry?: ProviderInitRegistry;
}

/**
 * Render every line that follows `providers:` — the requested provider's block first, then each
 * registered descriptor's trailing example (never the one that just rendered).
 */
export function renderProviderSection(o: RenderProviderSectionOpts): string[] {
  const ctx: ProviderInitRenderContext = {
    providerId: o.providerId,
    providerPath: o.providerPath,
    abs: o.abs,
  };
  const registry = o.registry ?? PROVIDER_INIT_REGISTRY;
  const descriptor = registry.resolve(o.providerId);
  const key = descriptor.wildcard ? o.providerId : descriptor.id;
  const out: string[] = [`  ${key}:`, ...descriptor.renderBody(ctx)];
  for (const other of registry.list()) {
    if (other === descriptor || !other.renderTrailing) continue;
    out.push(...other.renderTrailing(ctx));
  }
  return out;
}
