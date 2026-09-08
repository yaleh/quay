---
id: gap-frontmatter-slugify-drops-non-ascii
title: frontmatter-store-base.ts:50 的 slugify 做 [^a-z0-9]+→'-'，把中文标题整段抹掉 ⇒ 四个
  store（goal/adr/meta/doc）共 101 个记录里 16 个（15%）文件名严重退化，如 40 字标题落成
  GOAL-008-store-kind.md
status: done
labels:
  - gap
  - goal-store
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：人 2026-09-08 追问「GOAL-008 为什么和另外两个显著不同」时，查创建路径连带查出的第二个机制。
与内容完整性（`gap-goal-record-completeness-undefined`）**不是同一件事**：那条管「记录里写没写够」，
本条管「文件名怎么生成」，且波及面更广（四个 store，不止 goal）。

**根因（一行）**：`packages/quay/src/frontmatter-store-base.ts:50`

    export function slugify(title, fallback = "adr") {
      return String(title || "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")      // ← 非 ASCII 字母数字一律替换成 '-'
        .replace(/^-+|-+$/g, "").slice(0, 60) || fallback;
    }

`[^a-z0-9]` 把**全部中文字符**当作分隔符替换掉，再由 `-+` 折叠、首尾修剪 ⇒
一个以中文为主的标题只剩其中零星的 ASCII 片段。

**实例**：标题「五种 store kind 的提交面统一 —— 一个原语、四态返回、传播跟读者走」（40 字符，22 个汉字）
⇒ 文件名 `GOAL-008-store-kind.md`，slug 只剩 **10 字符**。

**发生率（枚举 goals/ adr/ meta/ 全部带 `<id>-<slug>` 形式的记录，非抽查）**：

- 总计 **101** 条
- 标题含中文且 slug 信息严重丢失（slug 长度 < 标题长度 40%）：**16 条（15%）**
- 最严重的几条：
  `AC-190-task-ac.md`（标题 50 字符/32 汉字 → slug **7**）、
  `AC-180-active-ac.md`（39/23 → **9**）、
  `GOAL-008-store-kind.md`（40/22 → **10**）、
  `AC-181-meta-driver.md`（47/29 → **11**）、
  `GOAL-007-done-fixture.md`（56/38 → **12**）、
  `ADR-033-schema-agent.md`（52/32 → **12**）

**波及四个 store（不是 goal 专属）** —— `slugify` 的调用点枚举：

    packages/quay/src/adr-store.ts:217        `${id}-${slugify(title)}.md`
    packages/quay/src/meta-store.ts:183       `${id}-${slugify(title, "meta")}.md`
    packages/quay/src/goal-store.ts:596       `${id}-${slugify(title, "goal")}.md`
    packages/quay/src/document-store.ts:154   `${id}-${slugify(title, "doc")}.md`

**影响面（诚实定级：可发现性，不是功能中断）**：id 解析走
`fileNameForId`（匹配 `<id>.md` 或 `<id>-*.md`），所以**退化的文件名不会导致记录读不到**。
代价是人在 `ls goals/` / git diff / 提交信息里**无法从文件名认出这条记录讲什么**——
`AC-190-task-ac.md` 与 `AC-180-active-ac.md` 彼此几乎无从分辨。
这也是本仓库以中文为主要写作语言时的系统性问题，而非个例。

**修法方向（择一，AC 不绑定实现）**：

1. **保留非 ASCII**：只把真正的路径不安全字符（`/ \ : * ? " < > | ` 控制字符、前后空白）替换掉，
   保留中日韩字符；长度上限从「字符数」改为对文件系统安全的字节/字符上限；
2. 或**退化时补可辨识后缀**：当 slug 相对标题丢失过多时，附加标题的短 hash（如 `-a3f1`），
   保证同前缀记录之间可区分。

**存量文件不做批量改名**（id 照常解析，改名会产生跨 store 的大批 churn 且 git 历史断裂）；
但要**产出退化清单**，让后续有据可查（硬规则 3 枚举不布尔）。改名可作为单独决策，不在本任务。

## Acceptance Criteria

- [x] AC1 中文标题不再被抹掉（能取假）：单测对标题
      「五种 store kind 的提交面统一 —— 一个原语、四态返回、传播跟读者走」调 `slugify`，
      断言结果**不等于** `store-kind`，且与标题的相似度（或 slug 长度 / 标题长度）**≥ 0.4**。
      取假：当前实现返回恰好 `store-kind` ⇒ 必须报红。
- [x] AC2 四个 store 全部受益（枚举不抽查）：对 `adr-store.ts:217` / `meta-store.ts:183` /
      `goal-store.ts:596` / `document-store.ts:154` **四个调用点各造一条中文标题记录**，
      断言四个生成的文件名都通过 AC1 的判据。打印四个实际文件名。
- [x] AC3 路径安全不回退（负控制，两个方向都断言）：对含 `/`、`\`、`:`、`..`、控制字符、
      前后空白、以及超长（>200 字符）的标题调 `slugify`，断言结果**不含**任何路径分隔符与控制字符、
      不以 `.` 开头、长度有上界；再断言一个正常中文标题**不被**这些规则误伤。
- [x] AC4 幂等与稳定：对同一标题调两次断言结果相同；对已存在文件的记录再次 `write`，
      断言**沿用既有文件名**（`existingFile ?? ...` 的语义不变，不产生重命名）。
      取假：若实现改动了这一分支，同一记录会在磁盘上分裂成两个文件。
- [x] AC5 存量退化清单：产出并在提交信息中贴出当前四个 store 里 slug 严重退化的**完整清单与条数**
      （2026-09-08 实测 16/101；实现时以当时重算为准），逐条给 `(文件名, 标题, slug 长/标题长)`。
      只给条数不给清单 ⇒ 不算达成。
- [x] AC6 `bash scripts/test.sh --for-task gap-frontmatter-slugify-drops-non-ascii` 退出码 0。

## Definition of Done

用**真实的 store 写入**（经 MCP 动词，非单测假 store）新建一条中文标题的 goal 与一条中文标题的 ADR，
`ls` 出来的两个文件名能让人一眼认出是哪条记录——命令与输出贴进提交信息，
并附 AC5 的存量退化清单。**「改了正则 + 单测绿」不算达成。**

## Touches

- `packages/quay/src/frontmatter-store-base.ts`
- `packages/quay/test/frontmatter-store-base.test.mjs`
- `packages/quay/test/gap-frontmatter-slugify-drops-non-ascii.test.mjs`
- `tasks/gap-frontmatter-slugify-drops-non-ascii.md`
