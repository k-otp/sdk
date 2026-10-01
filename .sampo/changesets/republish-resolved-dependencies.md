---
npm/@k-otp/sdk: patch
---
Republish with resolved dependency versions. The 1.0.0 tarball on npm declared its `@orpc/*` dependencies with unresolved `catalog:` ranges and cannot be installed; use 1.0.1 or later. The package now refuses `npm publish` from the package directory when a dependency range is unresolved.
