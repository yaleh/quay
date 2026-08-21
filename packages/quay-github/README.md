# quay-github

`quay-github` is the **GitHub Provider** for [quay (Core)](../quay) — a
second, real backend that maps a repository's GitHub Issues onto the
canonical task view-model. It exists to prove the Provider ABI transfers to
a heterogeneous store: unlike `quay-native` (a markdown-format convention
this project invented), GitHub Issues is a pre-existing backend with its own
object model, so every field has to be **normalized** rather than assumed.

## Relationship to Core

Core (`quay`) is provider-agnostic — it speaks only the ABI's canonical task
shape. `quay-github` is the concrete adapter that makes GitHub Issues look
like that shape. Select it per-command with `--provider github`, or make it
the default `enabled: true` provider in `.quay/config.yml`:

```yaml
providers:
  github:
    enabled: true
    path: "./packages/quay-github"
    mcp_entry: ["node", "./bin/quay-github.ts", "mcp"]
    env:
      QUAY_GITHUB_REPO: "yaleh/quay"   # owner/repo to read issues from
```

## View-model mapping

| canonical field | source |
|---|---|
| `id` | `"gh-<number>"` (GitHub issue number) |
| `status` | `issue.state == closed` → `done`; else the highest-precedence `status:*` label (`done > needs-human > ready > todo`); else `todo` |
| `lane` | a `lane:*` label, or absent |
| `labels` | `issue.labels` minus the reserved `status:*`/`lane:*` labels |
| `parent` / `children` | derived from `- [ ] #N` / `- [x] #N` checkbox references between issues' bodies |
| `body` | `issue.body` verbatim |

Because GitHub has no native `status` field, the mapping is a documented
**label convention**, not a GitHub feature — the LCD problem in miniature
that this Provider exists to test. See [`DESIGN.md`](DESIGN.md) for the full
mapping and the normalization decisions.

## Usage

Like `quay-native`, the provider exposes both a raw CLI and an MCP server.
Reads go through the `gh` CLI (`gh api repos/<owner>/<repo>/issues …`),
matching quay-native's CLI-first design ethos rather than a separate
REST/GraphQL client library:

```sh
# Direct:
QUAY_GITHUB_REPO=yaleh/quay node --experimental-strip-types packages/quay-github/bin/quay-github.ts task list
QUAY_GITHUB_REPO=yaleh/quay node --experimental-strip-types packages/quay-github/bin/quay-github.ts task get gh-3
QUAY_GITHUB_REPO=yaleh/quay node --experimental-strip-types packages/quay-github/bin/quay-github.ts task create --title "…"   # creates a real issue
QUAY_GITHUB_REPO=yaleh/quay node --experimental-strip-types packages/quay-github/bin/quay-github.ts task edit gh-3 --status done
QUAY_GITHUB_REPO=yaleh/quay node --experimental-strip-types packages/quay-github/bin/quay-github.ts mcp                        # start the MCP server

# Through Core:
node --experimental-strip-types packages/quay/bin/quay.ts task list --provider github
```

The write surface covers **create** (a genuinely new issue via `task create`,
printing the real `gh-<n>` id GitHub assigns) and **full edit**
(title/body/status/labels/parent/children). `gate` (`task check`) and the
`skill` capability (the `quay:author`/`quay:execute` mapping, parameterized
per-provider) are also declared and implemented — see [`provider.yml`](provider.yml)
for the current, honest scope. Released under the repo's
[`LICENSE`](../../LICENSE).
