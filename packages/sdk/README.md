# @garretapp/sdk

Build widgets for **Garret** — the desktop widget layer. One SDK for a widget's UI (React hooks +
a native design system) and its optional host (raw Node).

```bash
npm install @garretapp/sdk
```

## UI (React)

`@garretapp/sdk/react` gives you hooks to talk to Garret plus a generic component library that matches
the native macOS look. Link the app-served theme once and compose:

```tsx
import { createRoot } from 'react-dom/client'
import {
  useGarret, useActive, useInstanceConfig, useOpenSettings,
  Scroll, Item, Accordion, Badge, Dot, EmptyState, ErrorState,
  SettingsPanel, FieldGroup, Field, TextInput, Select, Switch
} from '@garretapp/sdk/react'

function Widget() {
  const g = useGarret()
  const { cfg, set, loaded } = useInstanceConfig({ query: '' })
  // g.fetch (brokered), g.shared.storage/secrets, g.instanceStorage, g.openExternal, …
  return <Scroll>{/* compose Item / Badge / Dot / … */}</Scroll>
}
createRoot(document.getElementById('root')!).render(<Widget />)
```

```html
<!-- served by Garret on your widget's own origin -->
<link rel="stylesheet" href="~theme.css" />
```

**Hooks:** `useGarret`, `useActive`, `useOpenSettings`, `useInstanceConfig`, `useConfig`, `useProps`,
`useHost`, `useHostEvent`, `useStream`.

**Components (generic building blocks):** `Scroll`, `Item`, `Accordion`, `Badge`, `Dot`,
`EmptyState`, `ErrorState`, `SettingsPanel`, `FieldGroup`, `Field`, `TextInput`, `NumberInput`,
`Select`, `Switch`. Tones are generic — `neutral | accent | success | warning | danger` — you map
your domain to them.

`@garretapp/sdk/ui` exposes the same platform without React (`getGarret()`).

## Host (Node)

`@garretapp/sdk/host` — `defineHost()` for widgets that ship a raw-Node backend (spawn processes,
native deps). Optional; pure-UI widgets don't need it.

## Capabilities

A widget declares what it can reach in its `garret.manifest.json` (`network:<host>`, `secrets`,
`openExternal`, `embed`, `windows`, …); Garret enforces them in its main process.

MIT © Sudharsan Selvaraj
