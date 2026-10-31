---
id: xyz
status: todo
labels: []
parent: null
children: []
extra: {}
---
## Finding

The task `xyz` was materialized with an empty body, so the author→ready promotion gate could not detect a registered task shape and reported `missing=[unknown-shape]`, and it lacked the self-touch grant the dispatch gate requires.

## AC

- `tasks/xyz.md` carries a recognized finding shape (`## Finding`, `## AC`, `## DoD`).
- `## Touches` lists `tasks/xyz.md` as its own self-touch entry, without a `(new)` tag.

## DoD

- Running the promotion gate over `xyz` reports `fourArtifacts: true` and `selfTouchOk: true`.

## Touches

- `tasks/xyz.md`