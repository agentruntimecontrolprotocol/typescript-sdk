# @agentruntimecontrolprotocol/sdk

## 2.0.0

### Patch Changes

- Updated dependencies [543b38b]
  - @agentruntimecontrolprotocol/runtime@2.0.0
  - @agentruntimecontrolprotocol/client@2.0.0

## 1.0.2

### Patch Changes

- 6834cd9: fix(publish): pack with `pnpm pack` before `npm publish` so internal `workspace:*` deps resolve to concrete versions in the published manifest. 1.0.1 shipped `workspace:*` unresolved and failed to install with `EUNSUPPORTEDPROTOCOL`.

## 1.0.1

### Patch Changes

- Add the package README to the published npm tarball.

## 1.0.0

### Minor Changes

- Publish the middleware packages (`@agentruntimecontrolprotocol/node`, `/express`, `/fastify`, `/hono`, `/bun`, `/middleware-otel`) to npm for the first time, and start mirroring every published package to GitHub Packages alongside npm. The publish workflow now walks `packages/middleware/*` so middleware manifests are no longer silently skipped.

### Patch Changes

- Updated dependencies
  - @agentruntimecontrolprotocol/core@1.0.0
  - @agentruntimecontrolprotocol/runtime@1.0.0
  - @agentruntimecontrolprotocol/client@1.0.0
