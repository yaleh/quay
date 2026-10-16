---
id: AC-152
title: Filter 是可组合谓词列表
status: achieved
kind: criterion
goal: GOAL-002
criterion: node --no-warnings --experimental-strip-types -e
  'import("./plugin/scripts/driver-filters.ts").then((m)=>{const
  want=["notInFlight","depsSatisfied","touchesDisjointOrAged","retryCapNotExhausted","notNeedsHuman"];const
  f=m.TASK_FILTERS;if(!Array.isArray(f)){console.error("CAUSE=TASK_FILTERS-not-a-list
  — the composable-predicate list is the single carrier AC-152
  names");process.exit(1)}if(f.length!==want.length){console.error("CAUSE=filter-count="+f.length+"-want="+want.length+"
  — TASK_FILTERS must hold exactly the five composable predicates, no more and
  no fewer");process.exit(1)}const names=f.map((x)=>x&&x.name);const
  missing=want.filter((n)=>!names.includes(n));if(missing.length){console.error("CAUSE=missing-filter="+missing.join(",")+"
  — TASK_FILTERS must expose "+want.join(","));process.exit(1)}const
  dup=names.filter((n,i)=>names.indexOf(n)!==i);if(dup.length){console.error("CAUSE=duplicate-filter-name="+Array.from(new
  Set(dup)).join(",")+" — each predicate occupies exactly one
  slot");process.exit(1)}const bad=f.filter((x)=>typeof
  x.predicate!=="function").map((x)=>x&&x.name);if(bad.length){console.error("CAUSE=filter-without-predicate="+bad.join(",")+"
  — every slot must carry a callable predicate, not a name-only
  stub");process.exit(1)}process.exit(0)}).catch((e)=>{console.error("CAUSE=import-failed="+String((e&&e.message)||e));process.exit(1)})'
expect: exit 0
origin: >
  人 2026-08-23 裁定「前述可重用机制应当分层抽象，以支持这两层上的重用」；

  正本 orchestration/SPEC-unified-driver-architecture-2026-08-23.md
  §2.1/§2.5/§2.6。
---

**判据（能取假）**：`notInFlight`/`depsSatisfied`/`touchesDisjointOrAged`/`retryCapNotExhausted`/
`notNeedsHuman` 是**一个列表里的元素**，两个任务处理型 kind 共用。

**取假（一条命令可验）**：给两个 driver 同时新增一个谓词，**若需要改两处以上 ⇒ 假**。
⊢ 发生率已实测：缺 `depsSatisfied` ⇒ ac138 白烧 15 分钟；缺 `touchesDisjoint` ⇒ Git-History
群组撞 `serve-handlers.ts` 的风险（2026-08-23，同一个缺失抽象的两种表现）。

**更正（2026-10-17）**：上面第二段末句的 2026-08-23 读数**原样保留**（那是当日的实测，⛔ 不改写历史
读数）。此后列表里 touch 那一格**改过名**：commit `efb4c8e85`（GOAL-037 / AC-365，2026-10-16 achieved）
把它从 `touchesDisjoint` 换成 `touchesDisjointOrAged` —— 是**取代**列表中的那一格、而不是追加第六个
谓词（理由：GOAL-037 的生效路径以「off 下与现状逐字节同形」为前提），`touchesDisjoint` 本身**保留
导出**，只是不再占据列表那一格。判据一度因此 stale（点名旧名）；现在的 criterion 点名**当前**那一格，
并额外断言列表恰好五格、名字唯一、每格都带可调用的 `predicate`。