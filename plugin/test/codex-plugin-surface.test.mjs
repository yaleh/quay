// @test-group engine
// codex-plugin-surface.test.mjs — the in-repo guard for the codex publish surface, two predicates:
//
//   (1) AC-931's criterion (task gap-codex-plugin-publish-surface-plugin-json-mcp-dist): the repo
//       root carries a `.codex-plugin/plugin.json` that declares the quay MCP server against the
//       INSTALLED dist (`quay.js mcp`) and NOT the dev-tree source (`packages/quay/bin/quay.ts`).
//       That predicate lives ONLY in the goal store and is evaluated by the goal driver — this test
//       fetches it VERBATIM from `quay goal show AC-931 --json` and executes THAT string (ADR-004:
//       never a second copy).
//
//   (2) The codex-INSTALLABLE manifest shape (task gap-codex-plugin-surface-not-installable; layout
//       + args fixed by gap-codex-plugin-mcp-json-nested-in-wrong-level — Bug A layout, Bug B
//       session-cwd independence, 方案 A stable path; SOURCE split by
//       gap-codex-mcp-json-source-collides-with-claude-project-config): `.codex-plugin/plugin.json`
//       must be the codex-legal form — `mcpServers` is a PATH STRING `"./.mcp.json"` (not an inline
//       object), plus `author` and the `interface` block — and the CODEX SOURCE `.mcp.json` must live
//       INSIDE `.codex-plugin/` (`.codex-plugin/.mcp.json`) declaring the quay MCP server with
//       `args[0]` = the stable version-independent path `~/.local/share/quay/quay.js` and NO `cwd`
//       (codex then spawns with the session cwd, which Core's findConfig() needs). The REPO-ROOT
//       `.mcp.json` is Claude Code's PROJECT-LEVEL config and must carry NO `quay` key (the AC-165
//       principle — quay reaches Claude Code via `plugin/.mcp.json`'s `${CLAUDE_PLUGIN_ROOT}`); the
//       publish step inverts this for the ASSEMBLED artifact (`.codex-plugin/` → only `plugin.json`,
//       source `.mcp.json` copied to the artifact root). A shared `validateSourceCodexPackage(root)`
//       returns a LOUD failure list, so the positive test can take the value false and the negative
//       controls red on the exact cause.
//
//   The test carries its OWN negative controls: the AC-931 criterion is run against three throwaway
//   `.codex-plugin/plugin.json` states — (a) args re-pointed at the dev-tree source, (b) the quay
//   declaration removed, (c) the file removed — and each must exit 1 with the LOUD cause on stderr.
//   The source-layout validator is run against an inline-mcpServers manifest and must name
//   `mcpServers is not a path string`; against the source `.mcp.json` moved back OUT to the repo root
//   (the collision this task fixes) it must name the missing-source failure; against relative args
//   with no cwd (the Bug B relapse) it must name the args[0]/cwd failures; and against a repo-root
//   `.mcp.json` that re-gains a `quay` key it must name the AC-165 root-collision failure. Without
//   them the positive assertions would also pass against a trivially-green check (硬规则 3b / 4).
//
// Run: scripts/test.sh plugin/test/codex-plugin-surface.test.mjs

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ensureSharedShippedArtifact } from "./helpers/real-install-shared-build.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PLUGIN_JSON = path.join(ROOT, ".codex-plugin", "plugin.json");
const CODEX_SOURCE_MCP = path.join(ROOT, ".codex-plugin", ".mcp.json");
const ROOT_MCP_JSON = path.join(ROOT, ".mcp.json");
const QUAY_BIN = path.join(ROOT, "packages", "quay", "bin", "quay.js");
const INIT_TS = path.join(ROOT, "packages", "quay", "src", "init.ts");

// ── the codex skills delivery surface (gap-codex-plugin-ship-human-facing-skills, 2026-10-31) ────
// 人脸操作面 (ship): quay-init (source dir `init`, renamed so the /skills menu never shows a bare
// `init`), quay-file-task, quay-directive, quay-task-operator. 编排面 + 参考类 (do NOT ship).
const HUMAN_FACING_SKILLS = ["quay-init", "quay-file-task", "quay-directive", "quay-task-operator"];
const ORCHESTRATION_SKILLS = ["loop-driver", "manager", "cold-start", "drivers", "routines", "execute", "quay-task-to-plan", "extension-point-refactor"];
const REFERENCE_SKILLS = ["quay-native-methodology", "quay-webui-bootstrap-methodology"];

// ── AC-931's criterion, read verbatim from the goal store (never re-typed) ────────────────────
function readAc931Criterion() {
  const res = spawnSync(process.execPath, [QUAY_BIN, "goal", "show", "AC-931", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `quay goal show AC-931 --json must exit 0:\n${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.equal(typeof parsed.criterion, "string", "AC-931 carries no string `criterion` field");
  assert.ok(parsed.criterion.trim().length > 0, "AC-931's `criterion` is blank");
  return parsed.criterion;
}

// The goal store runs a criterion through `bash -c <criterion>` in the workspace root. Reproduce
// that shape exactly: write the criterion verbatim to a scratch file and run `bash <scratch>` with
// cwd = the tree whose `.codex-plugin/plugin.json` is under test. The scratch file is never placed
// in `cwd`, so a positive run against ROOT leaves the repo tree untouched.
function runCriterion(criterion, cwd) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ac931-criterion-"));
  const script = path.join(scratch, "criterion.sh");
  fs.writeFileSync(script, criterion, "utf8");
  try {
    return spawnSync("bash", [script], { cwd, encoding: "utf8" });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function writePluginJson(tmp, manifest) {
  fs.mkdirSync(path.join(tmp, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".codex-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}

function writeSourceMcp(tmp, server) {
  fs.mkdirSync(path.join(tmp, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".codex-plugin", ".mcp.json"),
    JSON.stringify({ mcpServers: { quay: server } }, null, 2) + "\n",
    "utf8",
  );
}

// ── the codex SOURCE-layout validator: returns a LOUD list of failures (never a boolean) ─────────
// Reads `.codex-plugin/plugin.json` + the codex SOURCE `.mcp.json` INSIDE `.codex-plugin/` + the
// repo-root `.mcp.json` under `root`. `mcpServers` must be the path string "./.mcp.json" (codex
// resolves it relative to the plugin package root — the SIBLING of `.codex-plugin/`, which is where
// publish-dist-branch.sh copies the source to); the SOURCE `.mcp.json` must declare mcpServers.quay
// as stdio against the STABLE version-independent path `~/.local/share/quay/<dist>` (方案 A —
// installed there by codex-mcp-sync.sh, never the in-package vendor/ nor `~/.claude/plugins/cache/...`),
// with NO `cwd`. The repo-root `.mcp.json` is Claude Code's project-level config and must NOT carry
// a `quay` key (硬规则 2: position, not keyword — the AC-165 principle restored by
// gap-codex-mcp-json-source-collides-with-claude-project-config).
function validateSourceCodexPackage(root) {
  const failures = [];
  const pluginJson = path.join(root, ".codex-plugin", "plugin.json");
  const sourceMcp = path.join(root, ".codex-plugin", ".mcp.json");
  const rootMcp = path.join(root, ".mcp.json");

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(pluginJson, "utf8"));
  } catch (e) {
    return [`${pluginJson} unreadable: ${e.message}`];
  }
  if (typeof manifest.mcpServers !== "string") {
    failures.push("mcpServers is not a path string");
  } else if (manifest.mcpServers !== "./.mcp.json") {
    failures.push(`mcpServers must be "./.mcp.json", got ${JSON.stringify(manifest.mcpServers)}`);
  }
  if (!manifest.author) failures.push("author missing");
  const iface = manifest.interface;
  if (!iface) failures.push("interface missing");
  else {
    if (!iface.displayName) failures.push("interface.displayName missing");
    if (!iface.shortDescription) failures.push("interface.shortDescription missing");
    if (!iface.category) failures.push("interface.category missing");
    if (!Array.isArray(iface.capabilities)) failures.push("interface.capabilities not an array");
  }

  // The codex SOURCE `.mcp.json` lives INSIDE `.codex-plugin/` (a portable `~` template; the publish
  // step copies it out to the artifact root, where codex resolves plugin.json's "./.mcp.json").
  if (!fs.existsSync(sourceMcp)) {
    failures.push(
      ".codex-plugin/.mcp.json missing (the codex `.mcp.json` source lives inside .codex-plugin/, not at the repo root — the repo root belongs to Claude Code's project config)",
    );
  } else {
    let mcp;
    try {
      mcp = JSON.parse(fs.readFileSync(sourceMcp, "utf8"));
    } catch (e) {
      return failures.concat([`${sourceMcp} unreadable: ${e.message}`]);
    }
    const server = mcp.mcpServers?.quay;
    if (!server) failures.push(".codex-plugin/.mcp.json has no mcpServers.quay");
    else {
      if (server.command !== "node") {
        failures.push(`mcpServers.quay.command must be node, got ${JSON.stringify(server.command)}`);
      }
      const stablePath =
        Array.isArray(server.args) &&
        typeof server.args[0] === "string" &&
        server.args[0].startsWith("~/.local/share/quay/");
      if (!stablePath) {
        failures.push(
          `mcpServers.quay.args[0] must be the stable version-independent path ~/.local/share/quay/<dist> (方案 A — codex does not expand ~ and resolves relative args against the session cwd), got ${JSON.stringify(server.args)}`,
        );
      }
      if (!server.args?.includes("mcp")) failures.push("mcpServers.quay.args must include mcp");
      if (server.cwd !== undefined) {
        failures.push(
          "mcpServers.quay.cwd must be ABSENT (codex then spawns with the session cwd, which Core's findConfig() walks up from; a relative cwd resolves against the plugin install root and breaks workspace discovery)",
        );
      }
    }
  }

  // The repo-root `.mcp.json` is Claude Code's project-level MCP config: valid JSON, NO quay key.
  if (!fs.existsSync(rootMcp)) {
    failures.push(".mcp.json missing at the repo root (Claude Code project config)");
  } else {
    let rootM;
    try {
      rootM = JSON.parse(fs.readFileSync(rootMcp, "utf8"));
    } catch (e) {
      return failures.concat([`${rootMcp} unreadable: ${e.message}`]);
    }
    const rootServers = rootM.mcpServers;
    if (rootServers === undefined || rootServers === null || typeof rootServers !== "object" || Array.isArray(rootServers)) {
      failures.push(".mcp.json mcpServers must be an object (Claude Code project config)");
    } else if (Object.prototype.hasOwnProperty.call(rootServers, "quay")) {
      failures.push(
        ".mcp.json mcpServers must NOT carry a quay key (Claude Code spawns args directly with no ~ expansion, so the codex ~ template ENOENTs here; quay reaches Claude Code via plugin/.mcp.json's ${CLAUDE_PLUGIN_ROOT})",
      );
    }
  }

  return failures;
}

test("AC-931 criterion passes on this repo's .codex-plugin/plugin.json", () => {
  const criterion = readAc931Criterion();
  const res = runCriterion(criterion, ROOT);
  assert.equal(
    res.status,
    0,
    `AC-931 criterion must exit 0 on ${PLUGIN_JSON}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`,
  );
  assert.equal(res.stderr, "", "a passing AC-931 run must not write to stderr");
});

test("the codex package carries the installable manifest + source .mcp.json inside .codex-plugin/ + an empty repo-root .mcp.json (position)", () => {
  const failures = validateSourceCodexPackage(ROOT);
  assert.deepEqual(
    failures,
    [],
    `codex source-layout validation failed:\n  - ${failures.join("\n  - ")}`,
  );
  // Position, not keyword: the SOURCE .mcp.json must not reference the claude plugin cache anywhere,
  // and args[0] must be the stable version-independent path (方案 A).
  const rawSource = fs.readFileSync(CODEX_SOURCE_MCP, "utf8");
  assert.doesNotMatch(rawSource, /plugins\/cache/, ".codex-plugin/.mcp.json must not reference the claude plugin cache");
  const parsedSource = JSON.parse(rawSource);
  assert.ok(
    parsedSource.mcpServers?.quay?.args?.[0]?.startsWith("~/.local/share/quay/"),
    `.codex-plugin/.mcp.json args[0] must be the stable path ~/.local/share/quay/<dist>, got ${JSON.stringify(parsedSource.mcpServers?.quay?.args)}`,
  );
  // The repo-root .mcp.json is Claude Code's project config: no quay key, valid JSON.
  const rawRoot = fs.readFileSync(ROOT_MCP_JSON, "utf8");
  const parsedRoot = JSON.parse(rawRoot);
  assert.equal(
    Object.prototype.hasOwnProperty.call(parsedRoot.mcpServers ?? {}, "quay"),
    false,
    `repo-root .mcp.json must carry no quay key, got ${rawRoot}`,
  );
});

test("negative control: an inline mcpServers object fails validation with `mcpServers is not a path string`", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-inline-mcp-"));
  try {
    writePluginJson(tmp, {
      name: "quay",
      version: "0.28.0-dev",
      author: { name: "quay" },
      mcpServers: { quay: { command: "node", args: ["quay.js", "mcp"] } },
      interface: {
        displayName: "quay",
        shortDescription: "provider-agnostic task board",
        category: "Developer Tools",
        capabilities: ["Interactive"],
      },
    });
    writeSourceMcp(tmp, { command: "node", args: ["~/.local/share/quay/quay.js", "mcp"] });
    fs.writeFileSync(path.join(tmp, ".mcp.json"), '{"mcpServers": {}}\n', "utf8");
    const failures = validateSourceCodexPackage(tmp);
    assert.ok(
      failures.includes("mcpServers is not a path string"),
      `expected the inline-mcpServers manifest to fail with "mcpServers is not a path string", got ${JSON.stringify(failures)}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("negative control: the codex source .mcp.json moved back OUT to the repo root fails validation (the collision this task fixes)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-root-source-"));
  try {
    writePluginJson(tmp, {
      name: "quay",
      version: "0.29.0-dev",
      author: { name: "quay" },
      mcpServers: "./.mcp.json",
      interface: {
        displayName: "quay",
        shortDescription: "provider-agnostic task board",
        category: "Developer Tools",
        capabilities: ["Interactive"],
      },
    });
    // The collision layout: the codex `~` template at the repo root (Claude Code reads this too and
    // spawns node directly with no ~ expansion), and NOTHING inside .codex-plugin/.
    fs.writeFileSync(
      path.join(tmp, ".mcp.json"),
      JSON.stringify(
        { mcpServers: { quay: { command: "node", args: ["~/.local/share/quay/quay.js", "mcp"] } } },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const failures = validateSourceCodexPackage(tmp);
    assert.ok(
      failures.some((f) => f.includes(".codex-plugin/.mcp.json missing")),
      `expected the root-source layout to fail on the missing in-package source, got ${JSON.stringify(failures)}`,
    );
    assert.ok(
      failures.some((f) => f.includes("must NOT carry a quay key")),
      `expected the root-source layout to also fail on the repo-root quay collision, got ${JSON.stringify(failures)}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("negative control: a repo-root .mcp.json that re-gains a quay key fails validation (the AC-165 principle)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-root-quay-"));
  try {
    writePluginJson(tmp, {
      name: "quay",
      version: "0.29.0-dev",
      author: { name: "quay" },
      mcpServers: "./.mcp.json",
      interface: {
        displayName: "quay",
        shortDescription: "provider-agnostic task board",
        category: "Developer Tools",
        capabilities: ["Interactive"],
      },
    });
    writeSourceMcp(tmp, { command: "node", args: ["~/.local/share/quay/quay.js", "mcp"] });
    // The `~` template written back into the repo root — the exact state Claude Code spawns into
    // ENOENT (no ~ expansion under a direct node spawn).
    fs.writeFileSync(
      path.join(tmp, ".mcp.json"),
      JSON.stringify(
        { mcpServers: { quay: { command: "node", args: ["~/.local/share/quay/quay.js", "mcp"] } } },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const failures = validateSourceCodexPackage(tmp);
    assert.ok(
      failures.some((f) => f.includes("must NOT carry a quay key")),
      `expected the repo-root quay key to fail the AC-165 assertion, got ${JSON.stringify(failures)}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("negative control: relative args with a cwd (Bug B relapse) fails validation", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rel-args-"));
  try {
    writePluginJson(tmp, {
      name: "quay",
      version: "0.29.0-dev",
      author: { name: "quay" },
      mcpServers: "./.mcp.json",
      interface: {
        displayName: "quay",
        shortDescription: "provider-agnostic task board",
        category: "Developer Tools",
        capabilities: ["Interactive"],
      },
    });
    // The Bug B relapse: args[0] back to the relative dist path AND a `cwd` pinned back in — codex
    // resolves the relative args against the SESSION cwd (dist ENOENTs from any project without its
    // own vendor/) and the relative cwd against the PLUGIN INSTALL ROOT (breaks findConfig()).
    writeSourceMcp(tmp, { command: "node", args: ["vendor/quay/dist/quay.js", "mcp"], cwd: "." });
    fs.writeFileSync(path.join(tmp, ".mcp.json"), '{"mcpServers": {}}\n', "utf8");
    const failures = validateSourceCodexPackage(tmp);
    assert.ok(
      failures.some((f) => f.includes("stable version-independent path ~/.local/share/quay/")),
      `expected the relative-args .mcp.json to fail on args[0], got ${JSON.stringify(failures)}`,
    );
    assert.ok(
      failures.some((f) => f.includes("cwd must be ABSENT")),
      `expected the relative-args .mcp.json to also fail on the re-added cwd, got ${JSON.stringify(failures)}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("negative control: re-pointing args at the dev-tree source fails with `dev-tree source path present`", () => {
  const criterion = readAc931Criterion();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac931-source-path-"));
  try {
    writePluginJson(tmp, {
      name: "quay",
      version: "0.26.0-dev",
      description: "quay MCP server",
      mcpServers: { quay: { command: "node", args: ["packages/quay/bin/quay.ts", "mcp"] } },
    });
    const res = runCriterion(criterion, tmp);
    assert.equal(res.status, 1, `expected exit 1, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stderr, /dev-tree source path present/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("negative control: removing the quay declaration fails with `no quay MCP declaration`", () => {
  const criterion = readAc931Criterion();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac931-no-quay-"));
  try {
    // The criterion greps the WHOLE file for the substring `quay`, so "declaration removed" means
    // the file must carry no `quay` text at all (a name/description that still says "quay" would
    // keep `grep -q quay` green). Keep the manifest shape, drop every quay-specific token.
    writePluginJson(tmp, {
      name: "example",
      version: "0.26.0-dev",
      description: "a provider-agnostic task board MCP server",
      mcpServers: {},
    });
    const res = runCriterion(criterion, tmp);
    assert.equal(res.status, 1, `expected exit 1, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stderr, /no quay MCP declaration/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("negative control: removing the file fails with `absent`", () => {
  const criterion = readAc931Criterion();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac931-absent-"));
  try {
    // `.codex-plugin/` exists but `plugin.json` is gone — the exact state the criterion's first
    // `[ ! -f .codex-plugin/plugin.json ]` guard catches.
    fs.mkdirSync(path.join(tmp, ".codex-plugin"), { recursive: true });
    const res = runCriterion(criterion, tmp);
    assert.equal(res.status, 1, `expected exit 1, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stderr, /absent/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── CODEX SKILLS DELIVERY SURFACE (gap-codex-plugin-ship-human-facing-skills, human 2026-10-31) ──

test("the codex manifest declares the human-facing skills surface (`skills: ./skills/`)", () => {
  const manifest = JSON.parse(fs.readFileSync(PLUGIN_JSON, "utf8"));
  assert.equal(
    manifest.skills,
    "./skills/",
    `.codex-plugin/plugin.json must declare "skills": "./skills/" — codex resolves it against the plugin root (the sibling of .codex-plugin/, where publish-dist-branch.sh assembles the narrowed skills/)`,
  );
});

test("AC5: packages/quay/src/init.ts creates .agents/skills/ EMPTY — no copy-skills path (position grep, reverse-controlable)", () => {
  const src = fs.readFileSync(INIT_TS, "utf8");
  // The reverse control (AC5 反向): if someone re-adds a "copy skills into .agents/skills/" path,
  // the same line that names `agentsSkillsDir` will also name a copy primitive — this grep hits.
  const offenders = src.split("\n").filter(
    (l) => /agentsSkillsDir/.test(l) && /\b(copyFileSync|cpSync|writeFileSync|copySync|readdirSync|readFileSync|createReadStream|renameSync|linkSync|symlinkSync)\b/.test(l),
  );
  assert.deepEqual(
    offenders,
    [],
    `init.ts must only mkdir .agents/skills/, never copy skill files into it (offending lines: ${offenders.join(" | ") || "(none)"})`,
  );
  // The empty-dir host must exist, or the "no copy" assertion above would be vacuously green (rule 4).
  assert.match(src, /agentsSkillsDir\s*=\s*path\.join\(root, "\.agents", "skills"\)/);
  assert.match(src, /mkdirSync\(agentsSkillsDir/);
});

// The real assembled artifact's skills surface is built ONCE by the product's own publish script
// (never re-implemented): plugin/scripts/publish-dist-branch.sh narrows the artifact's `skills/` to
// the four human-facing skills and renames `init` -> `quay-init`. A build failure is environmental
// (no vendored runtime) and is reported as a SKIP, never folded into a green (硬规则 3b).
let skillsArtifact = null;
let skillsArtifactError = null;
function requireSkillsArtifact(t) {
  if (skillsArtifact) return skillsArtifact;
  if (skillsArtifactError) {
    t.skip(skillsArtifactError);
    return null;
  }
  try {
    const shared = ensureSharedShippedArtifact({ repoRoot: ROOT, ref: "HEAD", form: "dev", syncVendor: true });
    if (shared.evaluated) {
      skillsArtifact = shared.dir;
    } else {
      skillsArtifactError = `shared shipped artifact unavailable: ${shared.reason}`;
    }
  } catch (err) {
    skillsArtifactError = `building the shared shipped artifact threw: ${String(err && err.stack ? err.stack : err)}`;
  }
  if (!skillsArtifact) {
    t.skip(skillsArtifactError);
    return null;
  }
  return skillsArtifact;
}

test("AC2/AC4: the assembled codex artifact's skills/ is EXACTLY the four human-facing skills (编排面 + 参考类 absent)", (t) => {
  const artifact = requireSkillsArtifact(t);
  if (!artifact) return;
  const skillsDir = path.join(artifact, "skills");
  const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.deepEqual(
    dirs,
    [...HUMAN_FACING_SKILLS].sort(),
    `the codex artifact's skills/ must contain exactly the four human-facing skills`,
  );
  for (const s of ORCHESTRATION_SKILLS.concat(REFERENCE_SKILLS)) {
    assert.ok(
      !fs.existsSync(path.join(skillsDir, s)),
      `${s} must NOT ship in the codex skills surface (编排面/参考类 not delivered)`,
    );
  }
  // The rename is a real content change in the assembled copy, never in plugin/skills/init itself.
  const qinit = fs.readFileSync(path.join(skillsDir, "quay-init", "SKILL.md"), "utf8");
  assert.match(qinit, /^name: quay-init$/m, "the renamed init skill must carry `name: quay-init`");
});
