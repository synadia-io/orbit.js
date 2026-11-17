# CLAUDE.md - orbit.js

Orbit.js is an incubator of NATS utilities for JavaScript/TypeScript, built on
nats.js v3. Modules that prove useful may move into the NATS clients.

## Repository Structure

Each top-level directory is an independent module, with its own `deno.json`,
`package.json` (when it is on npm), version, CI and release. There is no
workspace: run commands from the module's directory.

| Directory          | Package                         | Registries | Description                                   |
| ------------------ | ------------------------------- | ---------- | --------------------------------------------- |
| `counters/`        | `@synadiaorbit/counters`        | jsr, npm   | JetStream-based atomic counters               |
| `fastingest/`      | `@synadiaorbit/fastingest`      | jsr, npm   | JetStream fast-ingest batch publish           |
| `messagepipeline/` | `@synadiaorbit/messagepipeline` | jsr, npm   | Middleware transformations for NATS messages  |
| `muxsub/`          | `@synadiaorbit/muxsub`          | jsr, npm   | Multiplexing subscription                     |
| `nhgc/`            | `@synadiaorbit/nhgc`            | jsr        | Client for the NATS HTTP Gateway (standalone) |

`bin/cjs-fix-imports.ts` rewrites the sources' `.ts` imports for the npm builds.

### Module layout

- `src/mod.ts` — the public API
- `tests/` — Deno tests (`*_test.ts`); nhgc keeps its tests next to the sources
- `deno.json` — jsr name, version, imports and publish excludes
- `package.json`, `tsconfig.json`, `package-lock.json` — the npm build
- `README.md`, `LICENSE`

## Development Commands

Deno is the primary toolchain. From a module's directory:

```bash
deno fmt --check            # formatting (ci runs this)
deno lint
deno test -A                # tests; most connect to demo.nats.io
```

The npm build compiles the same sources with `tsc`, which can fail where Deno's
checks pass, so run it too when changing a module that has a `package.json`:

```bash
npm install
npm run build               # lib/ (gitignored)
npm run clean
```

## Code Conventions

- Source imports use `.ts` extensions; `bin/cjs-fix-imports.ts` rewrites them
  for the npm build
- `import type { Foo }` for type-only imports
- Strict TypeScript; `deno fmt` and `deno lint` are the only formatter and
  linter
- Every source file carries the Apache 2.0 license header
- Code comments are lowercase
- Code changes need tests
- Depend on the published `@nats-io/*` packages; keep other dependencies to a
  minimum. `deno.json` excludes `@nats-io/*` from Deno's minimum dependency age
  so a new nats.js release can be used right away

## CI

- `ci.yml` — for each changed module: `deno fmt --check`, `deno test`, and the
  npm build when the module has a `package.json`
- `nhgc.yml` — fmt, lint and tests for nhgc
- `claude.yml` — Claude Code reviews of pull requests

## Releases

Each module is released on its own by pushing a tag `<module>/v<version>`, for
example `counters/v1.0.2`. `release.yml` checks that the tag matches the
versions in `deno.json` and `package.json`, runs the tests, dry-runs jsr and
npm, then publishes to both. Versions with a qualifier (`1.0.2-0`) go to the npm
tag `next`. npm publishes with trusted publishing, so no token is involved. A
version already on a registry is skipped, so a failed release can be rerun.

To release, bump `version` in the module's `deno.json` and `package.json` (and
`npm install` to refresh `package-lock.json`), merge, then push the tag.
