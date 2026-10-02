// @test-group engine
// registry-bare-filename-scan.test.mjs — 裸文件名引用扫描 + 死集重算测试
// (tasks/gap-dead-set-registry-bare-filename-scan, SPEC-plugin-lifecycle-single-bundle-2026-09-02 §12f).
//
// AC1 (扫描器存在 + 按位置): scanCarrier / extractBareFilenameLiterals 只在字符串字面量（非注释）位置
//   命中裸文件名；capability-catalog.sh 显式排除。AC2 (真样本干跑 + 前 3 条): 对真实仓库 quay-deliver.ts
//   的 supervisor-bus-identity.sh 必须命中，且命中内容可打印。DoD 负控制: 把裸文件名引用从清单载体里
//   删掉，脚本应重新落回死集（computeKept 的 before/after 对照）。
//
// 硬规则 2（按位置）: 注释里的 `file: "x.sh"` 不算引用（maskComments 屏蔽注释）。
//
// Run:
//   scripts/test.sh plugin/test/registry-bare-filename-scan.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  KNOWN_SAMPLE,
  KNOWN_SAMPLE_CARRIER,
  EXTRA_KIND_SAMPLES,
  maskComments,
  extractBareFilenameLiterals,
  collectExtraRefs,
  scanCarrier,
  scanBareFilenameRefs,
  listScriptBasenames,
  listCarrierFiles,
  computeKept,
  buildReferenceMap,
  main,
} from "../scripts/registry-bare-filename-scan.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// ── 纯逻辑：按位置命中（注释不算）──────────────────────────────────────────────────────────────────────

test("extractBareFilenameLiterals hits the file: literal, ignores comments and non-matching strings", () => {
  const known = new Set(["supervisor-bus-identity.sh", "other.sh"]);
  const src = [
    '// { name: "supervisor-bus-identity", file: "supervisor-bus-identity.sh" }  // 注释内不算',
    'const x = { file: "supervisor-bus-identity.sh" };',
    'const y = "not-a-script.md";',
  ].join("\n");
  const hits = extractBareFilenameLiterals(src, known);
  assert.equal(hits.length, 1, "only the code-position literal counts, the comment one does not");
  assert.equal(hits[0].value, "supervisor-bus-identity.sh");
  assert.equal(hits[0].line, 2);
  assert.ok(hits[0].snippet.includes('file: "supervisor-bus-identity.sh"'));
});

test("maskComments masks // and /* */ and # but NOT string literals", () => {
  const src = '# c="in-bash-comment.sh"\nconst a = "keep.sh"; // c2="in-line-comment.sh"\n/* c3="in-block-comment.sh" */\n';
  const code = (() => {
    const mask = maskComments(src);
    const chars = [];
    for (let i = 0; i < src.length; i++) chars.push(mask[i] === 1 ? " " : src[i]);
    return chars.join("");
  })();
  assert.ok(code.includes('"keep.sh"'), "string literal preserved");
  assert.ok(!code.includes("in-line-comment.sh"), "// line comment masked");
  assert.ok(!code.includes("in-block-comment.sh"), "/* block comment masked");
  assert.ok(!code.includes("in-bash-comment.sh"), "# bash comment masked");
});

test("scanCarrier detects a bare filename in a code carrier and reports line + snippet", () => {
  const known = new Set(["supervisor-bus-identity.sh"]);
  const src = 'export const MEMBERS = [\n  { name: "x", file: "supervisor-bus-identity.sh" },\n];\n';
  const hits = scanCarrier("plugin/scripts/quay-deliver.ts", src, known);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].script, "supervisor-bus-identity.sh");
  assert.equal(hits[0].carrier.file, "plugin/scripts/quay-deliver.ts");
  assert.equal(hits[0].carrier.line, 2);
});

// ── AC2：真实仓库真样本命中（前 3 条实际内容）────────────────────────────────────────────────────────

test("AC2: real repo — supervisor-bus-identity.sh is bare-filename-referenced by quay-deliver.ts", () => {
  const result = scanBareFilenameRefs(repoRoot);
  const sample = result.refs.find((r) => r.script === KNOWN_SAMPLE);
  assert.ok(sample, `KNOWN_SAMPLE ${KNOWN_SAMPLE} must be found (0 hits = predicate broken, not "no such ref")`);
  const carrier = sample.carriers.find((c) => c.file === KNOWN_SAMPLE_CARRIER);
  assert.ok(carrier, `${KNOWN_SAMPLE} must be referenced by ${KNOWN_SAMPLE_CARRIER}`);
  assert.ok(carrier.snippet.includes(`file: "${KNOWN_SAMPLE}"`), "snippet carries the actual file: literal");
  // AC2 的「打印命中前 3 条」：命中的 carrier 条目可打印、非空。
  for (const c of sample.carriers.slice(0, 3)) {
    assert.ok(c.file.length > 0 && c.line >= 1 && c.snippet.length > 0);
  }
});

test("AC1: the capability-catalog DECLARATION DATA is excluded as a carrier (population description, not usage)", () => {
  const result = scanBareFilenameRefs(repoRoot);
  // 任何脚本的命中 carrier 都不该是那份声明数据 —— 它逐条登记种群里的每个 basename，当引用读会让所有
  // 脚本永远活着（硬规则 4）。该角色 2026-09-19 从 capability-catalog.sh 换到此文件
  // (gap-arch-catalog-declarations-leave-bash)：.sh 成了薄入口，可以（且必须）正常计入载体。
  for (const ref of result.refs) {
    for (const c of ref.carriers) {
      assert.ok(!c.file.endsWith("capability-catalog-declarations.json"),
        `${ref.script} must not be "referenced" by the catalog's declaration data`);
    }
  }
});

// ── 跳过谓词相对 root（gap-registry-scan-skip-predicate-matches-absolute-path）────────────────────────
// 旧缺陷：跳过判定按【绝对路径】逐段匹配 ⇒ root 祖先链里出现禁名段（Claude Code 的 `.claude/worktrees/`
// 同时命中 `worktrees` 与 `.claude`）时，listFiles() 一次都不下降、载体枚举静默归零，fan-in 静态相位
// 以「已知样本找不到」的形式假红。判据钉在【载体枚举数量】这个量上 —— 不是断言某个函数返回值。

/** 同步捕获 process.stdout.write（main 的 --scan --json 输出面）。node:test 顶层用例串行，安全。 */
function captureStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = (chunk) => { out += typeof chunk === "string" ? chunk : chunk.toString(); return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return out;
}

/** fixture：plugin/scripts/quay-deliver.ts（代码载体）+ sub/registry.json（JSON 载体），共 2 个载体。 */
function buildSkipFixture(root) {
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.sh"), "#!/usr/bin/env bash\n:\n");
  fs.writeFileSync(
    path.join(root, "plugin", "scripts", "quay-deliver.ts"),
    'export const MEMBERS = [{ name: "x", file: "foo.sh" }];\n',
  );
  fs.writeFileSync(path.join(root, "sub", "registry.json"), '{\n  "scripts": ["foo.sh"]\n}\n');
}

test("AC1/AC4: carrier enumeration does not depend on skip-named segments in the ancestor path", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "registry-skip-ancestor-"));
  try {
    // 同一份 fixture 放在三种祖先路径下：无禁名段 / 含 `worktrees` / 含 `.claude`。
    const plain = path.join(base, "plain", "wt-a", "fixture");
    const worktreesAncestor = path.join(base, "worktrees", "wt-a", "fixture");
    const claudeAncestor = path.join(base, ".claude", "w", "fixture");
    for (const r of [plain, worktreesAncestor, claudeAncestor]) buildSkipFixture(r);

    const expected = 2; // quay-deliver.ts + registry.json（fixture 定义的载体数）
    const plainCount = scanBareFilenameRefs(plain).carrierCount;
    // 非零锚：防止两个 fixture 都枚举成 0 时 0==0 恒真（硬规则 4c 的空转半边）。
    assert.equal(plainCount, expected, "fixture defines exactly two carriers (guards against a vacuous 0==0)");

    for (const [label, root] of [["worktrees", worktreesAncestor], [".claude", claudeAncestor]]) {
      const got = scanBareFilenameRefs(root).carrierCount;
      assert.equal(
        got,
        plainCount,
        `carrier count must not depend on a skip-named segment in the ancestor path (${label}): got ${got}, want ${plainCount}`,
      );
    }

    // `--scan --json` 走的就是 scanBareFilenameRefs；逐字确认 CLI 面同读数。
    const cliJson = captureStdout(() => main(["--scan", "--json", "--root", worktreesAncestor]));
    assert.equal(JSON.parse(cliJson).carrierCount, expected, "--scan --json carrierCount must match under a skip ancestor");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("AC2 negative control: node_modules/dist/vendor below root are still skipped", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-skip-below-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.sh"), "#!/usr/bin/env bash\n:\n");
    fs.writeFileSync(path.join(root, "manifest.json"), '{\n  "scripts": ["foo.sh"]\n}\n');
    for (const d of ["node_modules", "dist", "vendor"]) {
      fs.mkdirSync(path.join(root, d), { recursive: true });
      fs.writeFileSync(path.join(root, d, "manifest.json"), '{\n  "scripts": ["foo.sh"]\n}\n');
    }
    const rel = listCarrierFiles(root).map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
    assert.deepEqual(rel, ["manifest.json"], "only the root-level carrier is enumerated");
    for (const d of ["node_modules", "dist", "vendor"]) {
      // 零计数的配套动作：谓词对着一个【已知为真】的样本干跑——磁盘上确有该 .json，跳过才是真跳过。
      assert.ok(
        fs.existsSync(path.join(root, d, "manifest.json")),
        `fixture precondition: ${d}/manifest.json exists on disk (0 must be a real skip, not an absent input)`,
      );
      assert.equal(
        rel.filter((c) => c.split("/").includes(d)).length,
        0,
        `${d}/ below root must remain skipped`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── DoD 负控制：删除裸文件名引用 ⇒ 重新落回死集 ────────────────────────────────────────────────────────

test("DoD negative control: deleting the bare-filename ref from a manifest drops the script back into the dead set", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-bare-scan-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.sh"), "#!/usr/bin/env bash\n:\n");
    const manifest = path.join(root, "manifest.json");
    fs.writeFileSync(manifest, '{\n  "scripts": ["foo.sh"]\n}\n');

    const scripts = listScriptBasenames(root);
    assert.deepEqual(scripts, ["foo.sh"]);
    const executed = new Map([["foo.sh", 0]]);

    // WITH the bare-filename ref: foo.sh is kept (not in the dead set).
    const refsWith = scanBareFilenameRefs(root).refs;
    assert.equal(refsWith.length, 1);
    assert.equal(refsWith[0].script, "foo.sh");
    const keptWith = computeKept(root, scripts, executed, refsWith, true);
    assert.ok(keptWith.has("foo.sh"), "bare-filename ref keeps the script out of the dead set");

    // DELETE the ref: foo.sh falls back into the dead set.
    fs.writeFileSync(manifest, '{\n  "scripts": []\n}\n');
    const refsWithout = scanBareFilenameRefs(root).refs;
    assert.equal(refsWithout.length, 0);
    const keptWithout = computeKept(root, scripts, executed, refsWithout, true);
    assert.ok(!keptWithout.has("foo.sh"), "with the ref removed the script returns to the dead set");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 执行形式补认（gap-dead-set-closure-repo-root-call-form-false-positive）─────────────────────────────
// ${repo_root}/plugin/scripts/<name>（run_checker）、path.join(__dirname, "<name>")、$SCRIPT_DIR/<name>
// 三种执行形式此前都被 §12e 闭包漏认，导致执行核真实执行的脚本落进死集（AC158 负控制）。

test("run_checker ${repo_root}/plugin/scripts/<name> survives a # @static-object glob (bash .ts not mangled)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-bare-scan-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.sh"), "#!/usr/bin/env bash\n:\n");
    // runner-static-gate.ts 是 bash 语法的 .ts：其 `# @static-object` glob 里的星号斜杠会被只认行注释
    // 与块注释的 stripper 误判为块注释起点，吞掉 run_checker 行（活 checker 假死的根因）。
    fs.writeFileSync(path.join(root, "plugin", "scripts", "runner-static-gate.ts"), [
      "# runner-static-gate.ts — bash, sourced by test.sh",
      '# @static-object plugin/test/ packages/*/test/ experiments/*/test/',
      'run_checker "foo" bash "${repo_root}/plugin/scripts/foo.sh" "${repo_root}"',
    ].join("\n"));
    const scripts = listScriptBasenames(root);
    const bareRefs = scanBareFilenameRefs(root).refs;
    const { referrers } = buildReferenceMap(root, scripts, bareRefs, true);
    const refs = [...(referrers.get("foo.sh") ?? [])].map((f) => path.relative(root, f));
    assert.ok(
      refs.includes("plugin/scripts/runner-static-gate.ts"),
      "run_checker ${repo_root}/plugin/scripts/<name> must hit its caller (0 hits = predicate broken)",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("real repo: live checkers hit their execution-core caller via run_checker / kernel-resolution / $SCRIPT_DIR", () => {
  const scripts = listScriptBasenames(repoRoot);
  const bareRefs = scanBareFilenameRefs(repoRoot).refs;
  const { referrers } = buildReferenceMap(repoRoot, scripts, bareRefs, true);
  const cases = [
    // [script, expected caller] — run_checker / $SCRIPT_DIR / resolveKernelSibling /
    // path.join(resolveKernelPluginRoot()) 四种执行形式各钉一个已知为真样本。
    // （gap-ac225 后 path.join(__dirname) 活样本已迁移为 kernel 锚点，故此样本清单不再含 __dirname 形。）
    ["tmp-leak-pairing-check.sh", "plugin/scripts/runner-static-gate.ts"], // run_checker ${repo_root}/plugin/scripts/<name>
    ["assert-clean-tree.sh", "plugin/scripts/runner-tree-state.ts"], // path.join(resolveKernelPluginRoot(), "scripts", <name>)
    ["provision-verify-worktree.sh", "plugin/scripts/full-suite-runner.ts"], // 同上
    ["full-suite-runner.ts", "plugin/scripts/suite-state-trigger.ts"], // resolveKernelSibling("<name>")
    ["transcript-delivery-check.ts", "plugin/scripts/send-keys-reliable.sh"], // $SCRIPT_DIR/<name>
  ];
  for (const [script, expectedCaller] of cases) {
    const refs = [...(referrers.get(script) ?? [])].map((f) => path.relative(repoRoot, f));
    assert.ok(
      refs.includes(expectedCaller),
      `${script} must be referenced by ${expectedCaller} (got: ${refs.join(", ") || "∅"})`,
    );
  }
});

// ── 四类引用（gap-dead-set-closure-misses-four-reference-kinds）────────────────────────────────────
// §12e 闭包漏认的四类引用进入 collectExtraRefs：① source/. 内建 ② 测试存在性钉 ③ config gate 注册
// ④ wrapper→委托模块。每类各钉一个已知为真样本（硬规则 2）。

test("AC1: all four extra-kind known samples hit their expected carrier in the real repo", () => {
  const scripts = listScriptBasenames(repoRoot);
  const extra = collectExtraRefs(repoRoot, scripts);
  for (const s of EXTRA_KIND_SAMPLES) {
    const hit = extra.find((r) => r.script === s.script && r.kind === s.kind && r.carrier.file === s.carrier);
    assert.ok(hit, `${s.kind} sample ${s.script} must hit ${s.carrier} (0 hits = predicate broken, not "no such ref")`);
    assert.ok(hit.carrier.line >= 1, "carrier carries a real line number");
  }
});

test("kind ① source-builtin keeps a sourced script even when the carrier is not a delivery surface", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-bare-source-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.sh"), "#!/usr/bin/env bash\n:\n");
    fs.writeFileSync(path.join(root, "scripts", "test.sh"), 'source "${repo_root}/plugin/scripts/foo.sh"\n');
    const scripts = listScriptBasenames(root);
    const extra = collectExtraRefs(root, scripts);
    const executed = new Map([["foo.sh", 0]]);
    const kept = computeKept(root, scripts, executed, [], false, extra);
    assert.ok(kept.has("foo.sh"), "source-builtin keeps foo.sh alive regardless of carrier delivery-surface status");

    // 负控制：删掉 source 行 ⇒ foo.sh 落回死集。
    fs.writeFileSync(path.join(root, "scripts", "test.sh"), "");
    const extra2 = collectExtraRefs(root, scripts);
    const kept2 = computeKept(root, scripts, executed, [], false, extra2);
    assert.ok(!kept2.has("foo.sh"), "with the source line removed foo.sh returns to the dead set");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("kind ② test-pin keeps a script pinned by a plugin/test file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-bare-testpin-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.sh"), "#!/usr/bin/env bash\n:\n");
    fs.writeFileSync(path.join(root, "plugin", "test", "foo.test.mjs"), "const p = path.join(scriptsDir, 'foo.sh');\n");
    const scripts = listScriptBasenames(root);
    const extra = collectExtraRefs(root, scripts);
    const executed = new Map([["foo.sh", 0]]);
    const kept = computeKept(root, scripts, executed, [], false, extra);
    assert.ok(kept.has("foo.sh"), "test-pin keeps foo.sh alive");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("kind ③ config-gate keeps a script registered in .quay/config.yml", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-bare-config-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.sh"), "#!/usr/bin/env bash\n:\n");
    fs.writeFileSync(
      path.join(root, ".quay", "config.yml"),
      'gates:\n  fixed:\n    - name: x\n      script: "./plugin/scripts/foo.sh"\n',
    );
    const scripts = listScriptBasenames(root);
    const extra = collectExtraRefs(root, scripts);
    const executed = new Map([["foo.sh", 0]]);
    const kept = computeKept(root, scripts, executed, [], false, extra);
    assert.ok(kept.has("foo.sh"), "config-gate keeps foo.sh alive");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── --check 对「样本载体在磁盘上根本不存在」与「载体存在但 collector 扫不到样本」的区分 ──────────────
// (2026-09-15 真机实测：GitHub CI 一个干净 `actions/checkout@v4`，.quay/config.yml 是 gitignored、
// 从未在那种 checkout 里存在过 —— 此前两种态共用同一条 `RED: ... predicate broken`，把「读不到输入」
// 判成了「输入不对」，硬规则 3b。这条固定 CI 会在任何新 clone 上恒红这个回归。)

test("--check: a sample carrier absent from the checkout ⇒ NOT-EVALUATED (exit 3), not RED", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-bare-check-absent-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs", "analysis"), { recursive: true });
    // KNOWN_SAMPLE 前置：quay-deliver.ts 里真的有 supervisor-bus-identity.sh，且该脚本真的存在于
    // plugin/scripts/ 下 —— 否则 --check 会在更早的「known-sample not found by scan」处就退出，
    // 测不到本条要测的分支。
    fs.writeFileSync(path.join(root, "plugin", "scripts", KNOWN_SAMPLE), "#!/usr/bin/env bash\n:\n");
    fs.writeFileSync(
      path.join(root, "plugin", "scripts", "quay-deliver.ts"),
      `export const MEMBERS = [{ name: "x", file: "${KNOWN_SAMPLE}", kind: "bash" }];\n`,
    );
    // 死集一致性前置：写一份不含任何 dead 项的 dead-set-recomputed.json，让 --check 走到
    // EXTRA_KIND_SAMPLES 那一段（本条要测的分支）。
    fs.writeFileSync(
      path.join(root, "docs", "analysis", "dead-set-recomputed.json"),
      JSON.stringify({ after: { dead: [] } }),
    );
    // 刻意【不】创建 EXTRA_KIND_SAMPLES 第一项的载体（scripts/test.sh）——它在这个 checkout 里
    // 结构上就不存在，与 .quay/config.yml 在一个干净 checkout 里的处境同形。
    assert.ok(
      !fs.existsSync(path.join(root, EXTRA_KIND_SAMPLES[0].carrier)),
      "fixture precondition: the first known-sample carrier is genuinely absent",
    );

    const rc = main(["--check", "--root", root]);
    assert.equal(rc, 3, "an absent sample carrier must read as NOT-EVALUATED (3), never RED (1)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("kind ④ wrapper-delegate keeps the .sh wrapper when its .ts delegate is kept", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-bare-delegate-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.sh"), 'node "$(dirname "$0")/foo.ts" "$@"\n');
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.ts"), "export {};\n");
    const scripts = listScriptBasenames(root);
    const extra = collectExtraRefs(root, scripts);
    // foo.ts 三天内有执行（root 1），foo.sh 无执行 ⇒ 靠 wrapper-delegate 对称边被 foo.ts 拉入。
    const executed = new Map([["foo.ts", 1], ["foo.sh", 0]]);
    const kept = computeKept(root, scripts, executed, [], true, extra);
    assert.ok(kept.has("foo.ts"), "foo.ts kept (executed)");
    assert.ok(kept.has("foo.sh"), "foo.sh kept via wrapper-delegate symmetric edge");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
