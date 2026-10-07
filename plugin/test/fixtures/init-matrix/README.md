# `init` upgrade matrix — historical fixtures

Each `<version>/` directory holds **one historical release's REAL `quay init` output**:

| file | what it is |
|---|---|
| `config.yml` | the bytes that tag's `quay-init.sh` wrote into a fresh project's `.quay/config.yml` — verbatim, never hand-written or hand-edited |
| `PROVENANCE` | `tag:` / `tag-sha:` / `generated:` / `config-sha256:` plus the exact build + init commands that produced the fixture |

`plugin/test/init-upgrade-matrix.test.mjs` takes every fixture, runs the **current** `quay init`
over it, and asserts the upgraded config validates (CLI `quay config validate` + MCP
`config_validate`), that user comments / a user-pinned compatible value / an unknown top-level key
survive, that retired keys are deleted, and that a second run is byte-identical.

**Why a matrix and not one fixture.** "Upgrading always yields a config that matches the new
version" cannot be pinned by a single shape: the writer changed between releases (v0.14.0 bound the
native provider to `${PLUGIN_ROOT}/vendor/...`, v0.15.0 to a project-internal `.quay/plugin/...`,
v0.16.0 to no binding at all), and each shape exercises a different arm of the upgrade engine. The
2026-10-07 release rehearsal found a real project whose upgrade still left `config validate` red —
one shape is not enough.

## Adding a fixture for a new release (the fixed procedure)

Run this **once per release tag**, from a checkout of the quay repo. It produces a fixture for the
tag whose init ran; commit the result together with a matching AC run.

```sh
# 0. pick the tag and a deterministic scratch layout (re-running reproduces the same bytes)
TAG=v0.17.0
BASE=/tmp/quay-init-matrix-gen

# 1. one-off checkout of the tag (a linked worktree is enough; a clone works too)
git -C <repo> worktree add --detach "$BASE/src-$TAG" "$TAG"

# 2. build that tag's RELEASE-FORM plugin tree — the artifact a user actually installs.
#    No --push: it only creates a local orphan branch and commits into it.
( cd "$BASE/src-$TAG" && bash plugin/scripts/publish-dist-branch.sh --branch "dist-$TAG" )
git -C "$BASE/src-$TAG" worktree add --detach "$BASE/dist-$TAG" "dist-$TAG"

# 3. run THAT tag's init against a fresh git repo, using the built tree
SCRATCH="$BASE/scratch-rel-$TAG"
mkdir -p "$SCRATCH" && cd "$SCRATCH" && git init -q -b main . \
  && git -c user.email=t@t.invalid -c user.name=t commit -q --allow-empty -m init
bash "$BASE/dist-$TAG/scripts/quay-init.sh" \
  --root "$SCRATCH" --plugin-root "$BASE/dist-$TAG" \
  --test-command "npm test" --auto-commit-skip

# 4. the fixture IS the file that run wrote — copy it verbatim, never edit it
mkdir -p plugin/test/fixtures/init-matrix/$TAG
cp "$SCRATCH/.quay/config.yml" "plugin/test/fixtures/init-matrix/$TAG/config.yml"
sha256sum "plugin/test/fixtures/init-matrix/$TAG/config.yml"

# 5. write PROVENANCE the same way the existing three do (tag, tag-sha, date, config-sha256,
#    and the exact commands above). Then: node --experimental-strip-types --test plugin/test/init-upgrade-matrix.test.mjs
```

Then clean up (`git worktree remove`/`prune` the two throwaway worktrees and `rm -rf "$BASE"`).

⛔ **Do not** synthesize a fixture by editing bytes, templating paths, or copying another
version's file — the whole point is that the upgrade is judged against what a historical release
actually emitted. The absolute paths baked into `config.yml` (`repo_root`, `worktree_root`,
`tasks_dir`, the four `QUAY_NATIVE_*` carrier dirs, and for older tags `providers.native.path` /
`mcp_entry`) are the scratch layout above; they are recorded, not sanitized.

## Requirements the fixtures must keep satisfying

- at least **3** version directories, each with `config.yml` + `PROVENANCE`;
- every `PROVENANCE` `tag:` exists in `git tag` of the checkout;
- the `config.yml` fixtures are **not all byte-identical** (different releases emitted different
  configs — identical fixtures mean a version was copied, not generated).

`AC-333` (`quay goal show AC-333`) checks exactly these three mechanically; the matrix test checks
the upgrade behavior on top of them.
