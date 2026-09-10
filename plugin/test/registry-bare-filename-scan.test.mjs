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
  computeKept,
  buildReferenceMap,
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

test("AC1: capability-catalog.sh is excluded as a carrier (population description, not usage)", () => {
  const result = scanBareFilenameRefs(repoRoot);
  // 任何脚本的命中 carrier 都不该是 capability-catalog.sh。
  for (const ref of result.refs) {
    for (const c of ref.carriers) {
      assert.ok(!c.file.endsWith("capability-catalog.sh"), `${ref.script} must not be "referenced" by the catalog`);
    }
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
