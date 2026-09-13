// @test-group engine
// enum-surface-parity-check.test.mjs — ADR-036 检查器的取假测试
// (tasks/gap-enum-surfaces-hand-copied-across-cli-web-docs).
//
// 契约（本任务的 AC1/AC3/AC4 + ADR-036 规范 4/5）：
//   AC1 能取假：往权威枚举加一个值 ⇒ 检查器必须报出各表层未同步（RED）；同步/还原后转绿。
//   AC3 未评估可区分：某表层读不出（文件缺失）⇒ 输出 NOT-EVALUATED（exit 3），
//        ⛔ 既非「一致」(exit 0) 也非「不一致」(exit 1)。
//   AC4 豁免不依赖位置：把合法豁免注释【移动到被检测构造内部】⇒ 仍须正确识别该豁免
//        （archguard TASK-88 的坑：注释在构造内会让该项目的提取正则整个失败 ⇒ 该项隐形）。
//   另：规范 2 的派生面（no literal + import authority）判为 derived（比字面量副本更强）；
//       已知漂移台账 shrink-only（增长红、收窄容忍）；空登记表 ⇒ NOT-EVALUATED 而非 PASS。
//
// 夹具用 --registry 指向一个临时 JSON 登记表（与被测机制同一套判定路径），根目录是临时树。
//
// Run:
//   scripts/test.sh plugin/test/enum-surface-parity-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "enum-surface-parity-check.ts");

// ── fixture tree (tmp-leak-pairing: every mkdtemp has a paired rmSync in after()) ───────────────────
const tmpRoots = [];
function mkFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enum-parity-test-"));
  tmpRoots.push(dir);
  return dir;
}
after(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

const AUTHORITY = `export const COLORS = ["red", "green", "blue"];\n`;

/** Write the fixture tree; returns {root, registryPath}. */
function buildFixture(opts = {}) {
  const root = mkFixture();
  fs.mkdirSync(path.join(root, "auth"), { recursive: true });
  fs.mkdirSync(path.join(root, "surf"), { recursive: true });
  fs.writeFileSync(path.join(root, "auth", "enum.ts"), opts.authority ?? AUTHORITY);
  fs.writeFileSync(path.join(root, "surf", "exact.ts"), opts.exact ?? AUTHORITY);
  fs.writeFileSync(
    path.join(root, "surf", "derived.ts"),
    `import { COLORS } from "../auth/enum.ts";\nexport const MY_COLORS = [...COLORS];\n`,
  );
  fs.writeFileSync(
    path.join(root, "surf", "subset.ts"),
    opts.subset ?? `// enum-surface-exempt: subset-surface — Web 控制面有意只暴露两个颜色（理由足够长）\nexport const WEB_COLORS = ["red", "green"] as const;\n`,
  );
  fs.writeFileSync(path.join(root, "surf", "text.txt"), `usage: --kind <red|green|blue> [flags]\n`);
  if (opts.writeMissing !== false) {
    fs.writeFileSync(path.join(root, "surf", "missing.ts"), AUTHORITY);
  }
  const registry = {
    authorities: [{ id: "color", file: "auth/enum.ts", symbol: "COLORS", extract: "ts-array" }],
    surfaces: [
      { id: "exact-surface", authority: "color", file: "surf/exact.ts", extract: "ts-array", symbol: "COLORS", policy: "exact" },
      { id: "derived-surface", authority: "color", file: "surf/derived.ts", extract: "ts-array", symbol: "MY_COLORS", policy: "exact" },
      { id: "subset-surface", authority: "color", file: "surf/subset.ts", extract: "ts-array", symbol: "WEB_COLORS", policy: "subset" },
      { id: "text-surface", authority: "color", file: "surf/text.txt", extract: "text", anchor: "--kind <([a-z-]+\\|[a-z|-]+)>", policy: "exact" },
      ...(opts.writeMissing === false
        ? [{ id: "missing-surface", authority: "color", file: "surf/gone.ts", extract: "ts-array", symbol: "GONE", policy: "exact" }]
        : []),
    ],
    knownDrift: opts.knownDrift ?? [],
  };
  const registryPath = path.join(root, "registry.json");
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return { root, registryPath };
}

function run(root, registryPath, extra = []) {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, "--registry", registryPath, ...extra],
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
  );
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── AC1: takes-false ────────────────────────────────────────────────────────────────────────────────

test("AC1 — adding one authoritative value reddens every non-derived surface; restoring returns green", () => {
  const { root, registryPath } = buildFixture();

  const before = run(root, registryPath);
  assert.equal(before.code, 0, `baseline must be green\n${before.stdout}${before.stderr}`);

  // INJECT: one extra authoritative value.
  fs.writeFileSync(path.join(root, "auth", "enum.ts"), `export const COLORS = ["red", "green", "blue", "yellow"];\n`);
  const after_ = run(root, registryPath);
  assert.equal(after_.code, 1, `one extra authoritative value MUST redden the checker\n${after_.stdout}`);
  for (const surface of ["exact-surface", "text-surface"]) {
    assert.match(after_.stdout, new RegExp(`\\[violation\\] ${surface}`), `surface ${surface} must be reported out-of-sync`);
  }
  // The exempt subset surface is REPORTED with the grown diff (missing=blue,yellow) but stays exempt —
  // subset means "narrowing is allowed", and an exemption is not a silent pass: the diff is printed.
  assert.match(after_.stdout, /\[exempt\] subset-surface .*missing=\[[^\]]*yellow/);
  assert.match(after_.stdout, /missing=\[[^\]]*yellow/, "the new value must appear in the two-way diff");
  // The DERIVED surface stays clean — it derives by construction (规范 2).
  assert.match(after_.stdout, /\[derived\] derived-surface/);

  // RESTORE.
  fs.writeFileSync(path.join(root, "auth", "enum.ts"), AUTHORITY);
  const restored = run(root, registryPath);
  assert.equal(restored.code, 0, `restoring the authority must return green\n${restored.stdout}`);
});

// ── AC3: NOT-EVALUATED is a distinct third state ────────────────────────────────────────────────────

test("AC3 — an unreadable surface is NOT-EVALUATED (exit 3), distinguishable from both PASS and FAIL", () => {
  const { root, registryPath } = buildFixture({ writeMissing: false });
  const r = run(root, registryPath);
  assert.equal(r.code, 3, `an unreadable surface must be exit 3 (got ${r.code})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /NOT-EVALUATED: /, "the verdict line must be the distinct NOT-EVALUATED form");
  assert.match(r.stdout, /missing-surface: .*file not found/);
  assert.doesNotMatch(r.stdout, /^PASS: /m);
  assert.doesNotMatch(r.stdout, /^FAIL: /m);

  // Negative control on the distinction: making the file readable moves the SAME fixture to PASS.
  fs.writeFileSync(path.join(root, "surf", "gone.ts"), `export const GONE = ["red", "green", "blue"];\n`);
  const ok = run(root, registryPath);
  assert.equal(ok.code, 0, `a readable surface returns PASS (got ${ok.code})\n${ok.stdout}`);
  assert.match(ok.stdout, /^PASS: /m);
});

// ── AC4: the exemption must not depend on the marker's position ─────────────────────────────────────

test("AC4 — an exemption marker moved INSIDE the flagged construct is still recognised", () => {
  const { root, registryPath } = buildFixture();
  const before = run(root, registryPath);
  assert.equal(before.code, 0, before.stdout);
  assert.match(before.stdout, /\[exempt\] subset-surface/, "before: exempt");

  // MOVE the marker INSIDE the detected construct (the array literal). archguard TASK-88's trap: a
  // marker inside the construct made the extraction regex fail and the entry vanished entirely.
  fs.writeFileSync(
    path.join(root, "surf", "subset.ts"),
    `export const WEB_COLORS = [\n  // enum-surface-exempt: subset-surface — 移动到构造内部后仍须被识别（理由足够长）\n  "red",\n  "green",\n] as const;\n`,
  );
  const inside = run(root, registryPath);
  assert.equal(inside.code, 0, `marker inside the construct must still be recognised\n${inside.stdout}`);
  assert.match(inside.stdout, /\[exempt\] subset-surface/, "inside: still exempt (not a silent narrowing)");
  assert.match(inside.stdout, /豁免（第 \d+ 行）/, "the recognised marker is reported with its line + reason");
});

test("AC4 negative control — a narrowing surface with NO marker is a violation (silent narrowing)", () => {
  const { root, registryPath } = buildFixture({
    subset: `export const WEB_COLORS = ["red", "green"] as const;\n`,
  });
  const r = run(root, registryPath);
  assert.equal(r.code, 1, `a narrowing surface with no marker MUST be RED\n${r.stdout}`);
  assert.match(r.stdout, /\[violation\] subset-surface/);
  assert.match(r.stdout, /无豁免注释/);
});

test("AC4 negative control — a marker naming a DIFFERENT surface does not exempt this one", () => {
  const { root, registryPath } = buildFixture({
    subset: `// enum-surface-exempt: some-other-surface — 这条豁免说的是别的面，不适用于 subset-surface\nexport const WEB_COLORS = ["red", "green"] as const;\n`,
  });
  const r = run(root, registryPath);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /\[violation\] subset-surface/);
});

// ── 规范 2: derivation is recognised (and is not a hand-copy) ───────────────────────────────────────

test("a surface that imports the authority (no literal) is reported as derived, not as a violation", () => {
  const { root, registryPath } = buildFixture();
  const r = run(root, registryPath);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /\[derived\] derived-surface .*派生自 auth\/enum\.ts:COLORS/);
});

// ── 规范 2 的【运行时派生】形态（SurfaceSpec.derivesFrom）────────────────────────────────────────────
// 为什么需要它：driver 帮助文本的权威在 plugin/scripts/*，而 packages/quay/src 维持「零 plugin/ 静态
// import」边界（observation.ts 的静态 import 禁令）⇒ authorityDerivation 结构上不可达；且 text 面的
// 「anchor 命中 0 次」是 ok:false，不是「提取到 0 个值」，会先掉进 !ex.ok 的 NOT-EVALUATED 分支。
// 两个缺口叠加 ⇒ 把帮助文本改成真派生（更强的形态）反而让检查器【失去】这个面。
// 下面 5 个用例：1 正 + 4 反，逐条证明声明的每条规则都能取假。

/** 一个"运行时派生"的面：help.ts 把 vocab.ts 的 VOCAB 插值进 --kind 槽位（⛔ 无字面量副本）。 */
const DERIVED_HELP = (body) =>
  body ?? `import { VOCAB } from "./vocab.ts";\nexport const HELP = \`usage: --kind <\${VOCAB.join("|")}> [flags]\`;\n`;
const DERIVED_VOCAB = `export const VOCAB = ["red", "green", "blue"];\n`;

function buildDerivedFixture(helpBody, vocabBody) {
  const root = mkFixture();
  fs.mkdirSync(path.join(root, "auth"), { recursive: true });
  fs.mkdirSync(path.join(root, "surf"), { recursive: true });
  fs.writeFileSync(path.join(root, "auth", "enum.ts"), AUTHORITY);
  fs.writeFileSync(path.join(root, "surf", "vocab.ts"), vocabBody ?? DERIVED_VOCAB);
  fs.writeFileSync(path.join(root, "surf", "help.ts"), DERIVED_HELP(helpBody));
  const registry = {
    authorities: [{ id: "color", file: "auth/enum.ts", symbol: "COLORS", extract: "ts-array" }],
    surfaces: [
      {
        id: "derived-text-surface",
        authority: "color",
        file: "surf/help.ts",
        extract: "text",
        anchor: "--kind <([a-z-]+\\|[a-z|-]+)>",
        policy: "exact",
        derivesFrom: {
          file: "surf/vocab.ts",
          symbol: "VOCAB",
          extract: "ts-array",
          spelling: "--kind <\\$\\{[^}]*\\bVOCAB\\b[^}]*\\}>",
        },
      },
    ],
    knownDrift: [],
  };
  const registryPath = path.join(root, "registry.json");
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return { root, registryPath };
}

test("derivesFrom positive — a surface interpolating a verified symbol is [derived] and green", () => {
  const { root, registryPath } = buildDerivedFixture();
  const r = run(root, registryPath);
  assert.equal(r.code, 0, `must be green\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /\[derived\] derived-text-surface .*派生自 surf\/vocab\.ts:VOCAB（已与权威逐一比对）/);
  assert.equal(r.stdout.includes("NOT-EVALUATED"), false);
});

test("derivesFrom negative ① — the derived spelling is absent (help text deleted / slot renders another symbol) ⇒ NOT-EVALUATED, ⛔ not PASS", () => {
  const { root, registryPath } = buildDerivedFixture(
    `import { VOCAB } from "./vocab.ts";\nimport { OTHER } from "./other.ts";\nexport const HELP = \`usage: --kind <\${OTHER.join("|")}> [flags]\`;\n`,
  );
  const r = run(root, registryPath);
  assert.equal(r.code, 3, `unverifiable declaration must be NOT-EVALUATED\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /NOT-EVALUATED/);
  assert.match(r.stdout, /derived spelling/);
});

test("derivesFrom negative ② — cross-file without the import ⇒ NOT-EVALUATED (派生源未接线)", () => {
  const { root, registryPath } = buildDerivedFixture(
    `export const HELP = \`usage: --kind <\${VOCAB.join("|")}> [flags]\`;\n`,
  );
  const r = run(root, registryPath);
  assert.equal(r.code, 3, `missing import must be NOT-EVALUATED\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /no `import/);
});

test("derivesFrom negative ③ — the consumed symbol diverges from the authority ⇒ RED (断链不洗白)", () => {
  // vocab.ts 少了 blue：被消费的符号自己就与权威不一致 ⇒ 必须是 violation，⛔ 不是 not-evaluated。
  const { root, registryPath } = buildDerivedFixture(undefined, `export const VOCAB = ["red", "green"];\n`);
  const r = run(root, registryPath);
  assert.equal(r.code, 1, `broken chain must be RED\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /\[violation\]/);
  assert.match(r.stdout, /断链/);
});

test("derivesFrom negative ④ — declared derived but still carrying a literal copy ⇒ RED", () => {
  // 手抄回字面量（即便取值恰好与权威相同）⇒ 声明不成立。⛔ 不是"同步就放行"。
  const { root, registryPath } = buildDerivedFixture(`export const HELP = \`usage: --kind <red|green|blue> [flags]\`;\n`);
  const r = run(root, registryPath);
  assert.equal(r.code, 1, `a hand copy under a derivation claim must be RED\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /\[violation\]/);
  assert.match(r.stdout, /却仍带字面量副本/);
});

// ── known-drift ledger: shrink-only ────────────────────────────────────────────────────────────────

test("KNOWN_DRIFT — recorded drift is reported but not blocking; growth reddens; shrinkage is tolerated", () => {
  const recorded = [
    { surface: "subset-surface", extra: [], missing: ["blue"], reason: "recorded at fixture time" },
  ];
  const { root, registryPath } = buildFixture({ knownDrift: recorded });
  const baseline = run(root, registryPath);
  assert.equal(baseline.code, 0, `recorded drift must not block\n${baseline.stdout}`);
  assert.match(baseline.stdout, /已知漂移.*1 条/);

  // GROWTH: the authority gains a value the surface also lacks ⇒ the recorded diff grew ⇒ RED.
  fs.writeFileSync(path.join(root, "auth", "enum.ts"), `export const COLORS = ["red", "green", "blue", "yellow"];\n`);
  const grown = run(root, registryPath);
  assert.equal(grown.code, 1, `grown drift MUST be RED\n${grown.stdout}`);
  assert.match(grown.stdout, /台账登记为/);

  // SHRINKAGE: the surface now lists "blue" (someone synced it) ⇒ tolerated, flagged for cleanup.
  fs.writeFileSync(path.join(root, "auth", "enum.ts"), AUTHORITY);
  fs.writeFileSync(
    path.join(root, "surf", "subset.ts"),
    `// enum-surface-exempt: subset-surface — 收窄测试（理由足够长）\nexport const WEB_COLORS = ["red", "green", "blue"] as const;\n`,
  );
  const shrunk = run(root, registryPath);
  assert.equal(shrunk.code, 0, `shrinkage must be tolerated\n${shrunk.stdout}`);
});

// ── empty registry is NOT a pass ────────────────────────────────────────────────────────────────────

test("an empty registry is NOT-EVALUATED — ⛔ never read as PASS", () => {
  const root = mkFixture();
  const registryPath = path.join(root, "empty.json");
  fs.writeFileSync(registryPath, JSON.stringify({ authorities: [], surfaces: [], knownDrift: [] }));
  const r = run(root, registryPath);
  assert.equal(r.code, 3, `empty registry must be exit 3 (got ${r.code})\n${r.stdout}`);
  assert.match(r.stdout, /NOT-EVALUATED: registry is empty/);
  assert.doesNotMatch(r.stdout, /^PASS: /m);
});

// ── --json: the machine form carries the same three states ──────────────────────────────────────────

test("--json emits one JSON object whose status matches the exit code", () => {
  const { root, registryPath } = buildFixture();
  const ok = run(root, registryPath, ["--json"]);
  assert.equal(ok.code, 0, ok.stderr);
  const parsed = JSON.parse(ok.stdout.trim());
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.surfaces.length, 4);

  fs.writeFileSync(path.join(root, "auth", "enum.ts"), `export const COLORS = ["red", "green", "blue", "yellow"];\n`);
  const bad = run(root, registryPath, ["--json"]);
  assert.equal(bad.code, 1);
  const parsedBad = JSON.parse(bad.stdout.trim());
  assert.equal(parsedBad.status, "fail");
  assert.ok(parsedBad.violations.length >= 1);
});

// ── the REAL tree: this repo's own surfaces are consistent under the built-in registry ─────────────

test("the built-in registry over THIS repo is green (the two live drifts are gone)", (t) => {
  // This assertion is about the HOST repo's own surfaces; a delivered bundle (no packages/quay/src)
  // has nothing to check — the checker itself would report NOT-EVALUATED there (that is its own AC3).
  if (!fs.existsSync(path.join(repoRoot, "packages", "quay", "src", "abi.ts"))) {
    t.skip("not a quay host checkout — no packages/quay/src to check");
    return;
  }
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(r.status, 0, `built-in registry must be green on this tree\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /web-driver-kinds.*\[exempt\]|\[exempt\].*web-driver-kinds/);
  assert.match(r.stdout, /\[derived\] goal-store-valid-statuses/);
  assert.match(r.stdout, /^PASS: /m);
});
