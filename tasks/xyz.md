---
id: xyz
status: done
labels: []
parent: null
children: []
extra: {}
---
## Finding

The task `xyz` was materialized with an empty body, so the author→ready promotion gate could not detect a registered task shape and reported `missing=[unknown-shape]`, and it lacked the self-touch grant the dispatch gate requires.

## AC

- [x] `tasks/xyz.md` carries a recognized finding shape (`## Finding`, `## AC`, `## DoD`).
- [x] `## Touches` lists `tasks/xyz.md` as its own self-touch entry, without a `(new)` tag.

## DoD

- Running the promotion gate over `xyz` reports `fourArtifacts: true` and `selfTouchOk: true`.
- 该轴仍暗,理由: 本任务为自愈型 finding，仅补齐 tasks/xyz.md 的 finding 形状与自触条目，无代码或架构变更，无可测读数。

## Touches

- `tasks/xyz.md`