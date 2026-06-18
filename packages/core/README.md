# garret-core

The pure, framework-agnostic core shared by [Garret](https://github.com/sudharsan-selvaraj/garret)
and its widgets. No React, no transport — safe to import in any realm.

Exports:
- **Types** — `WidgetManifest`, `WidgetPlugin`, `WidgetContext`, `ServiceDefinition`, …
- **Config fields** — `field` builders, `ConfigSchema`, `zodFromSchema`, `defaultConfig`
- **`GarretClient`** — the async, serializable capability interface a widget realm talks
  to the host through (the seam that lets one widget run natively or sandboxed)
- **`canonicalKey`** — stable poll-job key (must match on both sides of the boundary)
- **`defineWidget`** — identity helper that pins a plugin's config type

Most authors don't depend on this directly — install **`garret-widget-sdk`**, which
re-exports everything here plus `createSDK` and UI helpers.
