# Releasing

Each module is versioned and released on its own. A release is a tag
`<module>/v<version>`, for example `counters/v1.1.0`. Pushing the tag runs
`.github/workflows/release.yml`, which publishes the module to JSR and npm.

## 1. Bump the version

On a branch, set the new `version` in the module's `deno.json` and
`package.json`, and refresh the lock file:

```bash
cd counters
# edit "version" in deno.json and package.json
npm install
```

Open a pull request and merge it. A version with a qualifier, such as `1.1.0-0`,
is a prerelease: npm publishes it under the `next` tag instead of `latest`.

## 2. Preview the release notes

```bash
deno run --allow-run bin/release-notes.ts counters
```

This prints the pull requests that changed `counters/` since its last release,
so you can check what is going out before tagging.

## 3. Tag

```bash
git fetch origin
git tag counters/v1.1.0 origin/main
git push origin counters/v1.1.0
```

`release.yml` checks that the tag matches the versions in `deno.json` and
`package.json`, runs the module's tests, dry-runs both registries, then
publishes to JSR and npm. npm uses trusted publishing, so no token is needed. A
version already on a registry is skipped, so a failed release can be rerun.

## 4. Create the GitHub release

```bash
deno run --allow-run bin/release-notes.ts counters --to counters/v1.1.0 > /tmp/notes.md
gh release create counters/v1.1.0 --title "counters 1.1.0" --notes-file /tmp/notes.md
```

Add `--prerelease` for a qualified version.

## bin/release-notes.ts

Prints release notes for one module in the format of GitHub's generated notes:
each pull request that changed files under the module's directory, with its
author and link, and a link to the full diff. Run it from the repository root;
it needs `git` and an authenticated `gh`.

```bash
deno run --allow-run bin/release-notes.ts <module> [--to <ref>] [--from <ref>]
```

| option   | default                        | meaning                |
| -------- | ------------------------------ | ---------------------- |
| `--to`   | `HEAD`                         | the end of the range   |
| `--from` | the previous `<module>/v*` tag | the start of the range |

When `--to` is a final version, `--from` skips prerelease tags, so the notes for
`1.1.0` cover everything since `1.0.1`, not just since `1.1.0-0`. For a
prerelease, `--from` is the nearest tag of any kind.

A pull request that changed several modules is listed in the notes of each.
Commits that didn't come through a pull request are listed with a link to the
commit.
