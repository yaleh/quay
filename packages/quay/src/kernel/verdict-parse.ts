// verdict-parse.ts — kernel 单一实现：把判定器的原始 stdout 解析成三态 verdict。
//
// WHY IT LIVES IN THE KERNEL (SPEC §2 P1: 共享原语落点 `packages/quay/src/kernel/`):
// 同一段解析循环曾以**逐字相同**的形态存在于两处——
//   · 产品侧 `packages/quay/src/criterion-fidelity.ts::parseFidelityVerdict`（合法值 faithful/vacuous）
//   · 方法学侧 `plugin/scripts/goal-driver.ts::parseSemanticSufficiencyVerdict`（合法值 covered/insufficient）
// 两处算法逐字相同，只有**合法值字面量**不同（`criterion-fidelity.ts:27-28` 与
// `plugin/test/criterion-fidelity-historical-case.test.mjs` 均自述是对另一处的 "verbatim"/"复刻"）。
// 手工维护的镜像现已结构化：算法只此一份，字面量由调用方传入。
//
// The kernel is the only placement both layers can reach. The direction must be plugin → kernel:
// `packages/**` importing `plugin/**` is a REVERSE EDGE (import-graph-check's `reverseEdges` ratchet,
// baselined at 0)，so the product-side judge cannot import the methodology-side copy. 同
// `kernel/regex-escape.ts` / `kernel/shape-sections.ts` 的落点论证。
//
// KERNEL BOUNDARY (import-graph-check 第四规则): this file imports NOTHING. It is a leaf, so it can
// never participate in a value or type cycle, and the boundary rule that kernel files may not import
// outside the kernel is satisfied vacuously.
//
// NOT A CHECKER, NOT AN INSTRUMENT: it answers no question of its own and is deliberately absent from
// the capability catalog's QUESTION table — it is a primitive consumed by instruments that do.

/** 给定 stdout/exitCode 与合法的 positive/negative 字面量，解析出三态 verdict。
 *  fail-closed（硬规则 3b）：非零退出、空输出、裸 token 不匹配、JSON 无 verdict 键、verdict 非法值
 *  ⇒ not-evaluated，绝不默认回落到 positive。
 *
 *  识别三种形态：
 *    1. 纯 token（测试缝 / 极简输出）：trim 后整串 === positive/negative。
 *    2. JSON 对象（claude -p 可能带解释性前文）：{"verdict":"<positive|negative>"}，从末行向上
 *       找第一个可解析的 JSON 对象。
 *    3. 其余一切 ⇒ not-evaluated。
 *  ⛔ 算法领域无关：合法值字面量由调用方传入，本函数不认识任何具体领域（fidelity/sufficiency）。
 *
 *  @param stdout   判定器的原始标准输出（可为 null —— 进程未产出）
 *  @param exitCode 判定器的退出码（可为 null —— 未知）；非 0 ⇒ not-evaluated
 *  @param positive 正向字面量（如 "faithful" / "covered"）
 *  @param negative 负向字面量（如 "vacuous" / "insufficient"）
 */
export function parseBinaryVerdict<P extends string, N extends string>(
  stdout: string | null,
  exitCode: number | null,
  positive: P,
  negative: N,
): P | N | "not-evaluated" {
  if (exitCode !== 0) return "not-evaluated";
  const text = (stdout ?? "").trim();
  // 纯 token（测试缝 / 极简输出）也认。
  if (text === positive || text === negative) return text as P | N;
  // JSON 形态：{"verdict":"<positive|negative>"}（claude -p 可能带解释性前文，
  // 从末行向上找第一个可解析的 JSON 对象）。⛔ 找不到 ⇒ not-evaluated，绝不默认 positive。
  const candidates = [text, ...text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).reverse()];
  for (const cand of candidates) {
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj === "object" && (obj.verdict === positive || obj.verdict === negative)) {
        return obj.verdict as P | N;
      }
    } catch {
      /* 非 JSON 行，继续向上找 */
    }
  }
  return "not-evaluated";
}
