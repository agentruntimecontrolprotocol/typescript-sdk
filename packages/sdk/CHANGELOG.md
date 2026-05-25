# @agentruntimecontrolprotocol/sdk

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
