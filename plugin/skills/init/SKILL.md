---
name: quay-init
description: "Initialize a workspace with quay workflows, agents, and gate scripts from the quay plugin bundle. Idempotent — safe to run multiple times."
allowed-tools: Bash, Read
---

# quay-init

Copy quay methodology assets from the plugin installation into the current workspace.
Source: `${CLAUDE_PLUGIN_ROOT}` (the quay plugin directory).
Target: the current workspace's `.claude/` and `scripts/` directories.

## Arguments

```
--workflows       Copy workflows only    (plugin/workflows/     → .claude/workflows/)
--agents          Copy agents only       (plugin/agents/        → .claude/agents/)
--gate-scripts    Copy gate scripts only (plugin/gate-scripts/  → scripts/gates/)
--all             Copy all categories    (default if no flag given)
--force           Overwrite on conflict  (default: skip and report conflict)
--dry-run         List what would happen, do not copy
```

## Mapping

| Plugin source (`${CLAUDE_PLUGIN_ROOT}/`) | Workspace target |
|---|---|
| `workflows/*.js` | `.claude/workflows/` |
| `agents/*.md` | `.claude/agents/` |
| `gate-scripts/*.sh`, `gate-scripts/*.ts` | `scripts/gates/` |

## Behavior

For each file in the requested category:
- **Target does not exist** → copy
- **Target exists, content identical** → skip (idempotent)
- **Target exists, content differs**:
  - Without `--force`: report conflict, skip
  - With `--force`: overwrite (with backup comment)
- **Source directory empty or missing** → warn, skip category (never fail)

## Steps

### 1. Parse arguments

Read the user's argument string. Default to `--all` if no category flag given.

### 2. Verify plugin root

Read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` to confirm this is the quay plugin.
If `${CLAUDE_PLUGIN_ROOT}` is not set or the file is absent → error, exit.

### 3. For each requested category

Run the copy loop with a shell script that implements the idempotent-copy logic:

```bash
SRC_DIR="${CLAUDE_PLUGIN_ROOT}/<category>"
TARGET_DIR="<workspace-relative target>"
COPIED=0; SKIPPED=0; CONFLICTED=0

mkdir -p "$TARGET_DIR"

for src in "$SRC_DIR"/*; do
  [ -f "$src" ] || continue
  fname="$(basename "$src")"
  tgt="$TARGET_DIR/$fname"

  if [ ! -f "$tgt" ]; then
    cp "$src" "$tgt"
    COPIED=$((COPIED + 1))
    echo "  copied: $fname"
  elif cmp -s "$src" "$tgt"; then
    SKIPPED=$((SKIPPED + 1))
    echo "  skipped (identical): $fname"
  else
    if [ "$FORCE" = "true" ]; then
      # Backup existing, then overwrite
      cp "$tgt" "$tgt.bak.$(date +%s)"
      cp "$src" "$tgt"
      COPIED=$((COPIED + 1))
      echo "  overwritten (backed up): $fname"
    else
      CONFLICTED=$((CONFLICTED + 1))
      echo "  CONFLICT: $fname (content differs — use --force to overwrite)"
    fi
  fi
done

echo "  → copied=$COPIED skipped=$SKIPPED conflicted=$CONFLICTED"
```

### 4. Report summary

After processing all categories, print a structured summary:

```
quay-init complete.
  workflows:    copied=N skipped=M conflicted=K
  agents:       copied=N skipped=M conflicted=K
  gate-scripts: copied=N skipped=M conflicted=K
```

If any conflicts were detected, add:
```
Conflicts detected. To overwrite: /quay:init --force
To see diffs: diff <target> ${CLAUDE_PLUGIN_ROOT}/<category>/<file>
```

### 5. Workspace detection (informational only)

Check if `.quay/config.yml` exists in the workspace root. If absent, print:
```
Note: .quay/config.yml not found. This may not be a quay workspace.
Run `quay init` (CLI) to create one, or configure manually.
```
This is a WARNING, not a block — the copy proceeds regardless.
