# Sandbox Self-Test widget

A sandboxed third-party widget that probes each capability on render and reports
PASS/blocked — adding it visually runs the Phase-3 sandbox acceptance suite.

It declares `network:api.github.com`, `network:localtest.me` (which resolves to
127.0.0.1, to exercise the resolved-IP rebind gate), and `openExternal`.

## Build & stage

```bash
npm run build:selftest        # bundle src/index.tsx → bundle.js (its React + the SDK)
# stage into the app's installed-widgets dir:
mkdir -p "$HOME/Library/Application Support/garret/widgets/sandbox-selftest"
cp index.html bundle.js manifest.json "$HOME/Library/Application Support/garret/widgets/sandbox-selftest/"
```

Restart Garret, open **+ Add → Sandbox Self-Test**, drop it on the board, and read the
report. Expected:

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
