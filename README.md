# Garret

**A desktop layer for developer focus.** Garret keeps the signals you care about —
pull requests waiting on you, your tickets, repo state, your calendar, the thing you
copied five minutes ago — in the dead space *around* your work, so you reach them
without breaking flow.

It's three surfaces in one app:

- **Ambient** — interactive widgets pinned **above the wallpaper, behind your app
  windows**. Always there for a glance, never in the way.
- **HUD** — a global hotkey yanks the whole layer **over everything** (including
  full-screen apps) for a quick "what needs me right now?", then dismisses.
- **Action palettes** — keyboard-summoned tools that do a thing and hand you back to
  exactly what you were doing: a **clipboard history** that pastes into the focused
  field of any app, with more to come.

The through-line: **reduce context-switching cost toward zero.**

## Widgets

| Widget | What it does |
| --- | --- |
| **Jira Tickets** | A live, filtered issue list (JQL or structured filters), inline status. |
| **Pull Requests** | Yours and ones awaiting your review — grouped by repo, with reviewers, RSVP/approval state, comment counts, age filter, and per-PR mute. |
| **Git Repos** | Multi-repo status (branch, ahead/behind, staged/modified), driven by a file watcher (not polling); open in Finder/editor. |
| **Calendar** | Google Calendar as an agenda *or* a day timeline — next-meeting highlight, attendees & RSVPs, one-click Join, plus new/cancelled and "starting soon" notifications. |
| **Dev Tools** | Offline JSON / Base64 / JWT / URL / timestamp / SHA-256 / UUID, with auto-detect — nothing leaves your machine. |
| **Snippets** | Per-tool click-to-copy cheat sheets (one widget for Git, one for your project, …). |
| **Clock · Notes · Weather · Web embed** | The essentials, plus any site as a live `<webview>`. |

## Build your own widget

Third-party widgets run **sandboxed** (isolated webview, capability-gated). Install
[`garret-widget-sdk`](https://www.npmjs.com/package/garret-widget-sdk), write a React
component, declare what it needs, and install the built folder via **Settings → Widgets**.
Full walkthrough: **[docs/widget-authoring.md](docs/widget-authoring.md)** · working example:
[`examples/sandbox-selftest`](examples/sandbox-selftest).

## Highlights

- **Free-form canvas** — drag/resize anywhere; named **layouts** you can rename and
  move/copy widgets between; per-widget color, opacity, and lock.
- **Clipboard manager** — encrypted history, summon-and-paste, image/file support.
- **Configurable global hotkeys** and a **menu-bar** presence.
- **Central polling scheduler** (coalesced, rate-limit aware) and **background
  notifications** that run even when the layer is hidden.
- **Encrypted secrets** via the macOS Keychain — tokens never touch disk in plaintext.
- **Plugin architecture** — a new widget is a manifest + a render component; the
  settings form, validation, polling, and notifications come for free.

## Stack

Electron · Vite · React · TypeScript, with a small native macOS addon (Obj-C++) for
desktop-level window pinning, HUD-over-full-screen, and clipboard paste.

## Develop

```bash
npm install
npm run setup:electron   # fetch Electron's binary (if install scripts are disabled)
npm run build:native     # build the macOS native addon
npm run dev              # launch (quit with ⌘⇧Q)
npm run build            # type-check + bundle main / preload / renderer
```

## Releases

Tagged releases ship a prebuilt macOS app (arm64) as a DMG + zip, attached to the
[GitHub Release](https://github.com/sudharsan-selvaraj/garret/releases). To cut one,
push a version tag — CI builds and uploads the artifacts:

```bash
git tag v1.0.0
git push origin v1.0.0   # → .github/workflows/release.yml builds Garret-1.0.0-arm64.dmg
```

The build is **unsigned**, so macOS Gatekeeper blocks it on first launch. On the machine that
built it, **right-click the app → Open** (or `xattr -dr com.apple.quarantine
/Applications/Garret.app`) is enough.

**On another Mac** (downloaded/AirDropped), Apple Silicon shows *"Garret is damaged and can't
be opened — move it to the Bin."* It's **not** damaged — arm64 refuses to run unsigned code, and
the download quarantine flag triggers the scariest message. Move Garret to **Applications**,
then in **Terminal**:

```bash
xattr -dr com.apple.quarantine /Applications/Garret.app   # clear the download quarantine
codesign --force --deep --sign - /Applications/Garret.app # ad-hoc sign so arm64 will run it
```

Then double-click. (On Intel Macs the first line alone usually suffices.)

The permanent fix — so recipients just double-click with no warnings or Terminal — is
**code-signing + notarization** with an Apple Developer ID ($99/yr); it's on the backlog.

To build locally instead, run `npm run pack:mac` (DMG + zip) or `npm run pack:dir`
(unpacked `.app`); output lands in `dist/`.

**Platform:** macOS first. Windows (desktop pinning via WorkerW) is on the roadmap.
