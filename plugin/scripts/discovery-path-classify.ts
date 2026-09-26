#!/usr/bin/env node
// discovery-path-classify.ts — 「谁先发现它」的分类器与分布读数机件。
// Task: gap-who-discovered-it-first-sample-is-only-five
//
// THE QUESTION IT MAKES ASKABLE:
//   `docs/references/维度边界与结晶——从熔融实现中发现原则.md` §2.1 ① 断言「人是唯一的样本外
//   探测器」，依据是 `orchestration/FINDING-tool-crystallization-quantified-2026-08-09.md` 的
//   **n=5**（其中 3 例首揭来自人的追问）。3/5 = 0.6 这个比例，任一例换个归类就变成 2/5
//   —— 样本量支撑不起「唯一」。本机件把这条定性观察扩成**几百例的分布**，并**先量出抽取本身
//   的准确率**：一个标注准确率未知的分类器给出的占比，既不能推翻也不能支持原结论。
//
// ── 这是读数机件，不是闸 ──────────────────────────────────────────────────────────────────
//   它 exit 0 即使结论是「原结论被推翻」。它不是 checker（没有 PASS/FAIL 判词），故**不登记**
//   进 runner-static-gate.ts 的 run_static_checks；catalog 里 cadence = 按需。
//
// ── 分类口径（四类，互斥穷尽；硬规则 3b：**判不出必须有自己的取值**）───────────────────────
//   human        ①人的追问 / 裁定（人先说出这个问题）
//   loop-patrol  ②自主循环的主动巡检（管理者 / 外层 / 内层 / driver 先发现）
//   suite-gate   ③测试套件 / 闸门报红（红先于任何人注意到）
//   other        ④其它 / 判不出   ← **不是「都不是」，是「没有证据可判」**。这一类的
//                `evidenceSpan` 必须为空串，**绝不把它静默并进任一实质类**（硬规则 3b/6）。
//
// ── 判定依据只看【位置】，不看关键词出现（硬规则 2）───────────────────────────────────────
//   证据窗口 = 任务体的**触发描述段**（`## Finding` / `## Proposal` / `## Resolution` /
//   `## Requested action` / `## Setup` 中第一个出现的），**不是整篇**。理由：`## Acceptance
//   Criteria` 与 `## Definition of Done` 里经常**引用**原结论（例如「人的追问是唯一…」），
//   若扫全篇，那些引用会把任务判成 human —— 这正是硬规则 2 说的「注释里提到不算命中」。
//   无叙事段时才退回正文前 NARRATIVE_FALLBACK_CHARS 字符。
//
//   窗口内按**两级规则**判，先命中先定（`tier` 会一起报出，便于抽样复核时归因）：
//     T1 `provenance-label` —— 显式出处标签（`**来源**：` / `**触发**：` / `**投递说明**：
//        / `**证据来源**` / `**背景**（…）` …）里第一个出现的**责任主体**名词。语料里这是
//        最强的出处声明形式（10.2% 的任务体带 `**来源**：`）。标签内**先定位主体再判类**，
//        因为 `**来源**：manager 2026-08-23 架构裁定` 与 `**来源**：AC101 600s 目标（人裁定…`
//        一个是主体、一个是**引用** —— 差别在「主体名是否紧跟标签」。
//     T2 `attribution` —— 全窗口内**最早出现**的「主体 + 动作」短语（短语表见 AGENT_RULES）。
//        并列时按 AGENT_RULES 的声明次序（human 先于 suite-gate 先于 loop-patrol）。
//     都命中不到 ⇒ `other`，`evidenceSpan` 为空串。
//
// ── method 字段 ─────────────────────────────────────────────────────────────────────────
//   `method ∈ {rule, llm}`。**本次运行全部是 `rule`** —— 本机件不含任何 LLM 调用（LLM 标注
//   不可复跑、且与「抽样复核一致率」是两个不同的量）。该字段保留是为了让**将来**若引入 LLM
//   标注能与本批读数区分开，而不是一个装饰字段：`--emit-json` 会把它一起报出，报告里也必须
//   写清「本批 100% 由规则产出」。
//
// ── 用法 ─────────────────────────────────────────────────────────────────────────────────
//   node --experimental-strip-types plugin/scripts/discovery-path-classify.ts --emit-json [--root <dir>]
//   node --experimental-strip-types plugin/scripts/discovery-path-classify.ts --emit-json-detailed
//   node --experimental-strip-types plugin/scripts/discovery-path-classify.ts --sample 30 --seed 20260915
//   node --experimental-strip-types plugin/scripts/discovery-path-classify.ts --help
//
//   --emit-json            严格输出 AC1 要求的四键 `{taskId, class, method, evidenceSpan}` 数组。
//   --emit-json-detailed   四键 + `{tier, filedAt, evidenceOffset, windowChars}`（供趋势与归因）。
//   --sample <n> --seed <s>  固定种子随机抽样，打印每条的任务体触发段前 400 字符供人工复核。
//   --counts               只打印四类条数/占比 + other 占比（AC2 的 stdout 要求）。
//   --no-git               跳过立案提交上下文（离线 / hermetic 用）。
//
// Exit: 0 = 报出读数（**即使结论是「原结论被推翻」也 exit 0**）；
//       2 = usage / 环境错误（例如 tasks 目录不存在 —— 绝不当成「零个任务」）。
//
// 纪律：本机件只报数，不改任何任务体、不写任何闸。写回 `维度边界与结晶` 是**人的交付物**，
// 由任务执行者读完读数后落笔，不是脚本的副作用。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./repo-root.ts";
import { isDirectEntry, seededRng } from "./gate-script-base.ts";

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;

// ── 类与规则表（单一来源：报告里复述的任何数字/口径都从这里算）─────────────────────────────

export const CLASSES = ["human", "loop-patrol", "suite-gate", "other"] as const;
export type DiscoveryClass = (typeof CLASSES)[number];
export type Method = "rule" | "llm";

export interface AgentRule {
  /** 命中后判定的类。`other` 不出现在规则表里（它没有规则 —— 它是「没命中」）。 */
  cls: Exclude<DiscoveryClass, "other">;
  /** 规则名，报进 `--emit-json-detailed` 的 `rule` 字段，供抽样复核归因。 */
  rule: string;
  /** 主体 + 动作的短语。顺序 = 并列时的优先级（先 human，再 suite-gate，再 loop-patrol）。 */
  pattern: RegExp;
}

/** 主体名词。T1 与 T2 共用 —— 两处若各写一份，就会漂移成两个「谁算主体」的定义。 */
const SUBJECT_HUMAN = "(?:人(?:类)?|用户|human)";
const SUBJECT_SUITE = "(?:套件|suite|checker|检查器|静态检查|闸门?|gate|测试|test|criterion|判据|junit|CI|ci)";
const SUBJECT_LOOP = "(?:管理者|manager|外层|outer|内层|inner|自主循环|巡检|driver|worker|循环|本层|本轮)";

/**
 * T2 规则表。**只放「主体 + 动作」短语**，不放裸主体名词 —— 裸名词在任务体里满地都是
 * （「外层」「管理者」几乎每篇都提），单独出现不构成「谁先发现」的证据。动作词限定为
 * 揭露类动词（发现 / 指出 / 暴露 / 查出 / 实测 / 报出 / 读码 / 投立案 …）。
 *
 * **主体与动作之间必须允许一段「日期/时间」**：本语料写出处时的固定形态是
 * `主体 + 日期 + 动作`（`管理者 2026-08-13 读实现`、`manager 2026-08-14 12:2xZ 报`、
 * `人 2026-08-14 14:2xZ 裁定`）。若要求主体紧邻动词，这一整族（实测 850 条 `other` 里
 * 相当一部分）会被读成「判不出」——**假阴性，且方向恰好偏向 loop/human 两类**。
 * 故主体与动作之间允许 `[^。\n，,；;]{0,14}`：短连接语与日期都能穿过，句读打不过去。
 *
 * 单字动词（说 / 问 / 报）**单独成规则、间隔收到 ≤3** —— 单字在长间隔上会满仓假阳性。
 */
/**
 * 主体与动作之间的合法间隔：**可选的日期/时刻** + ≤6 个其它非句读字符。
 * `2026-08-24 07:0xZ`（本仓时间戳的常见形态：分钟位打码成 `0x`）必须能穿过 ——
 * `\d{0,2}` 而非 `\d{2}` 就是为此（实测：写成 `\d{2}` 时 `manager 2026-08-24 07:0xZ 定位`
 * 整族漏检，readings 落到 `other`）。
 */
const GAP = "(?:\\s*(?:20\\d\\d[-‑/.]\\d{1,2}[-‑/.]\\d{1,2}(?:[T ]\\d{1,2}:\\d{0,2}[0-9a-zA-Z]{0,4})?|\\d{1,2}:\\d{0,2}[0-9a-zA-Z]{0,4}|本轮|今天|当日|今晚|昨日|本次|此刻))?[^。\\n，,；;]{0,6}";

export const AGENT_RULES: AgentRule[] = [
  // ── ① human ───────────────────────────────────────────────────────────────────────────
  { cls: "human", rule: "human-discovery-verb", pattern: new RegExp(`${SUBJECT_HUMAN}${GAP}(?:追问|裁定|指出|发现|要求|指令|原话|提问|否决|纠正|提醒|授意|下令|定夺|暴露|明令|交办|拍板|授权)`) },
  { cls: "human", rule: "human-discovery-verb-short", pattern: new RegExp(`${SUBJECT_HUMAN}[^。\\n，,；;]{0,3}(?:说|问|报|令)`) },
  { cls: "human", rule: "human-finding-site", pattern: /人发现的现场|由人(?:的)?(?:追问|指出|发现|裁定)|人(?:亲自|直接|逐字)(?:问|指出|发现|要求)/ },
  { cls: "human", rule: "human-oid-direction", pattern: /人(?:这么|这么一)?问|人去问|人又(?:问|指出|发现)/ },

  // ── ③ suite-gate ──────────────────────────────────────────────────────────────────────
  { cls: "suite-gate", rule: "suite-red", pattern: new RegExp(`${SUBJECT_SUITE}[^。\\n]{0,12}(?:报红|判红|红|失败|拒跑|拦下|报出|exit 1|FAIL|fail)`) },
  { cls: "suite-gate", rule: "red-disclosed-by-suite", pattern: /(?:由|被)[^。\n]{0,10}(?:套件|suite|checker|检查器|闸|gate)[^。\n]{0,10}(?:发现|报出|拦下|判红|打红)/ },
  { cls: "suite-gate", rule: "red-window", pattern: /红窗(?:里|中|内|期)/ },
  // 机械 fan-in 的闸链（merge→anti-drift→typecheck→scoped→doc→suite）报红 —— 与「套件红」
  // 是**不同载体上的同一类**（同为「闸/检查先于任何人注意到」），分开写以免把闸链的
  // 单步名塞进套件规则的正则里（那会让套件规则的语义变浑）。
  { cls: "suite-gate", rule: "gate-chain-red", pattern: /(?:fan-in|typecheck|anti-drift|scoped\s*门|闸链)[^。\n]{0,20}(?:typecheck|静态|scoped|doc-check|anti-drift|门)[^。\n]{0,16}(?:红|失败|拒绝|拦|exit\s*[1-9]|退回)/ },

  // ── ② loop-patrol ─────────────────────────────────────────────────────────────────────
  { cls: "loop-patrol", rule: "loop-discovery-verb", pattern: new RegExp(`${SUBJECT_LOOP}${GAP}(?:发现|查出|实测|核实|巡检|扫描|自查|报出|暴露|指出|抓到|冒出来|投立案|立案|交办|读码|读实现|复核|独立复现|确认|定位|枚举|审计|排查|分诊|采集|观测|核对|比对|追查|复盘|度量)`) },
  { cls: "loop-patrol", rule: "loop-discovery-verb-short", pattern: new RegExp(`${SUBJECT_LOOP}${GAP}(?:报|读|量|核)`) },
  { cls: "loop-patrol", rule: "attributed-by-loop", pattern: /(?:由|被)[^。\n]{0,10}(?:管理者|外层|outer|内层|inner|manager)[^。\n]{0,10}(?:发现|报出|查出|实测|核实)/ },
  { cls: "loop-patrol", rule: "loop-attribution-paren", pattern: /(?:发现|实测|核实|查出|扫描|巡检)[（(](?:管理者|外层|outer|内层|inner|manager|driver)/ },
  { cls: "loop-patrol", rule: "loop-self-patrol", pattern: /(?:自主循环|主动巡检|本层自查|自巡查)/ },
  // **位置锚定的自主巡检**：窗口**开头**的自述量词（`**实测…**` / `**证据…**` / `实测（…）`）。
  // 语料里任务体一律由循环侧撰写 ⇒ 句首的「实测」是循环自己的动作，不是人的。放在规则表**末位**
  // 是因为它按偏移量参战（见 matchAttribution）：只有当窗口里**没有更早**的具名主体时才会生效。
  { cls: "loop-patrol", rule: "loop-opening-measurement", pattern: /^(?:\*\*|#{2,4}\s*)?(?:实测|证据|读数|诊断|分诊|核实|复现)/ },
  // 被动式：任务体是无主语的自述文本，`已定位 / 已查明 / 已复现` 的施动者恒是循环侧
  // （人不会写任务体的 method 段）。**只认这三个动词** —— `已` 后面接 `发现`/`修复`
  // 之类会命中「已被修过」这类与「谁先发现」无关的句子。
  { cls: "loop-patrol", rule: "loop-passive-located", pattern: /(?:已|被)(?:定位|查明|复现)/ },
];

/**
 * 「需要人裁定」不是「人先发现」——**否定/待办上下文必须排除**，否则任务体里每一句
 * 「⛔ 自行 superseded 需人裁定」「供人裁定」都会被读成一个 human 类证据。这是本分类器
 * 最容易犯的一类假阳性（实测：修正前 human 类里约 1/4 是这类）。
 * 判据是**位置**：命中短语的**紧邻前文**出现下表中的词 ⇒ 该命中作废（继续找下一个）。
 */
export const HUMAN_TODO_CONTEXT = /(?:需|要|供|待|等|须|若|除非|否|拒|尚未|未经|等待|留给|无|没|任何|其他|别)$/;

/** T1 显式出处标签：标签名 → 标签内容的读取窗口（字符）。 */
export const PROVENANCE_LABELS: RegExp[] = [
  /\*\*来源\*\*\s*[：:]/,
  /\*\*触发\*\*\s*[：:]/,
  /\*\*投递说明\*\*\s*[：:]/,
  /\*\*证据来源[^*]*\*\*\s*[：:]/,
  /\*\*背景[（(][^*]*\*\*\s*[：:]/,
  /\*\*背景\*\*\s*[：:]/,
  /\*\*发现[（(][^*]*\*\*\s*[：:]/,
];

/** 标签内容里判类时看的窗口长度：主体必须**紧跟标签**才算法定出处，引用（`AC101 目标（人裁定…`）不算。 */
export const PROVENANCE_WINDOW = 90;

/** 叙事段的标题（触发描述住在这里）。顺序 = 取第一个出现的。 */
export const NARRATIVE_HEADINGS = ["Finding", "Proposal", "Resolution", "Requested action", "Setup"];

/** 无叙事段时的退回窗口（字符）。 */
export const NARRATIVE_FALLBACK_CHARS = 2000;

export const METHOD_RULE: Method = "rule";

// ── 纯函数：窗口抽取 ─────────────────────────────────────────────────────────────────────

export interface EvidenceWindow {
  text: string;
  heading: string | null;
  chars: number;
}

/** 剥掉 YAML frontmatter。找不到闭合 `---` 时返回全文（缺值 = 未查，不假装剥过）。 */
export function stripFrontmatter(body: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body);
  return m ? body.slice(m[0].length) : body;
}

/** 取触发描述窗口。按位置（标题）切，不按关键词。 */
export function narrativeWindow(raw: string): EvidenceWindow {
  const body = stripFrontmatter(raw);
  const lines = body.split(/\r?\n/);
  let start = -1;
  let heading: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const h = m[1];
    if (NARRATIVE_HEADINGS.some((n) => h === n || h.startsWith(n + " ") || h.startsWith(n + "（") || h.startsWith(n + "("))) {
      start = i + 1;
      heading = h;
      break;
    }
  }
  if (start < 0) {
    return { text: body.slice(0, NARRATIVE_FALLBACK_CHARS), heading: null, chars: Math.min(body.length, NARRATIVE_FALLBACK_CHARS) };
  }
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const text = lines.slice(start, end).join("\n");
  return { text, heading, chars: text.length };
}

// ── 纯函数：分类 ─────────────────────────────────────────────────────────────────────────

export interface Verdict {
  cls: DiscoveryClass;
  method: Method;
  /** 命中的证据片段（**逐字**取自任务体）。`other` 恒为空串（AC1）。 */
  evidenceSpan: string;
  /** 判定档：T1 显式出处标签 / T2 主体+动作短语 / none。 */
  tier: "T1-provenance-label" | "T2-attribution" | "none";
  rule: string | null;
  /** 证据片段在窗口内的字符偏移。 */
  evidenceOffset: number;
}

export const OTHER_VERDICT: Verdict = {
  cls: "other",
  method: METHOD_RULE,
  evidenceSpan: "",
  tier: "none",
  rule: null,
  evidenceOffset: -1,
};

/** 命中是否落在「需人裁定 / 供人裁定」这类**否定或待办**上下文里（作废该命中）。 */
export function inTodoContext(text: string, at: number): boolean {
  return HUMAN_TODO_CONTEXT.test(text.slice(Math.max(0, at - 4), at));
}

export interface AttrHit {
  cls: Exclude<DiscoveryClass, "other">;
  rule: string;
  span: string;
  offset: number;
}

/** 在一个字符串里按 AGENT_RULES 找最早命中的主体+动作短语。并列取规则表次序。 */
export function matchAttribution(text: string): AttrHit | null {
  let best: AttrHit | null = null;
  for (const r of AGENT_RULES) {
    const re = new RegExp(r.pattern.source, r.pattern.flags.includes("g") ? r.pattern.flags : r.pattern.flags + "g");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (r.cls === "human" && inTodoContext(text, m.index)) continue;
      if (best === null || m.index < best.offset) best = { cls: r.cls, rule: r.rule, span: m[0], offset: m.index };
      break;
    }
  }
  return best;
}

/**
 * T1：显式出处标签。**从标签名本身开始找**主体（不只看 `：` 之后的内容）——
 * 语料里主体常写在标签名的括号里（`**背景（manager 实测 + outer 独立核实，…）**：`），
 * 只看 `：` 之后会把「标签名的括号里写着 manager」读成「标签内容里第一个人字是引用的」，
 * 实测造成 ac101 一类假阳性。主体的**最左**命中定类（标签第一句的主语就是它在讲谁）。
 */
export function classifyProvenanceLabel(text: string): AttrHit | null {
  for (const label of PROVENANCE_LABELS) {
    const lm = label.exec(text);
    if (!lm) continue;
    const end = lm.index + lm[0].length + PROVENANCE_WINDOW;
    let pick: AttrHit | null = null;
    let pickSubj = Number.POSITIVE_INFINITY;
    for (const [cls, subj] of [["human", SUBJECT_HUMAN], ["loop-patrol", SUBJECT_LOOP], ["suite-gate", SUBJECT_SUITE]] as const) {
      const sm = new RegExp(subj, "g").exec(text.slice(lm.index, end));
      if (!sm) continue;
      if (cls === "human" && inTodoContext(text, lm.index + sm.index)) continue;
      // ⚠️ 比较用的是**主体在串里的位置**，不是标签的位置 —— 三者共用同一个标签，
      // 若拿标签位置去比（三者恒等），后排的 human 会因「不小于」而永远赢不了。
      if (sm.index < pickSubj) {
        pickSubj = sm.index;
        pick = { cls, rule: `provenance-label:${cls}`, span: text.slice(lm.index, lm.index + sm.index + sm[0].length), offset: lm.index + sm.index };
      }
    }
    if (pick) return pick;
  }
  return null;
}

/**
 * 分类一条任务体。**纯函数**（不读盘、不跑 git）—— 立案提交上下文由调用方另行附加，
 * 分类判定本身只依赖任务体文本，这样抽样复核时可以逐条重放同一输入。
 */
export function classifyTaskBody(raw: string): Verdict {
  const win = narrativeWindow(raw);
  if (win.text.trim() === "") return { ...OTHER_VERDICT };
  // 窗口**左裁**：`## Proposal` 之后通常紧跟一个空行，不裁掉它则位置锚定的 `^` 规则
  // （loop-opening-measurement）在**每一条**任务上都恒假 —— 实测该缺陷让 5 条本可判定的
  // 任务落到 `other`。裁的是空白，不是内容，证据偏移量按裁剪后的窗口计。
  const window = win.text.replace(/^[\s>]+/, "");

  const t1 = classifyProvenanceLabel(window);
  if (t1) {
    return { cls: t1.cls, method: METHOD_RULE, evidenceSpan: t1.span, tier: "T1-provenance-label", rule: t1.rule, evidenceOffset: t1.offset };
  }
  const t2 = matchAttribution(window);
  if (t2) {
    return { cls: t2.cls, method: METHOD_RULE, evidenceSpan: t2.span, tier: "T2-attribution", rule: t2.rule, evidenceOffset: t2.offset };
  }
  const t3 = matchGenericMeasurement(window);
  if (t3) {
    return { cls: "loop-patrol", method: METHOD_RULE, evidenceSpan: t3.span, tier: "T3-generic-measurement", rule: "generic-measurement", evidenceOffset: t3.offset };
  }
  return { ...OTHER_VERDICT };
}

/**
 * T3 —— **无主语的测量自述**。任务体由循环侧撰写（人不会去写任务体的「实测」段），
 * 故窗口里出现测量动词而没有点名主体时，施动者就是循环侧。
 *
 * ⛔ 这一档**必须排在 T1/T2 之后**，不能并进 T2：`实测` 在本语料出现率极高，
 * 若按偏移量与具名规则同场竞争，`**实测（2026-08-06 03:43 SUITE-RED）**` 这类
 * 「先实测再报出套件红」的句子会被读成 loop-patrol 而它实际是套件先红。
 * 作为**兜底**档它只在「具名主体一个都没有」时才回答，方向永远是「把判不出的收进来」，
 * 不会推翻任何具名证据。
 */
export const GENERIC_MEASUREMENT = /(?:实测|实测证据|读数|逐行核|逐条核|读实现|读码|直接量|生产载体)/;

export function matchGenericMeasurement(text: string): { span: string; offset: number } | null {
  const m = GENERIC_MEASUREMENT.exec(text);
  return m ? { span: m[0], offset: m.index } : null;
}

// ── 语料枚举与立案提交上下文 ──────────────────────────────────────────────────────────────

export interface TaskRecord {
  taskId: string;
  file: string;
  verdict: Verdict;
  filedAt: string | null;
  windowChars: number;
  narrativeHeading: string | null;
}

/** 枚举真实任务体。`--glob` 默认 `gap-*.md`（AC1 字面要求）。 */
export function enumerateTasks(root: string, glob = "gap-*.md"): { taskId: string; file: string }[] {
  const dir = path.join(root, "tasks");
  if (!fs.existsSync(dir)) {
    throw new Error(`tasks/ 目录不存在：${dir}（缺值 = 未查，绝不当成「零个任务」）`);
  }
  const re = new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => ({ taskId: f.replace(/\.md$/, ""), file: path.join(dir, f) }));
}

/**
 * 立案提交时刻表：一次 `git log` 拿到所有 `tasks/*.md` 的**首次加入**提交时刻。
 * 读不出来 ⇒ 返回 `null`（**未查**），调用方必须报「立案上下文不可用」，不得当成空表
 * —— 空表会让趋势图恒为零条（硬规则 3b）。
 */
export function loadFilingTimes(root: string): Map<string, string> | null {
  const r = spawnSync("git", ["-C", root, "log", "--diff-filter=A", "--format=%x01%aI", "--name-only", "--", "tasks/"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) return null;
  const out = new Map<string, string>();
  let ts: string | null = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("")) {
      ts = line.slice(1).trim();
      continue;
    }
    const m = /^tasks\/(.+)\.md$/.exec(line.trim());
    if (m && ts) out.set(m[1], ts);
  }
  return out;
}

// ── 读数聚合 ─────────────────────────────────────────────────────────────────────────────

export interface Counts {
  total: number;
  byClass: Record<DiscoveryClass, number>;
  otherRatio: number;
  byTier: Record<string, number>;
  byMethod: Record<string, number>;
}

export function summarize(recs: TaskRecord[]): Counts {
  const byClass = { human: 0, "loop-patrol": 0, "suite-gate": 0, other: 0 } as Record<DiscoveryClass, number>;
  const byTier: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  for (const r of recs) {
    byClass[r.verdict.cls]++;
    byTier[r.verdict.tier] = (byTier[r.verdict.tier] ?? 0) + 1;
    byMethod[r.verdict.method] = (byMethod[r.verdict.method] ?? 0) + 1;
  }
  return { total: recs.length, byClass, otherRatio: recs.length ? byClass.other / recs.length : 0, byTier, byMethod };
}

/** 可分类型里的占比（`other` 是**未判**，不是一类 —— 占比只在判得出的那部分里算）。 */
export function classifiedShares(c: Counts): Record<string, number> {
  const denom = c.total - c.byClass.other;
  const out: Record<string, number> = { denominator: denom };
  for (const k of ["human", "loop-patrol", "suite-gate"] as const) out[k] = denom ? c.byClass[k] / denom : NaN;
  return out;
}

// ── 确定性抽样（种子写进文档；`Math.random` 不可复跑，故不用）──────────────────────────────

/** `makeRng` —— 本文件历史上的名字，指向**唯一实现**（gate-script-base.ts 的 `seededRng`）。
 *  保留该导出名是为了让文档里写下的 seed 仍给同一序列（同一 seed 在任何机器上逐值不变）；
 *  .quay/routine-findings.jsonl finding `seeded-prng-three-copies-two-names-reproducibility-primitive`。 */
export { seededRng as makeRng };

/** 分层随机抽样：每类按**其在语料中的占比**分配名额（余数补给最大类），类内随机。
 *  纯均匀抽样会让 suite-gate（大头）占据几乎全部样本，human 类一条都抽不到 ⇒ 一致率
 *  只反映大类的准确率。分层保证了小类也被量到。 */
export function stratifiedSample(recs: TaskRecord[], n: number, seed: number): TaskRecord[] {
  const rng = seededRng(seed);
  const groups = new Map<DiscoveryClass, TaskRecord[]>();
  for (const c of CLASSES) groups.set(c, []);
  for (const r of recs) groups.get(r.verdict.cls)!.push(r);
  const quota = new Map<DiscoveryClass, number>();
  let assigned = 0;
  for (const c of CLASSES) {
    const q = Math.floor((groups.get(c)!.length / recs.length) * n);
    quota.set(c, q);
    assigned += q;
  }
  // 余数按类大小降序补，保证总数恰为 n。
  const order = [...CLASSES].sort((a, b) => groups.get(b)!.length - groups.get(a)!.length);
  for (let i = 0; assigned < n && i < n * 4; i++) {
    const c = order[i % order.length];
    const cap = groups.get(c)!.length;
    if (quota.get(c)! < cap) {
      quota.set(c, quota.get(c)! + 1);
      assigned++;
    }
  }
  const out: TaskRecord[] = [];
  for (const c of CLASSES) {
    const pool = [...groups.get(c)!];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.push(...pool.slice(0, quota.get(c)!));
  }
  return out;
}

// ── 趋势分窗 ─────────────────────────────────────────────────────────────────────────────

export interface Window {
  label: string;
  from: string;
  to: string;
}

/** 默认两个对照窗：08-11 之前 / 之后（`docs/analysis/suite-got-5x-faster…` §7 明写 08-11 之前无遥测）。 */
export const DEFAULT_WINDOWS: Window[] = [
  { label: "pre-2026-08-11", from: "0000-00-00", to: "2026-08-11" },
  { label: "2026-08-11..now", from: "2026-08-11", to: "9999-99-99" },
];

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export interface TrendRow {
  group: string;
  total: number;
  byClass: Record<DiscoveryClass, number>;
  /** 判得出的部分里 human 的占比（`other` 不计入分母）。 */
  humanShareClassified: number;
  /** **上界**：把该组全部 `other` 都算成 human 时 human 的占比。它给出「即便未知的全是人，
   *  也到不了的占比」——这是本任务对原结论最不依赖分类器准确率的那条论证。 */
  humanShareUpperBound: number;
}

export function trendBy(recs: TaskRecord[], key: (r: TaskRecord) => string | null): TrendRow[] {
  const groups = new Map<string, TaskRecord[]>();
  for (const r of recs) {
    const k = key(r);
    if (k === null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.keys()].sort().map((g) => {
    const rs = groups.get(g)!;
    const byClass = { human: 0, "loop-patrol": 0, "suite-gate": 0, other: 0 } as Record<DiscoveryClass, number>;
    for (const r of rs) byClass[r.verdict.cls]++;
    const classified = rs.length - byClass.other;
    return {
      group: g,
      total: rs.length,
      byClass,
      humanShareClassified: classified ? byClass.human / classified : NaN,
      humanShareUpperBound: rs.length ? (byClass.human + byClass.other) / rs.length : NaN,
    };
  });
}

export function renderTrend(rows: TrendRow[]): string {
  const pct = (x: number) => (Number.isNaN(x) ? "  n/a" : (x * 100).toFixed(1) + "%");
  const lines = [
    `${"分组".padEnd(14)}${"n".padStart(6)}${"human".padStart(8)}${"loop".padStart(8)}${"suite".padStart(8)}${"other".padStart(8)}   ${"human/判得出".padStart(14)}  ${"human上界".padStart(11)}`,
  ];
  for (const r of rows) {
    lines.push(
      `${r.group.padEnd(14)}${String(r.total).padStart(6)}${String(r.byClass.human).padStart(8)}${String(r.byClass["loop-patrol"]).padStart(8)}` +
        `${String(r.byClass["suite-gate"]).padStart(8)}${String(r.byClass.other).padStart(8)}   ${pct(r.humanShareClassified).padStart(14)}  ${pct(r.humanShareUpperBound).padStart(11)}`,
    );
  }
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────

interface Args {
  emitJson: boolean;
  emitJsonDetailed: boolean;
  counts: boolean;
  trend: boolean;
  sample: number;
  seed: number;
  root: string;
  glob: string;
  noGit: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    emitJson: false,
    emitJsonDetailed: false,
    counts: false,
    trend: false,
    sample: 0,
    seed: 20260915,
    root: repoRoot(),
    glob: "gap-*.md",
    noGit: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--emit-json") a.emitJson = true;
    else if (v === "--emit-json-detailed") a.emitJsonDetailed = true;
    else if (v === "--counts") a.counts = true;
    else if (v === "--trend") a.trend = true;
    else if (v === "--sample") a.sample = Number(argv[++i] ?? "0");
    else if (v === "--seed") a.seed = Number(argv[++i] ?? "0");
    else if (v === "--root") a.root = argv[++i] ?? a.root;
    else if (v === "--glob") a.glob = argv[++i] ?? a.glob;
    else if (v === "--no-git") a.noGit = true;
    else if (v === "--help" || v === "-h") a.help = true;
    else throw new Error(`未知参数：${v}`);
  }
  return a;
}

const HELP = `用法: node --experimental-strip-types plugin/scripts/discovery-path-classify.ts [选项]

  --emit-json            输出 AC1 四键数组 {taskId, class, method, evidenceSpan}
  --emit-json-detailed   四键 + {tier, rule, filedAt, evidenceOffset, windowChars}
  --counts               只打印四类条数/占比 + other 占比
  --trend                另打印按月分组与按 08-11 前后两窗分组的四类占比（读立案提交时刻）
  --sample <n>           固定种子分层抽样 n 条并打印证据窗口（人工复核用）
  --seed <s>             抽样种子（默认 20260915；写进报告，可复跑）
  --root <dir>           仓库根（默认 repoRoot()）
  --glob <pat>           任务体 glob（默认 gap-*.md）
  --no-git               跳过立案提交上下文（离线/hermetic）
  --help                 本帮助

分类口径: human | loop-patrol | suite-gate | other（other = 判不出，evidenceSpan 为空串）
方法: method 恒为 rule（本机件不含 LLM 调用）`;

export function main(argv: string[]): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return EXIT_USAGE;
  }
  if (args.help) {
    process.stdout.write(HELP + "\n");
    return EXIT_OK;
  }
  let files: { taskId: string; file: string }[];
  try {
    files = enumerateTasks(args.root, args.glob);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return EXIT_USAGE;
  }
  const filing = args.noGit ? null : loadFilingTimes(args.root);
  const recs: TaskRecord[] = files.map((f) => {
    const raw = fs.readFileSync(f.file, "utf8");
    const win = narrativeWindow(raw);
    return {
      taskId: f.taskId,
      file: f.file,
      verdict: classifyTaskBody(raw),
      filedAt: filing?.get(f.taskId) ?? null,
      windowChars: win.chars,
      narrativeHeading: win.heading,
    };
  });
  const counts = summarize(recs);
  const shares = classifiedShares(counts);

  if (args.emitJson) {
    process.stdout.write(
      JSON.stringify(recs.map((r) => ({ taskId: r.taskId, class: r.verdict.cls, method: r.verdict.method, evidenceSpan: r.verdict.evidenceSpan })), null, 0) + "\n",
    );
    return EXIT_OK;
  }
  if (args.emitJsonDetailed) {
    process.stdout.write(
      JSON.stringify(
        recs.map((r) => ({
          taskId: r.taskId,
          class: r.verdict.cls,
          method: r.verdict.method,
          evidenceSpan: r.verdict.evidenceSpan,
          tier: r.verdict.tier,
          rule: r.verdict.rule,
          filedAt: r.filedAt,
          evidenceOffset: r.verdict.evidenceOffset,
          windowChars: r.windowChars,
          narrativeHeading: r.narrativeHeading,
        })),
        null,
        0,
      ) + "\n",
    );
    return EXIT_OK;
  }
  if (args.sample > 0) {
    const picked = stratifiedSample(recs, Math.min(args.sample, recs.length), args.seed);
    process.stdout.write(`# 分层随机抽样 n=${picked.length} seed=${args.seed}\n`);
    for (const r of picked) {
      const raw = fs.readFileSync(r.file, "utf8");
      const win = narrativeWindow(raw);
      const excerpt = win.text.replace(/\s+/g, " ").trim().slice(0, 400);
      process.stdout.write(
        `\n=== ${r.taskId}\n  脚本判定: ${r.verdict.cls}  (tier=${r.verdict.tier} rule=${r.verdict.rule ?? "-"})\n` +
          `  evidenceSpan: ${r.verdict.evidenceSpan || "(空)"}\n` +
          `  立案: ${r.filedAt ?? "(未查)"}\n` +
          `  窗口(${r.narrativeHeading ?? "无叙事段"}, ${win.chars} 字符): ${excerpt}\n`,
      );
    }
    return EXIT_OK;
  }

  // 默认 / --counts：条数与占比。
  const pct = (x: number) => (x * 100).toFixed(1) + "%";
  process.stdout.write(`语料: ${args.root}/tasks/${args.glob}  n=${counts.total}\n`);
  for (const c of CLASSES) {
    process.stdout.write(`  ${c.padEnd(12)} ${String(counts.byClass[c]).padStart(5)}  ${pct(counts.byClass[c] / (counts.total || 1))}\n`);
  }
  process.stdout.write(`  other 占比   ${pct(counts.otherRatio)}\n`);
  process.stdout.write(`判得出的部分 (n=${shares.denominator}): human ${pct(shares.human)} / loop-patrol ${pct(shares["loop-patrol"])} / suite-gate ${pct(shares["suite-gate"])}\n`);
  process.stdout.write(`判定档: ${JSON.stringify(counts.byTier)}\n`);
  process.stdout.write(`method: ${JSON.stringify(counts.byMethod)}\n`);
  if (filing === null && !args.noGit) process.stdout.write(`⚠️ 立案提交上下文【未查】（git log 失败）—— 趋势读数不可用，不当作空表\n`);
  if (args.trend) {
    if (filing === null) {
      // 硬规则 6/3b：缺值 = 未查。⛔ 不打印一张全零的趋势表假装「趋势查过了」。
      process.stdout.write(`趋势：NOT-EVALUATED —— 立案提交时刻不可得（git log 失败或被 --no-git 关闭）\n`);
    } else {
      const unplaced = recs.filter((r) => r.filedAt === null).length;
      process.stdout.write(`\n—— 按立案月份 ——\n${renderTrend(trendBy(recs, (r) => (r.filedAt ? monthOf(r.filedAt) : null)))}\n`);
      process.stdout.write(
        `\n—— 按 08-11 前后两窗 ——\n${renderTrend(
          trendBy(recs, (r) => {
            if (!r.filedAt) return null;
            const d = r.filedAt.slice(0, 10);
            for (const w of DEFAULT_WINDOWS) if (d >= w.from && d < w.to) return w.label;
            return null;
          }),
        )}\n`,
      );
      if (unplaced > 0) process.stdout.write(`⚠️ ${unplaced} 条任务无立案提交时刻（未加入任何分组，未当作任何类）\n`);
    }
  }
  return EXIT_OK;
}

// 直接入口守卫：用 canonical isDirectEntry（按 basename 判，bundler-friendly —— 见 gate-script-base.ts）。
if (isDirectEntry(import.meta, process.argv[1], "discovery-path-classify")) {
  process.exit(main(process.argv.slice(2)));
}
