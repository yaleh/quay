#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/enum-surface-parity-check.ts
import fs from "node:fs";
import path2 from "node:path";

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function parseArgs(argv, spec) {
  const result = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};
  const unknownMode = spec.unknown ?? (spec.strict ? "reject" : "accept");
  const scriptName = path.basename(argv[1] || "script");
  if (raw.includes("--help") || raw.includes("-h")) {
    if (spec.help === "return") {
      result.help = true;
      return result;
    }
    helpExit(`usage: ${scriptName} ${spec.usage}`);
  }
  const usageError = (message) => {
    if (spec.errors === "return") {
      result.error = message;
      return result;
    }
    console.error(message);
    process.exit(2);
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      const name = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
      const def = flagDefs[name];
      if (!def && unknownMode === "reject") return usageError(`unknown argument: --${name}`);
      if (!def && unknownMode === "skip") continue;
      if (def?.type === "boolean") {
        result.flags[name] = true;
      } else if (def?.type === "string[]") {
        if (!result.lists) result.lists = {};
        const list = result.lists[name] ??= [];
        if (eqIdx >= 0) list.push(a.slice(eqIdx + 1));
        else if (def.greedy) {
          while (i + 1 < raw.length && !raw[i + 1].startsWith("--")) list.push(raw[++i]);
        } else if (i + 1 < raw.length) list.push(raw[++i]);
      } else if (eqIdx >= 0) {
        result.flags[name] = a.slice(eqIdx + 1);
      } else if (i + 1 < raw.length) {
        result.flags[name] = raw[++i];
      } else {
        result.flags[name] = "";
      }
    } else {
      result.args.push(a);
    }
  }
  const minArgs = spec.minArgs ?? 1;
  if (result.args.length < minArgs) {
    return usageError(`Usage: ${scriptName} ${spec.usage}`);
  }
  return result;
}
var VERDICT_EXIT_CODE = {
  pass: 0,
  fail: 1,
  "not-evaluated": 3
};
function verdictExitCode(status) {
  return VERDICT_EXIT_CODE[status];
}
function emitVerdict(verdict, opts = {}) {
  const { json = false, stream = "stdout" } = opts;
  const out = stream === "stderr" ? process.stderr : process.stdout;
  if (json) {
    const detail = verdict.detail;
    const base = detail !== null && typeof detail === "object" && !Array.isArray(detail) ? { ...detail } : detail === void 0 ? {} : { detail };
    base.status = verdict.status;
    base.ok = verdict.status === "pass";
    base.message = verdict.message;
    out.write(JSON.stringify(base) + "\n");
  } else {
    const prefix = verdict.status === "pass" ? "PASS" : verdict.status === "fail" ? "FAIL" : "NOT-EVALUATED";
    out.write(`${prefix}: ${verdict.message}
`);
  }
  return verdictExitCode(verdict.status);
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/checker-lib.ts
var REGEX_PRECURSOR_KEYWORDS = /* @__PURE__ */ new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await"
]);
function isRegexStart(prevCode, src, i) {
  if (prevCode === "") return true;
  if (/\s/.test(prevCode)) return true;
  if ((prevCode === "+" || prevCode === "-") && src[i - 2] === prevCode) return false;
  if (/[A-Za-z0-9_$]/.test(prevCode)) {
    const m = src.slice(0, i).match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
    return m ? REGEX_PRECURSOR_KEYWORDS.has(m[1]) : false;
  }
  if (prevCode === ")" || prevCode === "]" || prevCode === '"' || prevCode === "'" || prevCode === "`") return false;
  return true;
}
function buildNonCodeMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  let prevCode = "";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      while (i < n && src[i] !== "\n") {
        mask[i] = 1;
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        mask[i] = 1;
        i++;
      }
      if (i < n) {
        mask[i] = 1;
        mask[i + 1] = 1;
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      mask[i] = 1;
      i++;
      while (i < n) {
        mask[i] = 1;
        if (src[i] === "\\") {
          if (i + 1 < n) {
            mask[i + 1] = 1;
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      prevCode = q;
      continue;
    }
    if (c === "/" && isRegexStart(prevCode, src, i)) {
      mask[i] = 1;
      i++;
      let inClass = false;
      while (i < n) {
        mask[i] = 1;
        const cc = src[i];
        if (cc === "\\") {
          if (i + 1 < n) {
            mask[i + 1] = 1;
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (cc === "[") inClass = true;
        else if (cc === "]") inClass = false;
        else if (cc === "/" && !inClass) {
          i++;
          break;
        } else if (cc === "\n") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    prevCode = c;
    i++;
  }
  return mask;
}

// packages/quay/src/kernel/regex-escape.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/enum-surface-parity-check.ts
var AUTHORITIES = [
  // ⛔ 真源判定（DoD「先定真源」）：driver kind 的权威**不是** cli/driver.ts 的 KINDS（那是消费者侧的
  // 白名单副本），而是 kernel 的那张数据表 —— respawn 循环、pid/控制态、carrier、per-kind 动词全部由
  // `DRIVER_KINDS` 驱动，新增一个 kind 的第一处永远是它（driver-runtime.ts 的头注释逐字如此规定）。
  { id: "driver-kind", file: "plugin/scripts/driver-runtime.ts", symbol: "DRIVER_KINDS", extract: "ts-object-keys" },
  // CLI 的 verb 词表已移入零依赖叶模块 driver-vocab.ts（gap-driver-cli-help-hides-four-of-six-kinds）
  // —— help.ts 被 bin/quay.ts 静态 import，把词表留在 cli/driver.ts 会让每次 CLI 调用多付 0.4s
  // （该文件的传递闭包带 config.ts/plugin-root.ts）。权威位置随词表移动，⛔ 不是新增一个来源。
  { id: "driver-verb", file: "packages/quay/src/driver-vocab.ts", symbol: "VERBS", extract: "ts-array" },
  { id: "goal-status", file: "packages/quay/src/core/types.ts", symbol: "GOAL_STATUSES", extract: "ts-array" },
  { id: "meta-status", file: "packages/quay/src/core/types.ts", symbol: "META_STATUSES", extract: "ts-array" },
  { id: "task-status", file: "packages/quay/src/core/types.ts", symbol: "TASK_STATUSES", extract: "ts-array" },
  { id: "adr-status", file: "packages/quay/src/core/adr-store.ts", symbol: "VALID_ADR_STATUSES", extract: "ts-array" },
  { id: "doc-status", file: "packages/quay/src/core/document-store.ts", symbol: "VALID_DOCUMENT_STATUSES", extract: "ts-array" }
];
var SURFACES = [
  // ── driver kind（6 值）──────────────────────────────────────────────────────────────────────────
  { id: "cli-driver-kinds", authority: "driver-kind", file: "packages/quay/src/driver-vocab.ts", extract: "ts-array", symbol: "KINDS", policy: "exact" },
  { id: "driver-config-union", authority: "driver-kind", file: "plugin/scripts/driver-config.ts", extract: "ts-string-union", anchor: "kind:\\s*", policy: "exact" },
  { id: "web-driver-kinds", authority: "driver-kind", file: "packages/quay/src/serve-sessions.ts", extract: "ts-array", symbol: "WEB_DRIVER_KINDS", policy: "subset" },
  { id: "start-drivers-kinds", authority: "driver-kind", file: "plugin/scripts/start-drivers.ts", extract: "ts-array", symbol: "DRIVER_KINDS", policy: "exact" },
  // cli/driver.ts 与 cli/help.ts 的 kind 帮助文本：**运行时派生**自 driver-vocab.ts:KINDS
  // （Core ⛔ 不能静态 import plugin/ 的 kernel —— 见 SurfaceSpec.derivesFrom 的注释）。
  {
    id: "cli-driver-help-kind",
    authority: "driver-kind",
    file: "packages/quay/src/cli/driver.ts",
    extract: "text",
    anchor: "--kind <([a-z-]+\\|[a-z|-]+)>",
    policy: "exact",
    derivesFrom: { file: "packages/quay/src/driver-vocab.ts", symbol: "KINDS", extract: "ts-array", spelling: "--kind <\\$\\{[^}]*\\bKINDS\\b[^}]*\\}>" }
  },
  {
    id: "cli-help-kind",
    authority: "driver-kind",
    file: "packages/quay/src/cli/help.ts",
    extract: "text",
    anchor: "--kind <([a-z-]+\\|[a-z|-]+)>",
    policy: "exact",
    derivesFrom: { file: "packages/quay/src/driver-vocab.ts", symbol: "KINDS", extract: "ts-array", spelling: "--kind <\\$\\{[^}]*\\bKINDS\\b[^}]*\\}>" }
  },
  { id: "driver-runtime-help-kind", authority: "driver-kind", file: "plugin/scripts/driver-runtime.ts", extract: "text", anchor: "--kind <([a-z-]+\\|[a-z|-]+)>", policy: "exact" },
  { id: "claude-md-driver-kind", authority: "driver-kind", file: "CLAUDE.md", extract: "text", anchor: "--kind <([a-z-]+\\|[a-z|-]+)>", policy: "exact" },
  { id: "drivers-skill-kind", authority: "driver-kind", file: "plugin/skills/drivers/SKILL.md", extract: "text", anchor: "--kind ([a-z-]+\\|[a-z|-]+)", policy: "exact" },
  // ── driver verb（6 值）──────────────────────────────────────────────────────────────────────────
  { id: "web-driver-verbs", authority: "driver-verb", file: "packages/quay/src/serve-sessions.ts", extract: "ts-array", symbol: "WEB_DRIVER_VERBS", policy: "subset" },
  // 同上：verb 帮助文本运行时派生自 driver-vocab.ts:VERBS。
  {
    id: "cli-help-driver-usage-verbs",
    authority: "driver-verb",
    file: "packages/quay/src/cli/help.ts",
    extract: "text",
    anchor: "quay driver <([a-z|]+)>",
    policy: "exact",
    derivesFrom: { file: "packages/quay/src/driver-vocab.ts", symbol: "VERBS", extract: "ts-array", spelling: "quay driver <\\$\\{[^}]*\\bVERBS\\b[^}]*\\}>" }
  },
  {
    id: "cli-driver-usage-verbs",
    authority: "driver-verb",
    file: "packages/quay/src/cli/driver.ts",
    extract: "text",
    anchor: "quay driver <([a-z|]+)>",
    policy: "exact",
    derivesFrom: { file: "packages/quay/src/driver-vocab.ts", symbol: "VERBS", extract: "ts-array", spelling: "quay driver <\\$\\{[^}]*\\bVERBS\\b[^}]*\\}>" }
  },
  // ── goal status ────────────────────────────────────────────────────────────────────────────────
  { id: "goal-store-valid-statuses", authority: "goal-status", file: "packages/quay/src/core/goal-store.ts", extract: "ts-array", symbol: "VALID_GOAL_STATUSES", policy: "exact" },
  // Core 的两个 goal_* 工具描述。⚠️ 它们是【后加的】表层（goal_* 家族 2026-10-03 才在 Core 重新
  // 暴露，见 mcp-handlers.ts 该处注释），比本登记表还新 ⇒ 上一轮枚举任务没看见它们，而 --discover
  // 只找【数组/字符串联合字面量】，看不见 `a|b|c` 形态的 text 面 ⇒ 两条漂移既未登记、也未被发现
  // （硬规则 5：在某来源搜不到 ≠ 不存在；本任务的 5b 扫描才发现）。现已补齐登记。
  { id: "core-goal-list-desc", authority: "goal-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "goal\u2192AC lifecycle: ([a-z|-]+)", policy: "exact" },
  { id: "core-goal-write-desc", authority: "goal-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "one goal record[^\\n]*?status \u2208 ([a-z|-]+)", policy: "exact" },
  { id: "native-goal-write-desc", authority: "goal-status", file: "packages/quay-native/src/mcp-server.ts", extract: "text", anchor: "one goal record[^\\n]*?status \u2208 ([a-z|-]+)", policy: "exact" },
  { id: "serve-goal-status-order", authority: "goal-status", file: "packages/quay/src/serve-goal.ts", extract: "ts-array", symbol: "GOAL_STATUS_ORDER", policy: "exact" },
  // anchor 是本数组字面量的头两个元素（该数组就地写在 JSX 里，没有 symbol 可锚）。本任务把
  // needs-human 插在 draft 之后 ⇒ 头部两个元素随之改变，anchor 同步重锚（锚不匹配 ⇒
  // `matched 0 times` ⇒ NOT-EVALUATED，是响的失败，⛔ 不是静默放行）。
  { id: "serve-goal-status-tabs", authority: "goal-status", file: "packages/quay/src/serve-goal.ts", extract: "ts-array", anchor: '\\["draft",\\s*"needs-human"', policy: "exact" },
  // ── meta status ────────────────────────────────────────────────────────────────────────────────
  { id: "meta-store-valid-statuses", authority: "meta-status", file: "packages/quay/src/meta-store.ts", extract: "ts-array", symbol: "VALID_META_STATUSES", policy: "exact" },
  { id: "core-meta-write-desc", authority: "meta-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "META record[^\\n]*?status \u2208 ([a-z|-]+)", policy: "exact" },
  { id: "native-meta-write-desc", authority: "meta-status", file: "packages/quay-native/src/mcp-server.ts", extract: "text", anchor: "META record[^\\n]*?status \u2208 ([a-z|-]+)", policy: "exact" },
  // ── adr status ─────────────────────────────────────────────────────────────────────────────────
  { id: "core-adr-write-desc", authority: "adr-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "one ADR[^\\n]*?status \u2208 ([a-z|-]+)", policy: "exact" },
  { id: "native-adr-write-desc", authority: "adr-status", file: "packages/quay-native/src/mcp-server.ts", extract: "text", anchor: "one ADR[^\\n]*?status \u2208 ([a-z|-]+)", policy: "exact" },
  // ── task status ────────────────────────────────────────────────────────────────────────────────
  { id: "plugin-task-statuses", authority: "task-status", file: "plugin/scripts/task-status.ts", extract: "ts-array", symbol: "TASK_STATUSES", policy: "exact" },
  { id: "cli-help-task-status-filter", authority: "task-status", file: "packages/quay/src/cli/help.ts", extract: "text", anchor: "--status <status>[^\\n]*\\(([^)]*)\\)", policy: "exact" },
  { id: "core-task-list-desc", authority: "task-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "Filter by task status[^\\n]*?\\(([^)]*)\\)", policy: "exact" },
  { id: "core-task-write-desc", authority: "task-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "New status \\(([^)]*)\\)", policy: "exact" }
  // ── doc status：**已枚举、未发现任何表层的副本**（下文 --discover 段同样为空）⇒ 无面登记。 ──
];
var KNOWN_DRIFT = [
  {
    surface: "start-drivers-kinds",
    extra: [],
    missing: ["quality", "meta"],
    reason: "plugin/scripts/start-drivers.ts \u53EA\u62C9\u8D77 4 \u4E2A kind\uFF1B\u5F52\u4F4D\uFF08\u662F\u5426\u8865\u9F50 6 \u4E2A\uFF09\u5F85\u53E6\u884C\u7ACB\u6848\u2014\u2014\u672C\u4EFB\u52A1\u7684\u8303\u56F4\u662F\u673A\u5236\uFF0C\u4E0D\u662F\u8BE5\u811A\u672C\u7684\u8BED\u4E49\u51B3\u7B56\u3002"
  },
  {
    surface: "claude-md-driver-kind",
    extra: [],
    missing: ["outer", "quality", "meta", "goal"],
    reason: "\u6587\u6863\u9762\uFF08CLAUDE.md\uFF09\u5B58\u91CF\u5F52\u4F4D\u4E0D\u5728\u672C\u4EFB\u52A1\u5185\uFF08task body \u8303\u56F4\u8FB9\u754C\uFF09\uFF1B\u672C\u4EFB\u52A1\u53EA\u8D1F\u8D23\u62A5\u51FA\u3002"
  },
  {
    surface: "drivers-skill-kind",
    extra: [],
    missing: ["outer", "quality", "meta", "goal"],
    reason: "\u6587\u6863\u9762\uFF08plugin/skills/drivers/SKILL.md\uFF09\u5B58\u91CF\u5F52\u4F4D\u4E0D\u5728\u672C\u4EFB\u52A1\u5185\uFF1B\u672C\u4EFB\u52A1\u53EA\u8D1F\u8D23\u62A5\u51FA\u3002"
  }
];
var DEFAULT_REGISTRY = {
  authorities: AUTHORITIES,
  surfaces: SURFACES,
  knownDrift: KNOWN_DRIFT
};
function tokenize(raw) {
  return raw.split(/[|,/\s]+/).map((t) => t.trim().replace(/^[`'"<([{]+/, "").replace(/[`'">)\]},.;]+$/, "")).filter((t) => /^[a-z][a-z0-9-]*$/.test(t));
}
function stringLiteralsIn(src, start, end) {
  const out = [];
  const re = /"([^"\\]*)"|'([^'\\]*)'/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index >= end) break;
    out.push((m[1] ?? m[2] ?? "").trim());
  }
  return out.filter((s) => s !== "");
}
function initialiserSpan(src, openIdx, open, close) {
  const mask = buildNonCodeMask(src);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (mask[i] === 1) continue;
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function firstCodeChar(src, from, ch) {
  const mask = buildNonCodeMask(src);
  for (let i = from; i < src.length; i++) {
    if (mask[i] === 1) continue;
    if (src[i] === ch) return i;
  }
  return -1;
}
function extractTsArray(src, spec) {
  let openIdx = -1;
  if (spec.symbol) {
    const decl = new RegExp(`(?:export\\s+)?const\\s+${spec.symbol}\\b`);
    const m = decl.exec(src);
    if (!m) return { ok: false, groups: [], reason: `declaration of \`${spec.symbol}\` not found` };
    const eq = firstCodeChar(src, m.index + m[0].length, "=");
    if (eq < 0) return { ok: false, groups: [], reason: `\`${spec.symbol}\` has no initialiser` };
    openIdx = firstCodeChar(src, eq, "[");
    if (openIdx < 0) return { ok: false, groups: [], reason: `\`${spec.symbol}\` initialiser is not an array literal` };
  } else if (spec.anchor) {
    const m = new RegExp(spec.anchor).exec(src);
    if (!m) return { ok: false, groups: [], reason: `anchor /${spec.anchor}/ matched 0 times` };
    openIdx = m.index + m[0].indexOf("[");
    if (openIdx < 0 || src[openIdx] !== "[") return { ok: false, groups: [], reason: `anchor /${spec.anchor}/ did not land on a [ literal` };
  } else {
    return { ok: false, groups: [], reason: "ts-array needs a symbol or an anchor" };
  }
  const end = initialiserSpan(src, openIdx, "[", "]");
  if (end < 0) return { ok: false, groups: [], reason: "unbalanced array literal" };
  return { ok: true, groups: [{ index: 0, values: stringLiteralsIn(src, openIdx, end) }], reason: null };
}
function extractTsObjectKeys(src, symbol) {
  const decl = new RegExp(`(?:export\\s+)?const\\s+${symbol}\\b`);
  const m = decl.exec(src);
  if (!m) return { ok: false, groups: [], reason: `declaration of \`${symbol}\` not found` };
  const eq = firstCodeChar(src, m.index + m[0].length, "=");
  if (eq < 0) return { ok: false, groups: [], reason: `\`${symbol}\` has no initialiser` };
  const openIdx = firstCodeChar(src, eq, "{");
  if (openIdx < 0) return { ok: false, groups: [], reason: `\`${symbol}\` initialiser is not an object literal` };
  const end = initialiserSpan(src, openIdx, "{", "}");
  if (end < 0) return { ok: false, groups: [], reason: "unbalanced object literal" };
  const mask = buildNonCodeMask(src);
  const body = src.slice(openIdx + 1, end);
  const bodyMask = mask.slice(openIdx + 1, end);
  const keys = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (bodyMask[i] === 1) continue;
    const c = body[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (depth === 0) {
      const km = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i));
      if (km) {
        keys.push(km[1]);
        i += km[0].length - 1;
      }
    }
  }
  return { ok: true, groups: [{ index: 0, values: keys }], reason: null };
}
function extractTsStringUnion(src, anchor) {
  const m = new RegExp(anchor).exec(src);
  if (!m) return { ok: false, groups: [], reason: `anchor /${anchor}/ matched 0 times` };
  const from = m.index + m[0].length;
  let to = from;
  while (to < src.length && !/[;)\n]/.test(src[to])) to++;
  const values = stringLiteralsIn(src, from, to);
  if (values.length === 0) return { ok: false, groups: [], reason: `anchor /${anchor}/ matched but no string literals followed` };
  return { ok: true, groups: [{ index: 0, values }], reason: null };
}
function extractText(src, spec) {
  const re = new RegExp(spec.anchor, "g");
  const groups = [];
  let m;
  let i = 0;
  while ((m = re.exec(src)) !== null) {
    if (spec.indices === void 0 || spec.indices.includes(i)) {
      groups.push({ index: i, values: [...new Set(tokenize(m[1] ?? ""))] });
    }
    i++;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (groups.length === 0) {
    return { ok: false, groups: [], reason: `anchor /${spec.anchor}/ matched 0 times` };
  }
  return { ok: true, groups, reason: null };
}
function extract(src, kind, spec) {
  switch (kind) {
    case "ts-array":
      return extractTsArray(src, spec);
    case "ts-object-keys":
      return spec.symbol ? extractTsObjectKeys(src, spec.symbol) : { ok: false, groups: [], reason: "ts-object-keys needs a symbol" };
    case "ts-string-union":
      return spec.anchor ? extractTsStringUnion(src, spec.anchor) : { ok: false, groups: [], reason: "ts-string-union needs an anchor" };
    case "text":
      return spec.anchor ? extractText(src, { anchor: spec.anchor, indices: spec.indices }) : { ok: false, groups: [], reason: "text needs an anchor" };
    default:
      return { ok: false, groups: [], reason: `unknown extract kind ${String(kind)}` };
  }
}
function scanExemptions(src) {
  const out = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /enum-surface-exempt:\s*([A-Za-z0-9._:-]+)\s*[—:-]?\s*(.*)$/.exec(lines[i]);
    if (m) out.push({ surface: m[1].trim(), reason: m[2].trim(), line: i + 1 });
  }
  return out;
}
var MIN_EXEMPT_REASON_CHARS = 12;
function findExemption(markers, surfaceId) {
  return markers.find((m) => m.surface === surfaceId && m.reason.length >= MIN_EXEMPT_REASON_CHARS) ?? null;
}
function diff(values, authority) {
  const v = new Set(values);
  const a = new Set(authority);
  return {
    extra: [...v].filter((x) => !a.has(x)).sort(),
    missing: [...a].filter((x) => !v.has(x)).sort()
  };
}
function readText(root, rel) {
  try {
    return { ok: true, text: fs.readFileSync(path2.join(root, rel), "utf8"), reason: null };
  } catch (e) {
    const code = e.code;
    return { ok: false, text: "", reason: code === "ENOENT" ? `${rel}: file not found` : `${rel}: ${code ?? "unreadable"}` };
  }
}
function authorityDerivation(read, authorityFile, authoritySymbol) {
  if (!read.ok || !authoritySymbol) return null;
  const base = path2.basename(authorityFile).replace(/\.(ts|js)$/, "");
  const importRe = new RegExp(`^\\s*import[^;\\n]*\\b${authoritySymbol}\\b[^;\\n]*from\\s*["'][^"']*\\b${base}(?:\\.(?:ts|js|mjs))?["']`, "m");
  if (!importRe.test(read.text)) return null;
  const mask = buildNonCodeMask(read.text);
  const symRe = new RegExp(`\\b${authoritySymbol}\\b`, "g");
  let m;
  while ((m = symRe.exec(read.text)) !== null) {
    if (mask[m.index] === 0) return `${authorityFile}:${authoritySymbol}`;
  }
  return null;
}
function verifyDeclaredDerivation(root, read, spec, authority, declaredSurfaceFile) {
  const d = spec.derivesFrom;
  const bad = (note) => ({ state: "not-evaluated", note, extra: [], missing: [] });
  let spellingRe;
  try {
    spellingRe = new RegExp(d.spelling);
  } catch (e) {
    return bad(`derivesFrom.spelling is not a valid regex: ${e.message}`);
  }
  if (!spellingRe.test(read.text)) {
    return bad(
      `declared derivation from ${d.file}:${d.symbol} but the derived spelling /${d.spelling}/ is absent (\u5E2E\u52A9\u6587\u672C\u88AB\u5220\u6216\u88AB\u624B\u6284\u56DE\u5B57\u9762\u91CF)`
    );
  }
  if (path2.basename(declaredSurfaceFile) !== path2.basename(d.file)) {
    const base = path2.basename(d.file).replace(/\.(ts|js|mjs)$/, "");
    const importRe = new RegExp(
      `^\\s*(?:import|export)[^;\\n]*\\b${escapeRegExp(d.symbol)}\\b[^;\\n]*from\\s*["'][^"']*\\b${escapeRegExp(base)}(?:\\.(?:ts|js|mjs))?["']`,
      "m"
    );
    if (!importRe.test(read.text)) {
      return bad(
        `declared derivation from ${d.file}:${d.symbol} but ${declaredSurfaceFile} has no \`import \u2026${d.symbol}\u2026 from "\u2026${base}"\` (\u6D3E\u751F\u6E90\u672A\u63A5\u7EBF)`
      );
    }
  }
  const src = readText(root, d.file);
  if (!src.ok) return bad(`derivesFrom source ${d.file}: ${src.reason}`);
  const srcEx = extract(src.text, d.extract, { symbol: d.symbol });
  if (!srcEx.ok) return bad(`derivesFrom source ${d.file}:${d.symbol}: ${srcEx.reason}`);
  const srcValues = srcEx.groups[0]?.values ?? [];
  if (srcValues.length === 0) {
    return bad(`derivesFrom source ${d.file}:${d.symbol} extracted 0 values`);
  }
  const dd = diff(srcValues, authority);
  if (dd.extra.length > 0 || dd.missing.length > 0) {
    return {
      state: "violation",
      note: `\u6D3E\u751F\u6E90 ${d.file}:${d.symbol} \u4E0E\u6743\u5A01\u4E0D\u4E00\u81F4\uFF08\u65AD\u94FE\uFF09`,
      extra: dd.extra,
      missing: dd.missing
    };
  }
  return { state: "derived", note: `\u6D3E\u751F\u81EA ${d.file}:${d.symbol}\uFF08\u5DF2\u4E0E\u6743\u5A01\u9010\u4E00\u6BD4\u5BF9\uFF09`, extra: [], missing: [] };
}
function runCheck(opts) {
  const { root, registry } = opts;
  const authorities = [];
  const authorityValues = /* @__PURE__ */ new Map();
  for (const a of registry.authorities) {
    const read = readText(root, a.file);
    if (!read.ok) {
      authorities.push({ id: a.id, file: a.file, values: null, error: read.reason });
      authorityValues.set(a.id, null);
      continue;
    }
    const ex = extract(read.text, a.extract, { symbol: a.symbol, anchor: a.anchor });
    if (!ex.ok) {
      authorities.push({ id: a.id, file: a.file, values: null, error: ex.reason });
      authorityValues.set(a.id, null);
      continue;
    }
    const values = ex.groups[0]?.values ?? [];
    if (values.length === 0) {
      authorities.push({ id: a.id, file: a.file, values: null, error: "extracted 0 values" });
      authorityValues.set(a.id, null);
      continue;
    }
    authorities.push({ id: a.id, file: a.file, values, error: null });
    authorityValues.set(a.id, values);
  }
  const surfaces = [];
  const violations = [];
  const notEvaluated = [];
  const knownDrift = [];
  for (const s of registry.surfaces) {
    const authority = authorityValues.get(s.authority) ?? null;
    if (authority === null) {
      notEvaluated.push({ surface: s.id, reason: `authority '${s.authority}' could not be evaluated` });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "not-evaluated", occurrences: [] });
      continue;
    }
    const read = readText(root, s.file);
    if (!read.ok) {
      notEvaluated.push({ surface: s.id, reason: read.reason });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "not-evaluated", occurrences: [] });
      continue;
    }
    const ex = extract(read.text, s.extract, { symbol: s.symbol, anchor: s.anchor, indices: s.indices });
    const zeroLiterals = ex.ok && !ex.groups.some((g) => g.values.length > 0) || !ex.ok && /matched 0 times/.test(ex.reason ?? "");
    if (s.derivesFrom && zeroLiterals) {
      const authorityNow = authorityValues.get(s.authority) ?? null;
      const v = verifyDeclaredDerivation(root, read, s, authorityNow ?? [], s.file);
      if (v.state === "derived") {
        surfaces.push({
          surface: s.id,
          authority: s.authority,
          file: s.file,
          state: "derived",
          occurrences: [{ index: 0, state: "derived", values: [], extra: [], missing: [], note: v.note }]
        });
        continue;
      }
      if (v.state === "violation") {
        violations.push({
          surface: s.id,
          index: 0,
          kind: "derivation-broken",
          detail: `extra=[${v.extra.join(",")}] missing=[${v.missing.join(",")}]`
        });
        surfaces.push({
          surface: s.id,
          authority: s.authority,
          file: s.file,
          state: "violation",
          occurrences: [{ index: 0, state: "violation", values: [], extra: v.extra, missing: v.missing, note: v.note }]
        });
        continue;
      }
      notEvaluated.push({ surface: s.id, reason: v.note });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "not-evaluated", occurrences: [] });
      continue;
    }
    if (s.derivesFrom && ex.ok) {
      const rowsHere = ex.groups.map((g) => {
        const dd = diff(g.values, authorityValues.get(s.authority) ?? []);
        return {
          index: g.index,
          state: "violation",
          values: g.values,
          extra: dd.extra,
          missing: dd.missing,
          note: `\u58F0\u660E\u4E3A\u8FD0\u884C\u65F6\u6D3E\u751F\uFF08derivesFrom ${s.derivesFrom.file}:${s.derivesFrom.symbol}\uFF09\uFF0C\u5374\u4ECD\u5E26\u5B57\u9762\u91CF\u526F\u672C`
        };
      });
      violations.push({
        surface: s.id,
        index: 0,
        kind: "derives-from-but-carries-literals",
        detail: `declared derivesFrom ${s.derivesFrom.file}:${s.derivesFrom.symbol} but ${rowsHere.length} literal occurrence(s) remain`
      });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "violation", occurrences: rowsHere });
      continue;
    }
    if (!ex.ok) {
      notEvaluated.push({ surface: s.id, reason: ex.reason });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "not-evaluated", occurrences: [] });
      continue;
    }
    const literalsFound = ex.groups.some((g) => g.values.length > 0);
    if (!literalsFound) {
      const spec = registry.authorities.find((a) => a.id === s.authority);
      const derived = spec ? authorityDerivation(read, spec.file, spec.symbol) : null;
      if (derived) {
        surfaces.push({
          surface: s.id,
          authority: s.authority,
          file: s.file,
          state: "derived",
          occurrences: [{ index: 0, state: "derived", values: [], extra: [], missing: [], note: `\u6D3E\u751F\u81EA ${derived}\uFF08\u89C4\u8303 2\uFF1A\u4E0D\u624B\u6284\uFF09` }]
        });
        continue;
      }
      notEvaluated.push({ surface: s.id, reason: `no literals and no import-derivation from authority '${s.authority}'` });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "not-evaluated", occurrences: [] });
      continue;
    }
    const declared = new Set(ex.groups.map((g) => g.index));
    if (s.indices !== void 0) {
      const missingIdx = s.indices.filter((i) => !declared.has(i));
      if (missingIdx.length > 0) {
        notEvaluated.push({ surface: s.id, reason: `declared occurrence(s) ${missingIdx.join(",")} no longer matched` });
      }
    }
    const exemptions = s.policy === "subset" ? scanExemptions(read.text) : [];
    const marker = findExemption(exemptions, s.id);
    const rows = [];
    for (const g of ex.groups) {
      const d = diff(g.values, authority);
      const entry = registry.knownDrift.find((k) => k.surface === s.id && k.index === g.index) ?? registry.knownDrift.find((k) => k.surface === s.id && k.index === void 0);
      let state2;
      let note;
      if (d.extra.length === 0 && d.missing.length === 0) {
        state2 = "in-sync";
      } else if (entry) {
        const grewExtra = d.extra.some((x) => !entry.extra.includes(x));
        const grewMissing = d.missing.some((x) => !entry.missing.includes(x));
        if (grewExtra || grewMissing) {
          state2 = "violation";
          note = `KNOWN_DRIFT \u53F0\u8D26\u767B\u8BB0\u4E3A extra=[${entry.extra.join(",")}] missing=[${entry.missing.join(",")}]\uFF1B\u5B9E\u6D4B\u5DEE\u96C6\u3010\u589E\u957F\u3011`;
          violations.push({
            surface: s.id,
            index: g.index,
            kind: grewExtra ? "known-drift-extra-grown" : "known-drift-missing-grown",
            detail: `extra=[${d.extra.join(",")}] missing=[${d.missing.join(",")}] vs recorded extra=[${entry.extra.join(",")}] missing=[${entry.missing.join(",")}]`
          });
        } else {
          state2 = "known-drift";
          const shrank = d.extra.length < entry.extra.length || d.missing.length < entry.missing.length;
          if (shrank) note = "\u5DEE\u96C6\u5DF2\u3010\u6536\u7A84\u3011\uFF08\u522B\u7684\u4EFB\u52A1\u4FEE\u597D\u4E86\u4E00\u90E8\u5206\uFF09\u21D2 \u53F0\u8D26\u6761\u76EE\u53EF\u6E05\u7406";
          knownDrift.push({ surface: s.id, index: g.index, extra: d.extra, missing: d.missing, note: note ?? entry.reason });
        }
      } else if (s.policy === "subset" && d.extra.length === 0) {
        if (marker) {
          state2 = "exempt";
          note = `\u8C41\u514D\uFF08\u7B2C ${marker.line} \u884C\uFF09\uFF1A${marker.reason}`;
        } else {
          state2 = "violation";
          note = "\u6536\u7A84\u4F46\u65E0\u8C41\u514D\u6CE8\u91CA\uFF08\u89C4\u8303 5\uFF1A\u4E0D\u63A5\u53D7\u6C89\u9ED8\u5730\u5C11\u5217\u51E0\u4E2A\uFF09";
          violations.push({ surface: s.id, index: g.index, kind: "silent-narrowing", detail: `missing=[${d.missing.join(",")}] without an enum-surface-exempt marker` });
        }
      } else {
        state2 = "violation";
        violations.push({
          surface: s.id,
          index: g.index,
          kind: d.extra.length > 0 ? "extra" : "missing",
          detail: `extra=[${d.extra.join(",")}] missing=[${d.missing.join(",")}]`
        });
      }
      rows.push({ index: g.index, state: state2, values: g.values, extra: d.extra, missing: d.missing, note });
    }
    const state = rows.some((r) => r.state === "violation") ? "violation" : rows.length === 0 ? "not-evaluated" : rows.some((r) => r.state === "exempt") ? "exempt" : rows.some((r) => r.state === "known-drift") ? "known-drift" : rows.some((r) => r.state === "derived") ? "derived" : "in-sync";
    surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state, occurrences: rows });
  }
  const discovered = discoverUnregistered({ root, registry });
  const status = violations.length > 0 ? "fail" : notEvaluated.length > 0 ? "not-evaluated" : "pass";
  return {
    ok: status === "pass",
    status,
    authorities,
    surfaces,
    violations,
    notEvaluated,
    knownDrift,
    discovered
  };
}
var DISCOVERY_ROOTS = ["packages/quay/src", "packages/quay-native/src", "plugin/scripts"];
var DISCOVERY_SKIP = /(^|\/)(test|tests|dist|vendor|node_modules|archive|checker-mutation-cases)(\/|$)|\.test\./;
function discoverUnregistered(opts) {
  const { root, registry } = opts;
  const authoritySets = /* @__PURE__ */ new Map();
  for (const a of registry.authorities) {
    const read = readText(root, a.file);
    if (!read.ok) continue;
    const ex = extract(read.text, a.extract, { symbol: a.symbol, anchor: a.anchor });
    if (ex.ok && ex.groups[0] && ex.groups[0].values.length > 0) authoritySets.set(a.id, new Set(ex.groups[0].values));
  }
  const registeredValues = /* @__PURE__ */ new Map();
  for (const s of registry.surfaces) {
    const read = readText(root, s.file);
    if (!read.ok) continue;
    const ex = extract(read.text, s.extract, { symbol: s.symbol, anchor: s.anchor, indices: s.indices });
    if (!ex.ok) continue;
    const list = registeredValues.get(s.file) ?? [];
    for (const g of ex.groups) list.push(g.values);
    registeredValues.set(s.file, list);
  }
  const authorityFiles = new Set(registry.authorities.map((a) => a.file));
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rel of DISCOVERY_ROOTS) {
    const abs = path2.join(root, rel);
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { recursive: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const sub of entries) {
      const relPath = path2.posix.join(rel, String(sub));
      if (!relPath.endsWith(".ts") || DISCOVERY_SKIP.test(relPath)) continue;
      if (authorityFiles.has(relPath)) continue;
      if (path2.basename(relPath) === "enum-surface-parity-check.ts") continue;
      const read = readText(root, relPath);
      if (!read.ok) continue;
      const re = /\[([^\]\n]*"[^\]\n]*)\]/g;
      let m;
      while ((m = re.exec(read.text)) !== null) {
        const values = stringLiteralsIn(m[0], 0, m[0].length).filter((v) => /^[a-z][a-z0-9-]*$/.test(v));
        if (values.length < 2) continue;
        const set = new Set(values);
        const already = (registeredValues.get(relPath) ?? []).some(
          (vals) => vals.length === values.length && vals.every((v) => set.has(v))
        );
        if (already) continue;
        for (const [aid, aset] of authoritySets) {
          if (![...set].every((v) => aset.has(v))) continue;
          const sorted = [...set].sort();
          const key = `${relPath}::${sorted.join(",")}`;
          if (seen.has(key)) break;
          seen.add(key);
          out.push({ file: relPath, line: read.text.slice(0, m.index).split("\n").length, values: sorted, authority: aid });
          break;
        }
      }
    }
  }
  return out;
}
function renderHuman(res, authorityIds) {
  const out = [];
  out.push("== enum surface parity (ADR-036) \u2014 \u6743\u5A01\u679A\u4E3E \u2194 \u8868\u5C42\u526F\u672C\uFF0C\u4E24\u5411\u5DEE\u96C6 ==");
  for (const a of res.authorities) {
    if (a.values === null) {
      out.push(`  [${a.id}] ${a.file} \u2014 NOT-EVALUATED (${a.error})`);
    } else {
      out.push(`  [${a.id}] ${a.file} \u2014 ${a.values.length} \u503C: ${a.values.join(", ")}`);
    }
  }
  out.push("");
  out.push("-- \u8868\u5C42\uFF08sub = \u6743\u5A01 id\uFF09--");
  for (const s of res.surfaces) {
    const sub = authorityIds.get(s.authority) ?? s.authority;
    if (s.occurrences.length === 0) {
      out.push(`  [${s.state}] ${s.surface} (${sub}) ${s.file}`);
      continue;
    }
    for (const o of s.occurrences) {
      const idx = s.occurrences.length > 1 ? `#${o.index} ` : "";
      const d = o.extra.length === 0 && o.missing.length === 0 ? "\u5DEE\u96C6\u4E3A\u7A7A" : `extra=[${o.extra.join(",")}] missing=[${o.missing.join(",")}]`;
      out.push(`  [${o.state}] ${s.surface} ${idx}(${sub}) ${s.file} \u2014 ${o.values.length} \u503C {${o.values.join(", ")}} \xB7 ${d}${o.note ? ` \xB7 ${o.note}` : ""}`);
    }
  }
  if (res.notEvaluated.length > 0) {
    out.push("");
    out.push(`-- NOT-EVALUATED\uFF08\u8BFB\u4E0D\u51FA\uFF0C\u26D4 \u65E2\u975E\u300C\u4E00\u81F4\u300D\u4E5F\u975E\u300C\u4E0D\u4E00\u81F4\u300D\uFF09${res.notEvaluated.length} \u6761 --`);
    for (const n of res.notEvaluated) out.push(`  ${n.surface}: ${n.reason}`);
  }
  if (res.knownDrift.length > 0) {
    out.push("");
    out.push(`-- \u5DF2\u77E5\u6F02\u79FB\uFF08\u53F0\u8D26\u767B\u8BB0\uFF1B\u62A5\u51FA\u800C\u4E0D\u963B\u65AD\uFF0C\u53EA\u6709\u3010\u589E\u957F\u3011\u624D\u7EA2\uFF09${res.knownDrift.length} \u6761 --`);
    for (const k of res.knownDrift) out.push(`  ${k.surface}${k.index !== void 0 ? `#${k.index}` : ""}: extra=[${k.extra.join(",")}] missing=[${k.missing.join(",")}] \u2014 ${k.note}`);
  }
  if (res.discovered.length > 0) {
    out.push("");
    out.push(`-- \u672A\u767B\u8BB0\u7684\u5019\u9009\u5B50\u96C6\u5B57\u9762\u91CF\uFF08\u4EC5\u4F9B\u53C2\u8003\uFF0C\u26D4 \u4E0D\u53C2\u4E0E\u9000\u51FA\u7801\uFF09${res.discovered.length} \u6761 --`);
    for (const d of res.discovered) out.push(`  ${d.file}:${d.line} \u2282 ${d.authority} \u2014 {${d.values.join(", ")}}`);
  }
  return out.join("\n");
}
function checkAndEmit(argv, registryOverride) {
  const parsed = parseArgs(argv, {
    minArgs: 0,
    usage: "enum-surface-parity-check.ts [--root <dir>] [--json] [--registry <path.json>]",
    flags: { root: { type: "string" }, json: { type: "boolean" }, registry: { type: "string" } }
  });
  const root = typeof parsed.flags.root === "string" && parsed.flags.root !== "" ? path2.resolve(parsed.flags.root) : process.cwd();
  const json = parsed.flags.json === true;
  let registry = registryOverride ?? DEFAULT_REGISTRY;
  if (typeof parsed.flags.registry === "string" && parsed.flags.registry !== "") {
    const registryPath = path2.resolve(parsed.flags.registry);
    try {
      registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    } catch (e) {
      process.stderr.write(`enum-surface-parity-check: cannot read --registry ${registryPath}: ${e.message}
`);
      return 2;
    }
  }
  if (!Array.isArray(registry.authorities) || registry.authorities.length === 0) {
    if (json) return emitVerdict({ status: "not-evaluated", message: "registry is empty \u2014 nothing evaluated", detail: { status: "not-evaluated" } }, { json: true });
    process.stdout.write("NOT-EVALUATED: registry is empty \u2014 nothing evaluated (\u26D4 \u4E0D\u5F97\u8BFB\u4F5C PASS)\n");
    return 3;
  }
  const res = runCheck({ root, registry });
  const authorityIds = new Map(registry.authorities.map((a) => [a.id, a.id]));
  if (json) {
    const verdict = {
      status: res.status,
      message: res.status === "pass" ? `all ${res.surfaces.length} registered surfaces consistent (${res.knownDrift.length} known drift, ${res.notEvaluated.length} not evaluated)` : res.status === "fail" ? `${res.violations.length} violation(s) across ${res.surfaces.length} registered surfaces` : `no violations, but ${res.notEvaluated.length} surface(s) could not be evaluated`,
      detail: res
    };
    return emitVerdict(verdict, { json: true });
  }
  process.stdout.write(renderHuman(res, authorityIds) + "\n");
  const message = res.status === "pass" ? `all ${res.surfaces.length} registered surfaces consistent (${res.knownDrift.length} known drift, ${res.notEvaluated.length} not evaluated)` : res.status === "fail" ? `${res.violations.length} violation(s): ${[...new Set(res.violations.map((v) => v.surface))].join(", ")}` : `no violations, but ${res.notEvaluated.length} surface(s) could not be evaluated`;
  return emitVerdict({ status: res.status, message }, {});
}
if (isDirectEntry(import.meta, void 0, "enum-surface-parity-check")) {
  const code = checkAndEmit(process.argv);
  process.exit(code);
}
export {
  DEFAULT_REGISTRY,
  MIN_EXEMPT_REASON_CHARS,
  authorityDerivation,
  checkAndEmit,
  diff,
  discoverUnregistered,
  extract,
  findExemption,
  runCheck,
  scanExemptions,
  tokenize,
  verifyDeclaredDerivation
};
