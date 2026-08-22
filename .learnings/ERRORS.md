
## 2026-08-22 — renderer obfuscator invoked from repo root
- Error: `No renderer JS found to obfuscate`
- Cause: `build-tools/obfuscate-renderer.cjs` resolves `dist` from `process.cwd()` and must run with `apps/flow_auto_electron` as cwd.
- Fix: run `cd apps/flow_auto_electron && node build-tools/obfuscate-renderer.cjs`.
