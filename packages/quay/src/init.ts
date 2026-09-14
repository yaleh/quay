// quay init — workspace scaffolding (DIR-098 / M164).
// Generates .quay/config.yml with all 3 sections (providers, gates, loop) +
// inline documentation, creates tasks/ dir, prints next-step instructions.
//
// Shared between Core CLI (packages/quay/bin/quay.ts) and native CLI
// (packages/quay-native/bin/quay-native.ts).

import fs from "node:fs";
import path from "node:path";
import { ensureBranchModel, formatBranchModelReport, type BranchModelReport } from "./branch-model.ts";

/**
 * Result of an init operation.
 */
export interface InitResult {
  /**
   * "written" | "dry-run" | "skipped" (existing, no --force) |
   * "branch-model-blocked" (divergent landing baseline without adoption) |
   * "branch-model-only" (the config-free branch-model entry — see `branchModelOnly`).
   */
  outcome: string;
  /** Absolute path to the config file that was (or would be) written. */
  configPath: string;
  /** Absolute path to the tasks dir that was (or would be) created. */
  tasksDir: string;
  /** The full generated config YAML content (for dry-run printing). */
  content: string;
  /** Absolute path to the .claude/launch.settings.json scaffold. */
  launchSettingsPath: string;
  /** The full generated launch.settings.json content (for dry-run printing). */
  launchSettingsContent: string;
  /** Absolute path to the .quay/profiles.yml scaffold. */
  profilesPath: string;
  /** The full generated .quay/profiles.yml content (for dry-run printing). */
  profilesContent: string;
  /**
   * The quay branch model this init established (or would establish). See branch-model.ts: the
   * landing baseline (`develop`) the fan-in/anti-drift path reads is ESTABLISHED here, never
   * assumed — that is the whole fix for
   * gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing.
   */
  branchModel: BranchModelReport;
  /** `formatBranchModelReport(branchModel)` — the operator-facing rendering. */
  branchModelReport: string;
}

/**
 * Options for the init command.
 */
export interface InitOptions {
  /** Project root path (default: CWD). */
  root: string;
  /** Overwrite existing config. */
  force: boolean;
  /** Print to stdout instead of writing to disk. */
  dryRun: boolean;
  /** Provider id override (default: auto-detect). */
  provider?: string;
  /**
   * Adopt a foreign landing baseline instead of refusing it (branch-model.ts). When the target
   * project already has a `develop` (or `author`) that is NOT a continuation of its default branch,
   * the default behavior is to REFUSE — reusing it silently would make every task's anti-drift diff
   * meaningless. With this flag the existing tip is preserved under
   * `<branch>-pre-quay-init-<sha>` and the branch is re-pointed at the default branch tip.
   * Nothing is destroyed either way; the flag only decides whether init proceeds or stops.
   */
  adoptBranchModel?: boolean;
  /**
   * The CONFIG-FREE branch-model entry (`quay init --branch-model-only`) — establish the quay branch
   * model in an ALREADY-initialized project and touch nothing else.
   *
   * WHY THIS EXISTS (gap-upgrade-entry-never-establishes-branch-model): the SHIPPED upgrade entry is
   * `plugin/scripts/quay-init.sh` (SPEC §5 — what a real user runs, and what `/quay:init` runs), not
   * this CLI. `ensureBranchModel` was reachable only through a full `quay init`, which REWRITES the
   * whole config surface (`generateConfigContent`) — so on an existing project with its own `gates:`
   * / `loop:` / `routines:` the one available remedy was also the one that destroys the user's
   * config. That is exactly the write the shipped script's config-preserving branch exists to avoid.
   * The result was a project whose `develop` is a foreign fork having NO path that both establishes
   * the branch model and preserves its config — so it stayed un-landable forever, and the shell entry
   * silently wrote `fork_baseline: develop` (`quay-init.sh:995/:2217`) without ever establishing it.
   *
   * ⇒ This flag runs `ensureBranchModel` (the SAME single implementation, ADR-004 — the shell does not
   * re-implement `classifyBranch`) and returns immediately: no config write, no tasks/ mkdir, no
   * profiles/launch-settings lay-down. The config-exists refusal that guards the full `quay init` does
   * NOT apply here (an existing config is the NORMAL input — this entry exists for initialized
   * projects).
   */
  branchModelOnly?: boolean;
}

// These strings contain characters that confuse Node 26's TypeScript parser
// when embedded in template literals, so they are stored as raw strings.
const GH_TOKEN_REF = "$GITHUB_TOKEN";
const GH_TOKEN_SHELL_REF = "${GITHUB_TOKEN}";

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

/**
 * Generate the full .quay/config.yml content with all 3 sections and inline
 * documentation for every supported field.
 */
export function generateConfigContent(opts: { providerId: string; providerPath: string; isNode: boolean; isGo: boolean }): string {
  const { providerId, providerPath, isNode, isGo } = opts;

  // Build gate suggestions based on project type.
  const gateSuggestions = buildGateSuggestions({ isNode, isGo });

  const lines: string[] = [
    "# .quay/config.yml — quay workspace configuration",
    "# Generated by `quay init`. See README.md or run `quay --help` for usage.",
    "",
    "# " + ruleLine(69),
    "# Section 1: Providers — where tasks live",
    "# " + ruleLine(69),
    "# quay is provider-agnostic: tasks can live on a local filesystem",
    "# (native provider), in GitHub Issues (github provider), or in any",
    "# backend that implements the Provider ABI.",
    "#",
    "# Each provider entry declares:",
    "#   enabled: true/false     — exactly ONE provider must be enabled",
    "#   path: <dir>             — provider package root (resolved relative to workspaceRoot)",
    "#   tasks_dir: <dir>        — where task files live (relative to workspaceRoot)",
    "#   mcp_entry: [cmd, args]  — how to launch the provider's MCP server (resolved relative to provider.path)",
    "#   env: <map>              — environment variables passed to the MCP server process",
    "#   default_task_status: todo|ready  — status for new tasks when none is specified (default: todo)",
    "#",
    "providers:",
    "  " + providerId + ":",
    "    enabled: true",
    "    path: \"" + providerPath + "\"",
    "    tasks_dir: \"./tasks\"",
    "    mcp_entry: " + mcpEntryForProvider(providerPath),
    "    env:",
    "      QUAY_NATIVE_TASKS_DIR: \"./tasks\"",
    "    # default_task_status: todo   # uncomment to change default status for new tasks",
    "",
    "  # GitHub provider (uncomment to use GitHub Issues as your task store):",
    "  # github:",
    "  #   enabled: false",
    "  #   path: \"./node_modules/quay-github\"",
    "  #   tasks_dir: \"./tasks\"",
    "  #   mcp_entry: [\"node\", \"./bin/quay-github.mjs\", \"mcp\"]",
    "  #   env:",
    "  #     GITHUB_TOKEN: \"" + GH_TOKEN_SHELL_REF + "\"",
    "  #     GITHUB_REPO: \"owner/repo\"",
    "",
    "# " + ruleLine(69),
    "# Section 2: Gates — automated quality checks",
    "# " + ruleLine(69),
    "# Gates are named, runnable checks that evaluate tasks. The gate engine",
    "# (QENG) runs them via `quay gate <task-id> [--gate <name>]`.",
    "#",
    "# Six gate types are supported:",
    "#   it0            — runs a script with args; argsKey names a task.extra",
    "#                    field whose value is passed as the script argument.",
    "#   adr            — checks that an ADR exists in the workspace adr/ dir.",
    "#   fixed          — runs a fixed script (no per-task args).",
    "#   testPass       — runs a test command; PASS if exit 0.",
    "#   coverageFloor  — runs a coverage command; parses output for a",
    "#                     percentage and PASS if >= floor.",
    "#   redGreen       — runs a RED command (must fail), then a GREEN",
    "#                     command (must pass) — RED->GREEN per ADR-001.",
    "#",
    "# All gate entries support optional cwd (working directory override) and",
    "# timeoutMs (millisecond deadline override).",
    "#",
    "gates:",
    "  # Built-in acceptance gate — always available, runs task.extra.acceptance",
    "  # as a shell command. Fail-closed if unset on a task.",
    "",
    "  # it0 gates — script-driven checks with per-task args:",
    "  # it0:",
    "  #   - name: dod-check          # gate name (used with --gate dod-check)",
    "  #     script: \"./scripts/it0-dod-check.sh\"",
    "  #     argsKey: acceptance       # reads task.extra.acceptance as the arg",
    "  #     # cwd: \"./subdir\"         # optional working directory",
    "  #     # timeoutMs: 120000        # optional timeout in milliseconds",
    "",
    "  # ADR gates — existence checks on architecture decision records:",
    "  # adr:",
    "  #   - ADR-001",
    "  #   - ADR-002",
    "",
    "  # Fixed-script gates — same script every run, no per-task args:",
    "  # fixed:",
    "  #   - name: lint",
    "  #     script: \"./scripts/lint.sh\"",
    "",
    "  # Test-pass gate" + gateSuggestions.testPassComment + ":",
    ...gateSuggestions.testPassLines,
    "",
    "  # Coverage-floor gate — runs a command and checks coverage percentage:",
    "  # coverageFloor:",
    "  #   - name: coverage-80",
    "  #     command: \"node --test --experimental-test-coverage test/*.mjs\"",
    "  #     floor: 80",
    "  #     # pattern: \"All files\"     # optional regex to extract coverage line",
    "",
    "  # Red-green gate — RED must fail, GREEN must pass (ADR-001):",
    "  # redGreen:",
    "  #   - name: red-green-tests",
    "  #     red: \"node --test --test-name-pattern='failing test' test/*.mjs\"",
    "  #     green: \"node --test test/*.mjs\"",
    "",
    "# " + ruleLine(69),
    "# Section 3: Loop — autonomous iteration driver",
    "# " + ruleLine(69),
    "# The loop driver (`quay run`) scans the board for ready tasks and drives",
    "# them through gate checks. Configured here or in .quay/loop.yml (legacy).",
    "#",
    "# Fields:",
    "#   board: <provider>         REQUIRED — which provider to scan (e.g. \"native\")",
    "#   gates: <name> | [names]   REQUIRED — gate(s) to run on each task",
    "#   stop: <policy>            OPTIONAL — when to stop (default \"once\"):",
    "#                               \"once\"         — process one ready task",
    "#                               \"until(.halt)\"  — stop when .halt sentinel exists",
    "#                               \"until(empty)\"  — stop when no ready tasks remain",
    "#                               \"until(<cond>)\" — stop on custom condition",
    "#   policy: <name>            OPTIONAL — task selection ranking (default \"ready-first\")",
    "#   execution: dispatched|inline  OPTIONAL — build style (default \"dispatched\"):",
    "#                               \"dispatched\" — fresh background subagent per task",
    "#                               \"inline\"     — run in the driver's own context",
    "#   audit: adversarial|none   OPTIONAL — audit style (default \"adversarial\"):",
    "#                               \"adversarial\" — fresh subagent audits diff before land",
    "#                               \"none\"        — gate-output only, no independent audit",
    "#   concurrency: <int>        OPTIONAL — max parallel builds (default 1, serial).",
    "#                               >1 requires touches-disjoint tasks.",
    "#   routines:                 OPTIONAL — standing routine track (periodic tasks):",
    "#     - name: <string>          routine name",
    "#       trigger: every(N)|on(<event>)  when to fire",
    "#       dispatch: <prompt>      (legacy) prompt to dispatch",
    "#       probe: <name>           (DIR-056) probe-spec name",
    "#",
    "loop:",
    "  board: \"" + providerId + "\"",
    "  gates: []",
    "  # stop: \"once\"                # uncomment and set your preferred stop policy",
    "  # policy: \"ready-first\"        # uncomment to customize task selection",
    "  # execution: \"dispatched\"      # uncomment to use inline builds",
    "  # audit: \"adversarial\"         # uncomment to skip adversarial audit",
    "  # concurrency: 1               # uncomment for parallel builds (requires touches-disjoint)",
    "  # routines:                    # uncomment to add periodic routines",
    "  #   - name: \"health-check\"",
    "  #     trigger: \"every(60)\"",
    "  #     probe: \"health\"",
    "",
  ];

  return lines.join("\n");
}

function ruleLine(len: number): string {
  return "─".repeat(len);
}

interface GateSuggestion {
  testPassComment: string;
  testPassLines: string[];
}

function buildGateSuggestions({ isNode, isGo }: { isNode: boolean; isGo: boolean }): GateSuggestion {
  if (isNode) {
    return {
      testPassComment: " — runs a test command, PASS if exit 0",
      testPassLines: [
        "  # testPass:",
        "  #   - name: node-tests",
        "  #     command: \"node --test test/*.mjs\"",
      ],
    };
  }
  if (isGo) {
    return {
      testPassComment: " — runs a test command, PASS if exit 0",
      testPassLines: [
        "  # testPass:",
        "  #   - name: go-tests",
        "  #     command: \"go test ./...\"",
      ],
    };
  }
  return {
    testPassComment: " (no project-type detected; uncomment and edit to match your stack)",
    testPassLines: [
      "  # testPass:",
      "  #   - name: tests",
      "  #     command: \"your-test-command-here\"",
    ],
  };
}

/**
 * Detect the project type from the target root.
 */
export function detectProjectType(root: string): { isNode: boolean; isGo: boolean } {
  const isNode = fs.existsSync(path.join(root, "package.json"));
  const isGo = fs.existsSync(path.join(root, "go.mod"));
  return { isNode, isGo };
}

/**
 * Auto-detect the provider id. Defaults to "native".
 */
export function detectProvider(): string {
  return "native";
}

/**
 * Generate the `.claude/launch.settings.json` content laid down by `quay init`.
 *
 * gap-quay-init-launch-settings-template-missing-permissions-and-exclude-dynamic:
 * the scaffold previously laid down NO launch.settings.json at all — consumers
 * hand-copied it, and the copy was missing the `permissions.defaultMode:
 * "bypassPermissions"` block (measured F1/F2 on ad-arm1 archguard: inner
 * cold-start hit a permission prompt on its own loop scripts,
 * monitor-mount-check.sh).
 *
 * AC154 (profile 抽层): `_launchSpec` is GONE — launch.settings.json now carries
 * ONLY Claude Code keys ($schema/permissions/env). The profile/roles (launcher/
 * model/--bare/-n/unset) + flag-only params live in the sibling `.quay/profiles.yml`
 * scaffold (generateProfilesContent). Roles default to the generic `claude` launcher
 * / null model; a consumer edits them to their stack (quay itself uses
 * claude-fjdac + deepseek-v4-pro-anthropic).
 */
export function generateLaunchSettingsContent(): string {
  return (
    JSON.stringify(
      {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        permissions: { defaultMode: "bypassPermissions" },
        env: { CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false" },
      },
      null,
      2,
    ) + "\n"
  );
}

/** Build the `<project>-<role>` session-name prefix. Mirrored (same rule, same output) by
 * `quay-init.sh`'s `profiles_name_prefix()`; a divergence is caught by the byte-equality test in
 * `plugin/test/profiles-role-coverage-check.test.mjs`. */
export function profilesNamePrefix(projectName: string): string {
  const cleaned = projectName.replace(/[^A-Za-z0-9._-]/g, "-");
  return cleaned === "" ? "quay" : cleaned;
}

/**
 * The SHIPPED `.quay/profiles.yml` template — the ONE authored copy of the profile carrier.
 * Byte-identical to the checked-in `plugin/.quay/profiles.yml` (the file `quay-init.sh` copies
 * into a target workspace and `quay-launch.sh` falls back to), with the role session names
 * parameterised on the project.
 *
 * ⛔ Why the template is duplicated here instead of read from disk (packaging, not preference):
 * this function must work from `src/init.ts` AND from the bundled `dist/quay.js` in every layout
 * the package ships in — repo source tree, the `quay` npm package, the plugin's vendored mirror
 * (`plugin/vendor/quay/dist/`). The shipped file's path relative to this module differs across
 * all three, so no single path is correct in all of them. The duplication is therefore bound by
 * an EXECUTABLE invariant rather than by discipline: `packages/quay/test/init.test.mjs` asserts
 * `generateProfilesContent("quay") === readFileSync(plugin/.quay/profiles.yml)` byte-for-byte, so
 * a one-sided edit cannot land (hard rule 9 — give the rule a product, not a reminder).
 *
 * ⛔ Role session names are `<project>-<role>`, NOT a hardcoded `quay-` prefix. A third-party
 * project that copied quay's literal names collided with quay's OWN sessions, and cross-session
 * delivery addresses peers BY NAME ⇒ misrouting (`sendmessage-shared-worker-name-misroutes`).
 */
export function generateProfilesContent(projectName: string = "quay"): string {
  return SHIPPED_PROFILES_TEMPLATE.replace(/^(\s*name:\s*)quay-/gm, `$1${profilesNamePrefix(projectName)}-`);
}

const SHIPPED_PROFILES_TEMPLATE = [
  "# plugin/.quay/profiles.yml — shipped fallback profile carrier (AC154 profile 抽层）。",
  "# 裸机 / 未迁移目标没有 dev-tree 根 .quay/profiles.yml 时，quay-launch.sh 回退到本文件（同 settings 的",
  "# plugin/.claude/launch.settings.json 回退手法，见 gap-manager-layer-no-verified-install-vector）。",
  "# 通用默认：launcher=claude、model=null——消费者按自己的栈编辑（dev-tree 用 claude-fjdac +",
  "# deepseek-v4-pro-anthropic，见根 .quay/profiles.yml；两份 profiles 结构一致，只差 launcher/model 取值）。",
  "version: 1",
  "",
  "# flag-only 启动参数（对全部 role 生效；与 dev-tree 根 profiles.yml 一致）。",
  "excludeDynamicSystemPromptSections: true",
  "promptSuggestions: false",
  "",
  "profiles:",
  "  worker-default:",
  "    launcher: claude",
  "    model: null",
  "    bare: false",
  "    auth: key              # 原生 claude 读 ANTHROPIC_API_KEY",
  "  manager-local:",
  "    launcher: claude",
  "    model: null",
  "    bare: false",
  "    auth: key",
  "    # 无 unset：出厂 settings（plugin/.claude/launch.settings.json）的 env 本就没有 917k 三件套",
  "    # （裸机通用模板），manager 直接继承文件逐字。dev-tree 根的 manager-local 才需要 unset 917k",
  "    # （dev settings env 含 917k）。",
  "",
  "roles:",
  "  manager:",
  "    profile: manager-local",
  "    name: quay-manager",
  "  outer:",
  "    profile: worker-default",
  "    name: quay-outer",
  "  # 三个 worker role + pool-judge/meta-driver 与 dev-tree 根 profiles.yml 同构：共享 worker-default，",
  "  # 只声明 name 差异（launcher/model 从 profile 继承）。role 键集一致是 DoD——worker-driver 派发",
  "  # `launchArgv(\"task-worker\", …)` 经 profile-policy.ts resolveRole，缺失 role 抛 `role not found`",
  "  # （fail-closed，无回退）⇒ 第三方项目永不派发（gap-shipped-profiles-missing-worker-roles）。",
  "  # ⚠️ mcpBlacklist 同样必须在【两份 carrier】上都落地（gap-worker-mcp-blacklist-strict-config）：",
  "  #   本文件是 quay-init 逐字铺进消费者 .quay/ 的那一份；只改 dev-tree 根 ⇒ 第三方项目功能静默失效",
  "  #   ——这正是 profiles-role-coverage-check.ts 存在的那个「修了一份、init 铺的是另一份」缺陷形状。",
  "  task-worker:",
  "    profile: worker-default",
  "    name: quay-task-worker",
  "    env:",
  "      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: \"0\"    # 驱动的外部超时是唯一兜底（无此键 claude -p 有 600s end_turn 后台任务宽限）",
  "    # 角色层（⛔ 非 profile 层）：outer 与它们共享 worker-default，挂 profile 会连坐 outer。",
  "    # 三个 role 各写一份（⛔ 不用 YAML 锚点——本文件被 quay-launch.sh 的 python3+yaml 与 TS 的",
  "    # profile-policy.ts 两条路径读，保持与两份 carrier 既有写法一致的朴素形状）。",
  "    mcpBlacklist:",
  "      - chrome-devtools",
  "      - playwright",
  "  selector:",
  "    profile: worker-default",
  "    name: quay-selector",
  "    mcpBlacklist:",
  "      - chrome-devtools",
  "      - playwright",
  "  fix-worker:",
  "    profile: worker-default",
  "    name: quay-fix-worker",
  "    env:",
  "      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: \"0\"    # 同 task-worker",
  "    mcpBlacklist:",
  "      - chrome-devtools",
  "      - playwright",
  "  pool-judge:",
  "    profile: worker-default",
  "    name: quay-pool-judge",
  "  meta-driver:",
  "    profile: worker-default",
  "    name: quay-meta-driver",
  "",
].join("\n");

/**
 * Run the init operation.
 *
 * @returns InitResult on success.
 * @throws Error on unexpected filesystem errors (permissions, etc.).
 */
export function runInit(opts: InitOptions): InitResult {
  const root = path.resolve(opts.root);
  const quayDir = path.join(root, ".quay");
  const configPath = path.join(quayDir, "config.yml");
  const tasksDir = path.join(root, "tasks");
  const launchSettingsPath = path.join(root, ".claude", "launch.settings.json");
  const launchSettingsContent = generateLaunchSettingsContent();
  const profilesPath = path.join(quayDir, "profiles.yml");
  // The role session names are derived from THIS project (AC4): a third-party project must not
  // copy quay's literal `quay-*` names, or its sessions collide with quay's own and name-addressed
  // cross-session delivery misroutes. `quay-init.sh` applies the same rule to the file it copies.
  const profilesContent = generateProfilesContent(path.basename(root));

  // ── The CONFIG-FREE branch-model entry (gap-upgrade-entry-never-establishes-branch-model) ──────
  // FIRST, before the config-exists refusal: an existing `.quay/config.yml` is this entry's NORMAL
  // input (the shipped upgrade entry runs on an already-initialized project), and nothing below this
  // branch may run — the whole point is that the config surface is never touched. Same
  // `ensureBranchModel` the full init uses: one judgment source, no second predicate (ADR-004).
  if (opts.branchModelOnly === true) {
    const branchModel = ensureBranchModel(root, {
      adopt: opts.adoptBranchModel === true,
      dryRun: opts.dryRun === true,
    });
    return {
      outcome: "branch-model-only",
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel,
      branchModelReport: formatBranchModelReport(branchModel),
    };
  }

  // Check if config already exists.
  const configExists = fs.existsSync(configPath);
  if (configExists && !opts.force && !opts.dryRun) {
    // AC3: refuse to overwrite existing config.
    const result: InitResult = {
      outcome: "skipped",
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel: { ok: true, skipped: true, defaultBranch: null, entries: [], remedy: null },
      branchModelReport: "",
    };
    return result;
  }

  // ── Branch model (gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing) ──────
  // Run BEFORE writing anything: if the project's `develop` is a foreign line, init must stop with
  // the tree untouched (a half-initialized project is worse than an uninitialized one). The
  // landing baseline the fan-in / anti-drift path reads (`develop`) is ESTABLISHED here — that is
  // what turns the shipped `?? "develop"` default from an assumption into a fact.
  const branchModel = ensureBranchModel(root, {
    adopt: opts.adoptBranchModel === true,
    dryRun: opts.dryRun === true,
  });
  const branchModelReport = formatBranchModelReport(branchModel);
  if (!branchModel.ok && !opts.dryRun) {
    return {
      outcome: "branch-model-blocked",
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel,
      branchModelReport,
    };
  }

  // Detect project type.
  const { isNode, isGo } = detectProjectType(root);

  // Resolve provider.
  const providerId = opts.provider ?? detectProvider();

  // Compute relative provider path from workspace root to quay-native package.
  const providerPath = resolveProviderPath(root);

  // Generate config content.
  const content = generateConfigContent({ providerId, providerPath, isNode, isGo });

  if (opts.dryRun) {
    return { outcome: "dry-run", configPath, tasksDir, content, launchSettingsPath, launchSettingsContent, profilesPath, profilesContent, branchModel, branchModelReport };
  }

  // Write config.
  fs.mkdirSync(quayDir, { recursive: true });
  fs.writeFileSync(configPath, content, "utf8");

  // Create tasks dir if it doesn't exist.
  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
  }

  // Lay down .claude/launch.settings.json (with bypassPermissions) so a cold-start
  // inner does not hit a permission prompt on its own loop scripts. Create-if-absent
  // on a fresh init; --force overwrites a stale copy. Never silently overwrite a
  // user's launch settings on a plain re-init (that path returns "skipped" anyway).
  if (opts.force || !fs.existsSync(launchSettingsPath)) {
    fs.mkdirSync(path.dirname(launchSettingsPath), { recursive: true });
    fs.writeFileSync(launchSettingsPath, launchSettingsContent, "utf8");
  }

  // Lay down .quay/profiles.yml (the profile carrier, AC154) so quay-launch.sh can
  // resolve launcher/model/--bare/-n/unset + flag-only params. Same create-if-absent /
  // --force semantics as launch.settings.json.
  if (opts.force || !fs.existsSync(profilesPath)) {
    fs.mkdirSync(path.dirname(profilesPath), { recursive: true });
    fs.writeFileSync(profilesPath, profilesContent, "utf8");
  }

  return { outcome: "written", configPath, tasksDir, content, launchSettingsPath, launchSettingsContent, profilesPath, profilesContent, branchModel, branchModelReport };
}

/**
 * Resolve a relative path from workspace root to quay-native package root.
 * Uses a heuristic: if quay-native is findable relative to the current
 * module's location (inside packages/quay), compute the relative path;
 * otherwise default to "./node_modules/quay-native".
 */
function resolveProviderPath(workspaceRoot: string): string {
  // Try to locate quay-native relative to this module's location.
  try {
    const moduleDir = import.meta.url
      ? path.dirname(new URL(import.meta.url).pathname)
      : path.dirname(process.argv[1] ?? ".");

    // Walk up from moduleDir to find quay-native package root.
    let candidate = path.resolve(moduleDir, "..", "..", "quay-native");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      const rel = path.relative(workspaceRoot, candidate);
      if (rel && !rel.startsWith("..")) {
        return rel.startsWith(".") ? rel : "./" + rel;
      }
      return rel;
    }
    // Also try cwd-based resolution for when running from within the quay repo.
    candidate = path.resolve(process.cwd(), "packages", "quay-native");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      const rel = path.relative(workspaceRoot, candidate);
      if (rel && !rel.startsWith("..")) {
        return rel.startsWith(".") ? rel : "./" + rel;
      }
      return rel;
    }
  } catch {
    // Fall through to default.
  }

  // Default: assume quay-native is installed as a dependency.
  return "./node_modules/quay-native";
}

/**
 * Print next-step instructions after a successful init.
 */
export function printNextSteps(providerId: string, tasksDir: string): void {
  console.log(`
Next steps:
  1. Create your first task:
       quay task create TASK-001 --title "My first task"

  2. List all tasks:
       quay task list

  3. Start the MCP server (for AI agent integration):
       quay mcp

  4. Run the gate engine on a task:
       quay gate TASK-001

  Workspace ready at: ${path.dirname(path.dirname(tasksDir))}
  Provider: ${providerId}
  Tasks dir: ${tasksDir}
`);
}
