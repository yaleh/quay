// @test-group product
// gap-webui-a11y-focus-ring-and-token-contrast-unvalidated — the web UI's colour tokens were
// never pinned by any falsifiable contrast judge (a repo-wide grep for WCAG/对比度/contrast in
// tasks/ hit 0), so the main link colour --color-accent (#ec3013) measured 3.47:1 on
// --color-surface (needs ≥4.5) and the whole site's :focus was `outline: none` (keyboard users
// saw no cursor position). This task:
//   1. darkens --color-accent → #ae1800 and --color-positive-700 → #0c5933, and re-points all
//      muted text at --color-neutral-700 (fixing the <4.5 combos in ONE place each — the token,
//      not 15 scattered call sites);
//   2. replaces `:focus { outline: none }` with a shared `:focus, :focus-visible` 2px outline;
//   3. adds a skip-link (`<a class="skip-link" href="#main">`) + `<main id="main">` to every page;
//   4. lands the judge below: an enumerable token-pair table (AC2, with mutation negative
//      controls) plus a production-carrier traversal of five rendered pages (AC1).
//
// NO headless browser is importable from a plain `node --test` process in this repo (no
// playwright/puppeteer dependency — G5 "no framework"), so the contrast judge operates on the
// token values the server actually ships (webui-modernist.css is inlined into every page, and
// every text colour is a `var(--color-*)` reference — the "zero hardcoded hex" invariant means
// resolving the tokens IS resolving the rendered colours). Focus-visibility is asserted on the
// shipped :focus rules (AC3), and skip-link/tabindex on the rendered HTML (AC4).
//
// Run (scoped): node --test packages/quay/test/gap-webui-a11y-focus-ring-and-token-contrast-unvalidated.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const CSS_PATH = path.join(__dirname, "..", "src", "webui-modernist.css");

// ── WCAG 2.x relative-luminance / contrast ratio (the proposal's "WCAG 公式") ────────────────
function srgb(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ── token parsing from the shipped stylesheet ───────────────────────────────────────────────
// The light theme tokens live in :root; a dark theme (if any) overrides them inside
// `@media (prefers-color-scheme: dark)`. Today there is NO dark block — the browser falls back
// to the light tokens in dark mode — but the judge parses both so a future dark theme is
// checked, not silently skipped (AC5). Returns { light: {token:hex}, dark: {token:hex} }.
function parseThemes(css) {
  const light = {};
  for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) light[`--color-${m[1]}`] = m[2];
  const darkBlock = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/);
  const dark = { ...light };
  if (darkBlock) {
    for (const m of darkBlock[1].matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) dark[`--color-${m[1]}`] = m[2];
  }
  return { light, dark };
}

// ── AC2: the token-pair table — every (foreground, background) text combo the app actually
// paints, with its AA threshold. This is the "criterion pinned to tokens, not rendering":
// a token edit that breaks any row is caught here (mutation tests below), before any page
// render. Held to 4.5:1 (normal text) uniformly — the AA large/bold floor of 3.0:1 is never
// needed by these rows, so asserting the stricter 4.5 everywhere is safe and simpler. ─────────
const PAIRS = [
  { fg: "--color-text", bg: "--color-bg", usage: "body text" },
  { fg: "--color-text", bg: "--color-surface", usage: "card/table text" },
  { fg: "--color-accent", bg: "--color-bg", usage: "links on the page" },
  { fg: "--color-accent", bg: "--color-surface", usage: "links inside cards" },
  { fg: "--color-accent-700", bg: "--color-bg", usage: "current-page nav item" },
  { fg: "--color-accent-700", bg: "--color-surface", usage: "current-page nav item on surface" },
  { fg: "--color-accent-800", bg: "--color-bg", usage: "verdict-fail / fail text" },
  { fg: "--color-accent-800", bg: "--color-surface", usage: "verdict-fail on surface" },
  { fg: "--color-accent-800", bg: "--color-accent-100", usage: "tag-accent / malformed row" },
  { fg: "--color-accent-2-800", bg: "--color-accent-2-100", usage: "tag-accent-2" },
  { fg: "--color-neutral-700", bg: "--color-bg", usage: ".meta / muted text" },
  { fg: "--color-neutral-700", bg: "--color-surface", usage: "th / muted text in cards" },
  { fg: "--color-neutral-800", bg: "--color-neutral-100", usage: "tag-neutral" },
  { fg: "--color-neutral-800", bg: "--color-bg", usage: "h2 heading" },
  { fg: "--color-positive-700", bg: "--color-bg", usage: "GO / fresh on page" },
  { fg: "--color-positive-700", bg: "--color-surface", usage: "verdict-pass in card" },
  { fg: "--color-bg", bg: "--color-accent", usage: "NEW badge / button text on accent" },
];
const THRESHOLD = 4.5;
// Tokens used as `color:` for NON-text glyphs (the git-history legend's ● commit / ◆ merge /
// ┃ trunk symbols), not for text nodes. A text-contrast judge must not hold a symbol to the
// text threshold; their non-text contrast is governed by WCAG 1.4.11 (≥3:1) and is out of
// this task's scope.
const DECORATIVE_FOREGROUNDS = new Set(["--color-accent-600", "--color-accent-2-500", "--color-neutral-200"]);

// ── the five pages AC1 traverses ─────────────────────────────────────────────────────────────
const PAGES = [
  { route: "/dashboard", label: "dashboard" },
  { route: "/tests", label: "tests" },
  { route: "/git-history", label: "git-history" },
  { route: "/goal", label: "goal" },
  { route: "/task/A11Y-1", label: "task detail" },
];

// ── HTTP GET helper ──────────────────────────────────────────────────────────────────────────
function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

// Extract every distinct inline foreground / background TOKEN from a rendered page's style
// attributes — the production carrier's actual colour references (not a curated list). The
// `(?<![\w-])` guard stops `background-color:`/`border-color:` etc. from being misread as a
// `color:` foreground.
function inlineTokens(body) {
  const fg = new Set(), bg = new Set();
  for (const m of body.matchAll(/(?<![\w-])color:var\((--color-[a-z0-9-]+)\)/g)) fg.add(m[1]);
  for (const m of body.matchAll(/(?<![\w-])background:var\((--color-[a-z0-9-]+)\)/g)) bg.add(m[1]);
  return { fg: [...fg].sort(), bg: [...bg].sort() };
}

// ── server fixture ───────────────────────────────────────────────────────────────────────────
let server, port, originalCwd, workspaceRoot, tasksDir;

const TASK_BODY =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-a11y-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gap-a11y-ws-"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "gap-a11y fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });
  execFileSync("node", [nativeBin, "task", "create", "A11Y-1", "--title", "A11y fixture task", "--status", "todo", "--body", TASK_BODY],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir } });

  // Deterministic GO for the dashboard's system-resource card (same test-seams as the accent
  // palette task) so the dashboard renders its green "⇒ GO" verdict.
  process.env.RESOURCE_GATE_TEST_CPU_AVG10 = "0.5";
  process.env.RESOURCE_GATE_TEST_MEM_AVAIL_MB = "999999";
  process.env.RESOURCE_GATE_TEST_LOAD_OVERRIDE = "0.5";
  process.env.RESOURCE_GATE_TEST_NPROC = "8";
  process.env.RESOURCE_GATE_TEST_NODE_PROCS = "0";

  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
  for (const k of ["RESOURCE_GATE_TEST_CPU_AVG10", "RESOURCE_GATE_TEST_MEM_AVAIL_MB", "RESOURCE_GATE_TEST_LOAD_OVERRIDE", "RESOURCE_GATE_TEST_NPROC", "RESOURCE_GATE_TEST_NODE_PROCS"]) delete process.env[k];
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════════════════════

test("AC2 — every actually-used token pair meets AA (≥4.5) in the light theme", () => {
  const tokens = parseThemes(fs.readFileSync(CSS_PATH, "utf8")).light;
  const failures = [];
  for (const row of PAIRS) {
    const fg = tokens[row.fg], bg = tokens[row.bg];
    assert.ok(fg && bg, `token missing: ${row.fg}=${fg} / ${row.bg}=${bg}`);
    const ratio = contrast(fg, bg);
    if (ratio < THRESHOLD) failures.push({ ...row, fg, bg, ratio });
  }
  assert.deepEqual(failures, [], `token pairs below ${THRESHOLD}:1:\n` +
    failures.map((f) => `  ${f.fg}(${f.fg_hex ?? f.fg}) on ${f.bg} = ${f.ratio.toFixed(2)} (${f.usage})`).join("\n"));
});

test("AC2 — mutation negative control: a non-compliant value IS flagged on every row", () => {
  const tokens = parseThemes(fs.readFileSync(CSS_PATH, "utf8")).light;
  // (1) The judge is not hardcoded to pass: a foreground identical to its background is 1.0:1
  //     and must fail on every single row (hard rule 4 — a judge that can't fail isn't a judge).
  for (const row of PAIRS) {
    const bg = tokens[row.bg];
    assert.ok(contrast(bg, bg) < THRESHOLD, `same fg/bg on ${row.bg} must be flagged`);
  }
  // (2) The exact pre-fix regressions this task closed are flagged — the mutation that would
  //     silently re-introduce the bug.
  assert.ok(contrast("#ec3013", tokens["--color-surface"]) < THRESHOLD,
    "pre-fix accent #ec3013 on surface must be flagged (measured 3.47)");
  assert.ok(contrast("#ec3013", tokens["--color-bg"]) < THRESHOLD,
    "pre-fix accent #ec3013 on bg must be flagged (measured 3.76)");
  assert.ok(contrast("#157a45", tokens["--color-surface"]) < THRESHOLD,
    "pre-fix positive-700 #157a45 on surface must be flagged (measured 4.44)");
  assert.ok(contrast(tokens["--color-bg"], "#ec3013") < THRESHOLD,
    "pre-fix badge (bg on #ec3013) must be flagged (measured 3.76)");
});

test("AC1 — production carrier: the five rendered pages carry zero contrast violations", async () => {
  // Every text colour in the rendered HTML is a var(--color-*) reference; resolving the token
  // IS resolving the rendered colour. A text foreground is checked against both universal text
  // backgrounds (--color-bg and --color-surface) because a link may sit on either; light text
  // on an accent background (badge/button) is checked separately.
  const { light } = parseThemes(fs.readFileSync(CSS_PATH, "utf8"));
  const violations = [];
  for (const page of PAGES) {
    const r = await request(port, page.route);
    assert.equal(r.status, 200, `${page.route} returns 200`);
    // The FIXED token values are what actually ships on the page (not the pre-fix regressions).
    const accent = r.body.match(/--color-accent:\s*#([0-9a-fA-F]{6})/);
    const positive = r.body.match(/--color-positive-700:\s*#([0-9a-fA-F]{6})/);
    assert.ok(accent, `${page.label} must inline the --color-accent token definition`);
    assert.equal(accent[1].toLowerCase(), "ae1800", `${page.label} ships --color-accent ${accent[1]} (want #ae1800)`);
    assert.ok(positive, `${page.label} must inline the --color-positive-700 token definition`);
    assert.equal(positive[1].toLowerCase(), "0c5933", `${page.label} ships --color-positive-700 ${positive[1]} (want #0c5933)`);

    const inline = inlineTokens(r.body);
    for (const fg of inline.fg) {
      if (DECORATIVE_FOREGROUNDS.has(fg)) continue; // symbol, not text (see constant)
      const fgHex = light[fg];
      assert.ok(fgHex, `inline foreground token ${fg} must be defined in the shipped stylesheet`);
      for (const bg of ["--color-bg", "--color-surface"]) {
        const ratio = contrast(fgHex, light[bg]);
        if (ratio < THRESHOLD) violations.push({ page: page.label, fg, fgHex, bg, ratio });
      }
    }
    // Light text sitting on an accent-family background (badge / button).
    for (const bg of inline.bg) {
      if (!/^--color-accent(?:-[0-9]+)?$/.test(bg)) continue;
      const ratio = contrast(light["--color-bg"], light[bg]);
      if (ratio < THRESHOLD) violations.push({ page: page.label, fg: "--color-bg", bg, ratio });
    }
  }
  const dedup = new Map();
  for (const v of violations) dedup.set(`${v.fg}|${v.bg}|${v.fgHex}`, v);
  const list = [...dedup.values()];
  assert.equal(list.length, 0, `${list.length} contrast violation(s) across the five pages:\n` +
    list.map((v) => `  ${v.page}: ${v.fg} (${v.fgHex}) on ${v.bg} = ${v.ratio.toFixed(2)} (< ${THRESHOLD})`).join("\n"));
});

test("AC3 — focus is visible: shipped :focus rules carry a ≥2px outline, ≥3:1 on both themes", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  // Strip comments so prose (e.g. "the old rule was outline:none") isn't misread as a rule.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // The old `:focus { outline: none }` must be gone (it made programmatic/pointer focus invisible).
  assert.ok(!/outline\s*:\s*none/.test(rules) && !/outline-style\s*:\s*none/.test(rules),
    "no rule may set outline: none / outline-style: none (the pre-fix regression)");
  // A plain `:focus` rule (not only :focus-visible) must carry the ≥2px outline, so .focus()
  // (script/pointer focus) is visible too, not gated on the keyboard heuristic.
  const focusRule = rules.match(/:focus(?:\s*,\s*:focus-visible)?\s*\{([^}]*)\}/);
  assert.ok(focusRule, "a :focus rule must be present in the shipped stylesheet");
  const width = focusRule[1].match(/outline:\s*(\d+)px\s+solid/);
  assert.ok(width && Number(width[1]) >= 2, `:focus outline-width must be ≥2px (got: ${focusRule[1]})`);
  assert.ok(/outline:\s*\d+px\s+solid/.test(focusRule[1]), ":focus outline-style must be solid (not none)");
  // The outline colour must contrast ≥3:1 against both page backgrounds (WCAG 1.4.11 non-text).
  const { light, dark } = parseThemes(css);
  const outlineColor = light["--color-accent"];
  for (const theme of [light, dark]) {
    const bg = theme["--color-bg"], surf = theme["--color-surface"];
    assert.ok(contrast(outlineColor, bg) >= 3.0, `outline ${outlineColor} vs bg ${bg} must be ≥3:1`);
    assert.ok(contrast(outlineColor, surf) >= 3.0, `outline ${outlineColor} vs surface ${surf} must be ≥3:1`);
  }
});

test("AC4 — keyboard reachability: skip-link present, no tabindex=-1 interactive element", async () => {
  const missing = [];
  for (const page of PAGES) {
    const r = await request(port, page.route);
    assert.equal(r.status, 200);
    // A skip-link jumping to <main id="main">, and the target actually exists (not a dead href).
    const skip = /<a[^>]*class="skip-link"[^>]*href="#main"[^>]*>/.test(r.body);
    const target = /<main[^>]*id="main"[^>]*>/.test(r.body);
    if (!skip || !target) missing.push(page.label);
    // No interactive element (a/button/input/select/textarea) carries tabindex="-1".
    const tabindexMinus1 = /<(a|button|input|select|textarea)\b[^>]*\btabindex="-1"[^>]*>/.test(r.body);
    assert.ok(!tabindexMinus1, `${page.label} must not carry tabindex="-1" on an interactive element`);
  }
  assert.deepEqual(missing, [], "pages missing a skip-link to <main id=\"main\">");
});

test("AC5 — light AND dark both pass; violations printed per theme (both 0)", () => {
  const { light, dark } = parseThemes(fs.readFileSync(CSS_PATH, "utf8"));
  for (const [name, tokens] of [["light", light], ["dark", dark]]) {
    const failures = [];
    for (const row of PAIRS) {
      const fg = tokens[row.fg], bg = tokens[row.bg];
      assert.ok(fg && bg, `${name}: token missing ${row.fg}/${row.bg}`);
      const ratio = contrast(fg, bg);
      if (ratio < THRESHOLD) failures.push(`${row.fg} on ${row.bg} = ${ratio.toFixed(2)}`);
    }
    // eslint-disable-next-line no-console
    console.log(`AC5 ${name}: ${failures.length} token-pair violation(s)`);
    assert.deepEqual(failures, [], `${name} theme token pairs below ${THRESHOLD}:1`);
  }
});
