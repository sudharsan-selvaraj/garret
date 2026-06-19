# Sandbox Self-Test widget

A sandboxed third-party widget that probes each capability on render and reports
PASS/blocked — adding it visually runs the Phase-3 sandbox acceptance suite.

It declares `network:api.github.com`, `network:localtest.me` (which resolves to
127.0.0.1, to exercise the resolved-IP rebind gate), and `openExternal`.

## Build & install

```bash
npm run build:selftest   # → examples/sandbox-selftest/dist/ (manifest.json + index.html + bundle.js)
```

In Garret: **Settings → Widgets → Install widget…** → pick `examples/sandbox-selftest/dist`
→ approve the consent screen. Then **+ Add → Sandbox Self-Test**, drop it on the board, and
read the report. (The install allowlist rejects `src/*.tsx`, so install the built `dist/`,
not the source folder.) Expected:

| Probe | Expected |
|---|---|
| render | ✓ mounted |
| permitted fetch (api.github.com) | ✓ 200 |
| undeclared host (example.com) | ✓ blocked |
| rebind→127.0.0.1 (localtest.me) | ✓ blocked (resolved-IP gate) |
| undeclared service (atlassian) | ✓ denied |
| services.connect | ✓ blocked (host-only) |
| storage roundtrip | ✓ value matches |
| openExternal button | shows a native confirm dialog |

Until the Phase-4 install flow exists, this is staged manually (the loader discovers any
`<userData>/widgets/<id>/manifest.json`).
