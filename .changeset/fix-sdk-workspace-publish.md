---
"@agentruntimecontrolprotocol/sdk": patch
---

fix(publish): pack with `pnpm pack` before `npm publish` so internal `workspace:*` deps resolve to concrete versions in the published manifest. 1.0.1 shipped `workspace:*` unresolved and failed to install with `EUNSUPPORTEDPROTOCOL`.
