// quay Core: criterion fidelity judge — the SECOND activation-gate question
// (GOAL-013 / tasks/gap-criterion-fidelity-gate-activation-blind-to-vacuous-criteria).
//
// A criterion record carries:
//   `criterion` — a RUNNABLE shell command (reuses the task acceptance-runner shape).
//   `expect`    — the outcome the criterion PROVES (its claimed object).
//
// The P6 activation gate already asks the FIRST question: "can this criterion RUN to a verdict?"
// (evaluability). This module asks the SECOND: "can this criterion be FALSE on the object its
// `expect` claims to measure?" — i.e. does it MEASURE the claimed object, or is it VACUOUSLY true
// (hard rule 4: a quantity structurally incapable of being false is not a measurement).
//
// 2026-09-10 production case: AC-225's criterion (`kernel-sibling-resolution-check --root . --json`,
// exit 0) got flipped achieved at 07:00:55Z while its checker could not flag cross-package source
// anchors — the `0` it produced was a too-narrow-definition `0`. I2 mis-fired, I4 did not apply,
// I5 was blind (the criterion still passed). The gap closed 73 minutes later (aca7a0511), found by
// production, not by mechanism. This module is the "achieved-but-vacuous" gap's mechanism answer:
// keep vacuous criteria OUT at activation time.
//
// 三态 (hard rule 3b — never conflate "not judged" with "judged faithful"):
//   faithful      — the criterion CAN be false on the claimed object (a real measurement).
//   vacuous       — the criterion is structurally incapable of being false on the claimed object.
//   not-evaluated — the judge could not reach a verdict (spawn fail / timeout / unparseable output).
//
// ⛔ Pure judgment + pure parsing — NO LLM spawn here. The semantic call is injected via the
// `invokeJudge` seam (a function parameter), so this module is unit-testable and does NOT add
// process responsibilities to Core. The parser is the fail-closed kernel primitive
// `kernel/verdict-parse.ts::parseBinaryVerdict` (GOAL-032 — the algorithm it shares with
// goal-driver.ts::parseSemanticSufficiencyVerdict now lives ONCE): only explicit parseable values are
// recognized; everything else (non-zero exit / empty output / unreadable / timeout / JSON parse
// failure) ⇒ not-evaluated, NEVER silently faithful.
//
// ⛔ gap-fidelity-judge-cannot-discriminate-the-founding-vacuous-case (2026-09-10): the real judge
//   (deepseek-v4-pro-anthropic via launchArgv("fix-worker")) returned `faithful` for BOTH the
//   pre-expansion checker (P1/P2/P3 only — structurally cannot flag cross-package source anchors)
//   and the post-expansion checker (adds P4). Discriminatory power = 0: even wired onto the
//   dominant activation path, the gate would let AC-225's vacuous criterion through (GOAL-013 风险 2
//   — "一个总是判 faithful 的保真性判定器…与『一切判据都保真』同形" — has materialized at the LLM
//   discrimination layer, not the code layer).
//
//   Fix = Direction B (mechanical pre-filter, the primary half) + Direction A (semantic prompt):
//   mechanicalFidelityVerdict computes, WITHOUT the LLM, the decidable sub-problem "does the
//   checker's scan surface reference a top-level source directory whose path segment appears in
//   NO regex pattern?" — a coverage asymmetry that makes the checker structurally unable to flag
//   that category ⇒ its `0` is vacuous for that category. It is SYMMETRIC (returns "vacuous" when
//   a gap exists, "faithful" when every scanned segment is covered by some pattern, else null to
//   defer to the semantic half) so it independently reproduces the pre/post discrimination and
//   generalizes to independent cases (⛔ no fixture / filename / AC-number recognition).

import fs from "node:fs";
import path from "node:path";
import { parseBinaryVerdict } from "./kernel/verdict-parse.ts";

/** The three-state fidelity verdict. */
export type FidelityVerdict = "faithful" | "vacuous" | "not-evaluated";

/** The judge's raw output — the same { stdout, exitCode } shape the driver's runAsync produces. */
export interface FidelityJudgeResult {
  stdout: string | null;
  exitCode: number | null;
}

/** The injected seam: given the prompt, produce the judge's raw stdout + exit code.
 *  Synchronous on purpose (the activation gate is a one-shot CLI write, not a hot-loop round —
 *  matching runAcceptance's spawnSync shape). */
export type FidelityInvokeJudge = (prompt: string) => FidelityJudgeResult;

/** Parse the judge's stdout → three-state verdict. ⛔ fail-closed (硬规则 3b): only explicit,
 *  parseable `faithful`/`vacuous` are recognized — a bare token, or `{"verdict":"…"}` JSON scanned
 *  from the LAST line upward. Everything else (non-zero exit, empty output, unreadable prose, JSON
 *  parse failure, an unknown verdict value) ⇒ not-evaluated. NEVER falls back to faithful.
 *
 *  GOAL-032: 解析算法已收敛到 kernel 单一实现 `./kernel/verdict-parse.ts::parseBinaryVerdict`
 *  （此前本函数与 goal-driver.ts::parseSemanticSufficiencyVerdict 逐字相同的镜像现已结构化）——
 *  本函数只是把本领域的合法值字面量传入的薄包装，签名/返回类型不变。 */
export function parseFidelityVerdict(stdout: string | null, exitCode: number | null): FidelityVerdict {
  return parseBinaryVerdict(stdout, exitCode, "faithful", "vacuous");
}

// ── 机械前置筛（方向 B，⛔ 不调 LLM）────────────────────────────────────────────────────────
// 判据的保真性在「expect 声称检查器的机械枚举是完整覆盖」时，可机械化为一个可判子问题：
// 检查器【扫描面】里的顶层目录段（如 "packages"），是否被它的任一 RegExp 模式引用。不引用 ⇒
// 检查器结构上无法标记该目录段的锚定类别 ⇒ 其「0」对该类别空洞 ⇒ vacuous；全引用 ⇒ 计数可被
// 证伪 ⇒ faithful。这一半能取假、不调 LLM，且对独立构造的空洞/保真判据同样成立（⛔ 不认夹具
// 本身/文件名/AC 编号——只认「扫描面段 vs 模式覆盖」的结构不对称，硬规则 2/4）。

/** 完整性主张标记（totality claim）：expect 声称「检查器的机械枚举即完整覆盖」时，判据的保真性
 *  等于「检查器覆盖面是否覆盖 expect 声称的类别」。⛔ 无此主张 ⇒ 机械半不判（defer 语义半）——
 *  一个不声称完整覆盖的检查器，扫描某目录却不引用该目录段，可能是合法的局部测量，不是空洞。 */
export const TOTALITY_CLAIM_RE = /完整性由[^，。\n]*机械枚举|机械枚举|完整性由检查器|枚举为\s*0|枚举为\s*[0-9]+\s*处/;

/** 从机制源里取【扫描面顶层目录段】集合：被引号包裹、含 `/` 的多段相对路径字面量的第一段
 *  （如 "packages/quay/src" → "packages"、"plugin/scripts" → "plugin"）。⛔ 不含以 `.` 开头的段
 *  （".." 是 repo-root 惯用法，不是扫描类别）。 */
export function scanSurfaceTopSegments(mechanism: string): Set<string> {
  const segs = new Set<string>();
  const re = /["']([A-Za-z0-9_.-]+\/[A-Za-z0-9_.\-/]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mechanism)) !== null) {
    const first = m[1].split("/")[0];
    if (first.startsWith(".")) continue;
    segs.add(first);
  }
  return segs;
}

/** 从机制源里取全部 `new RegExp(<body>)` 构造体的 body 文本（模板字面量与字符串两种形态），
 *  合并成一份「覆盖签名」——供扫描面段覆盖率判定。⛔ 只取 RegExp 构造体（真正的模式），
 *  不取注释/散文里的路径提法（按位置判定，硬规则 2）。 */
export function regexBodies(mechanism: string): string {
  const bodies: string[] = [];
  const re = /new\s+RegExp\s*\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mechanism)) !== null) bodies.push(m[1]);
  return bodies.join("\n");
}

/** 机械保真性判定（方向 B，⛔ 不调 LLM，能取假）：
 *  "vacuous" — expect 有完整性主张，且扫描面里存在一个顶层目录段 S（如 "packages"）不被任一
 *              RegExp 模式引用 ⇒ 检查器结构上无法标记 S 锚定的类别 ⇒ 其「0」对该类别空洞。
 *  "faithful" — expect 有完整性主张，扫描面非空，且每个扫描面段都被某个 RegExp 模式引用 ⇒
 *              检查器能标记所扫描的每个类别 ⇒ 计数可被证伪 ⇒ 判据能取假。
 *  null       — 机制缺失 / 无完整性主张 / 无扫描面段 ⇒ 机械判不出，defer 语义半。
 *  ⛔ 只认「扫描面段 vs 模式覆盖」的结构不对称，不认夹具本身 / 文件名 / AC 编号。 */
export function mechanicalFidelityVerdict(
  expect: string,
  mechanism: string | null | undefined,
): FidelityVerdict | null {
  if (!mechanism || mechanism.trim() === "") return null;
  if (!TOTALITY_CLAIM_RE.test(expect)) return null;
  const segs = scanSurfaceTopSegments(mechanism);
  if (segs.size === 0) return null;
  const bodies = regexBodies(mechanism);
  const gaps = [...segs].filter((s) => !bodies.includes(s));
  return gaps.length > 0 ? "vacuous" : "faithful";
}

/** 从判据命令里找被引用的检查器文件并读回其源（机械半的机制源；⛔ 不 spawn 进程，只读文件）。
 *  找不到引用 / 读失败 ⇒ null（机械半 defer）。生产激活路径不传 `mechanism`，就靠这条从 criterion
 *  命令引用的 `plugin/scripts/<name>.ts` 等文件读回检查器源。 */
export function readMechanismFromCriterion(criterion: string, root: string | undefined): string | null {
  if (!root) return null;
  const relPaths = new Set<string>();
  const re = /([A-Za-z0-9_.-]+(?:[/\\][A-Za-z0-9_.-]+)+\.(?:ts|mjs|js|cjs|sh))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(criterion)) !== null) relPaths.add(m[1]);
  if (relPaths.size === 0) return null;
  const parts: string[] = [];
  for (const rel of relPaths) {
    try {
      parts.push(`/* --- ${rel} --- */\n${fs.readFileSync(path.join(root, rel), "utf8")}`);
    } catch {
      /* 单个文件读失败跳过（best-effort；读不到 ⇒ 机械半 defer，硬规则 6 缺值=未查） */
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/** Build the fidelity prompt. `mechanism` is OPTIONAL extra context — the source of the criterion's
 *  referenced mechanism (e.g. the checker the criterion runs). When absent (the production path),
 *  the judge is told it may read the referenced files itself (claude -p runs in the repo root).
 *  When present (the deterministic test path), it is embedded so a seam judge can decide without a
 *  live repo — the same reason sufficiency's `sufficiencyCmd` seam exists. */
export function buildFidelityPrompt(
  criterion: string,
  expect: string,
  opts: { root?: string; mechanism?: string } = {},
): string {
  const lines = [
    "You are a criterion-fidelity judge in the quay repo. Decide whether this goal criterion CAN be false on the object its `expect` claims to measure — a real measurement, or vacuously true?",
  ];
  if (opts.root) lines.push(`Repo root: ${opts.root}.`);
  lines.push("## criterion (runnable command):", criterion, "## expect (claimed object):", expect);
  if (opts.mechanism !== undefined) {
    lines.push("## criterion's referenced mechanism (source):", opts.mechanism);
  } else {
    lines.push("You may read the files the criterion references in the repo to inspect its mechanism.");
  }
  // 方向 A（语义半）——给【判准与推理路径】，⛔ 不给本条结论（否则是对夹具过拟合，AC3）：
  lines.push(
    "## How to judge vacuousness (the decisive question)",
    "A criterion that claims completeness (e.g. its `expect` says the verdict is the checker's own mechanical enumeration, and that enumeration is complete over the claimed object category) is vacuous if the checker it invokes cannot flag the category it claims — the count it reports is a too-narrow-definition count.",
    "Concrete test: does the checker's SCAN SURFACE include a source directory (a top-level path segment such as `packages/`) whose path segment appears in NONE of the checker's pattern definitions (its RegExp bodies)? If a scanned directory's defining path segment is never referenced by any pattern, the checker cannot flag anchors within that directory, so a `0` count over that directory is vacuous for it.",
    "Few-shot NEGATIVE example (vacuous): a checker whose `expect` claims its enumeration is complete, but which scans a `packages/<pkg>/src` source tree while every RegExp only matches `path.join(__dirname, …)` and never references `packages` — it can never flag a `packages/…`-anchored module, so its completeness claim is false ⇒ vacuous.",
    "Few-shot POSITIVE example (faithful): a checker scanning `packages/<pkg>/src` whose RegExp set DOES include a pattern referencing `packages` — it can flag the `packages/…` anchor, so its `0` count can be false ⇒ faithful.",
  );
  lines.push(
    'Reply with EXACTLY one line of JSON and nothing else: {"verdict":"faithful"} if the criterion can be false on the claimed object, otherwise {"verdict":"vacuous"}.',
  );
  return lines.join("\n");
}

/** The fidelity judgment. The semantic call goes through the injected `invokeJudge` seam, but ONLY
 *  after the mechanical pre-filter (方向 B) fails to decide — the mechanical half short-circuits the
 *  LLM for the coverage-asymmetry cases (pre⇒vacuous, post⇒faithful) so the discrimination is
 *  deterministic and non-LLM. Returns { verdict, reason }. A thrown seam ⇒ not-evaluated (never
 *  faithful). */
export function criterionFidelityVerdict(
  criterion: string,
  expect: string,
  invokeJudge: FidelityInvokeJudge,
  opts: { root?: string; mechanism?: string } = {},
): { verdict: FidelityVerdict; reason: string } {
  // 方向 B 机械前置筛（⛔ 不调 LLM）：机制源优先用注入的 `opts.mechanism`（测试/确定性路径），
  // 否则从 criterion 命令引用的检查器文件读回（生产激活路径）。
  const mechanism = opts.mechanism ?? readMechanismFromCriterion(criterion, opts.root);
  const mechanical = mechanicalFidelityVerdict(expect, mechanism);
  if (mechanical !== null) {
    return {
      verdict: mechanical,
      reason: mechanical === "vacuous"
        ? "mechanical fidelity (no LLM): a scanned source directory's path segment appears in no pattern — coverage gap ⇒ vacuous"
        : "mechanical fidelity (no LLM): every scanned source directory's path segment is covered by some pattern ⇒ faithful",
    };
  }
  const prompt = buildFidelityPrompt(criterion, expect, opts);
  let res: FidelityJudgeResult;
  try {
    res = invokeJudge(prompt);
  } catch (err) {
    return {
      verdict: "not-evaluated",
      reason: `fidelity judge threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const verdict = parseFidelityVerdict(res.stdout, res.exitCode);
  const reason = verdict === "not-evaluated"
    ? `fidelity judge unreadable (exit ${res.exitCode})`
    : `fidelity judge: ${verdict}`;
  return { verdict, reason };
}
