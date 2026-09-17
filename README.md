# Strudel (Krzys's fork)

A personal, customized fork of [Strudel](https://strudel.cc) — live coding
patterns on the web — built as a standalone desktop app with
[Tauri](https://tauri.app), with a custom arrangement/performance
workflow layered on top of the stock REPL.

- Upstream project: <https://codeberg.org/uzu/strudel/>
- Upstream docs: <https://strudel.cc/learn>
- This fork: <https://github.com/kwicher/loboStrudel>

> The upstream maintainers ask that the project not be forked to GitHub,
> for the ethical reasons explained in their own README (they migrated
> away from GitHub to Codeberg). This repository is kept here as a
> personal working copy of a custom fork, not a public alternative to the
> upstream project. If you're looking for Strudel itself, use the
> Codeberg link above.

## What's different in this fork

This fork keeps the core Strudel language/engine untouched and adds a
desktop-app-oriented workflow around it:

- **Tauri v2** — the app shell was migrated from a half-finished v1→v2
  state to a complete Tauri v2 setup (plugin-based dialog/filesystem/
  clipboard access, v2 capabilities/permissions, the v2 config schema).
- **Native pattern file I/O** — open, save, and "save as…" a single
  `.strudel`/`.str` pattern file directly on disk. A pattern opened from
  (or saved to) a file has its tab title locked to that file's name; a
  new/duplicated pattern's tab stays freely editable until its first
  save. A **Recent patterns** popup (in the sidebar, under "Open pattern
  file…") lists recently opened/saved files with checkboxes, so several
  can be reopened as tabs in one go.
- **Multi-track Grid** — an arrangement/performance view alongside the
  single-pattern REPL: any number of vertical tracks, each an ordered
  horizontal queue of pattern sections that auto-advance and loop
  independently, all playing simultaneously under one shared tempo (one
  Strudel scheduler, so there's no true audio crossfade between
  sections — see the comment at the top of `patternGrid.mjs` for the
  honest limitations). Features:
  - Drag-and-drop reordering within a track, moving or Ctrl/Cmd+drag-
    copying a section between tracks, and dragging a pattern tab
    straight onto a track (or onto empty grid space, to start a brand
    new track) to queue it.
  - Per-track and per-section mute/enable, and a live progress line on
    the currently-playing section.
  - Save a whole track — its patterns, in order, with their cycle counts
    — as one `.strudeltrack` file; opening one rebuilds the track and
    loads every pattern in it as its own tab.
- **Version-labeled pattern history** — saved snapshots are labeled V1,
  V2, … in order, and any historical version can be forked out into its
  own separate saved pattern without touching the current one.
- **In-app sidebar navigation** — replaces the native OS menu bar with a
  persistent left sidebar: new/duplicate/delete pattern, native file
  open/save/recent-files, panel switching, and JSON import/export of
  every saved pattern.
- A handful of smaller fixes: the panic shortcut (`Ctrl+Shift+.`) now
  works regardless of which element has focus, not just the code editor;
  the Toolbox popover (filter-sweep and Euclidean-rhythm snippet helpers)
  no longer gets visually clipped; and a data-migration fix for grid
  entries created before per-entry IDs existed, which could previously
  have their cycle counts cross-linked to unrelated entries.

## Running the web REPL locally

After cloning the project:

1. Install [Node.js](https://nodejs.org/) — see `.nvmrc` for the version
   this fork is developed against (`nvm use`, or install that version
   directly).
2. Install [pnpm](https://pnpm.io/installation).
3. Install dependencies:
   ```bash
   pnpm i
   ```
4. Run the development server:
   ```bash
   pnpm dev
   ```

## Building the standalone desktop app (Tauri)

### Prerequisites

- [Node.js](https://nodejs.org/) — version per `.nvmrc`.
- [pnpm](https://pnpm.io/installation).
- The Rust toolchain, via [rustup](https://www.rust-lang.org/tools/install)
  — Tauri compiles a native Rust binary, so `cargo`/`rustc` need to be on
  your `PATH`.
- Platform build tools: on macOS, the Xcode Command Line Tools
  (`xcode-select --install`). Tauri's own
  [prerequisites page](https://v2.tauri.app/start/prerequisites/) covers
  the Linux and Windows equivalents (WebView2 on Windows, various system
  packages on Linux).

### Install dependencies

```bash
pnpm i
```

### Development (hot-reloading desktop window)

```bash
pnpm tauri dev
```

Opens the app in a native window with the same hot-reload the web dev
server gets; most JS/JSX/CSS edits apply live without a restart.
Rust changes (anything under `src-tauri/`) and changes to
`src-tauri/tauri.conf.json` do need a full restart of this command.

### Production build (standalone app bundle)

```bash
pnpm tauri build
```

This produces a platform-native installer/bundle under
`src-tauri/target/release/bundle/` — on macOS a `.app` plus a `.dmg`, on
Linux a `.deb` and/or `.AppImage`, on Windows an `.msi`/`.exe`, depending
on what's buildable on the host platform (`"targets": "all"` in
`src-tauri/tauri.conf.json`). The unpacked, runnable app binary also
lands directly in `src-tauri/target/release/`.

Tauri doesn't support cross-compiling a macOS build from Linux/Windows
(or vice versa) — build on the platform you're targeting.

## Using Strudel in your own project

This project is organized into many [packages](./packages), also
available on [npm](https://www.npmjs.com/search?q=%40strudel). Read more
about how to use these in your own project
[here](https://strudel.cc/technical-manual/project-start).

You will need to abide by the terms of the
[GNU Affero Public Licence v3](LICENSE). As such, Strudel code can only
be shared within free/open source projects under the same license — see
the license for details.

Licensing info for the default sound banks can be found over on the
[dough-samples](https://github.com/felixroos/dough-samples/blob/main/README.md)
repository.

## Upstream contributing / community

This fork doesn't take contributions itself — see the upstream project's
[contribution guide](./CONTRIBUTING.md) and
[contributors list](https://codeberg.org/uzu/strudel/activity/contributors)
if you want to contribute to Strudel proper.

There is a #strudel channel on the TidalCycles discord:
<https://discord.com/invite/HGEdXmRkzT>, and questions/discussions on the
tidal club forum: <https://club.tidalcycles.org/> (shared with the
haskell/Tidal and python/Vortex siblings of this project). There's also a
mastodon account:
<a rel="me" href="https://social.toplap.org/@strudel">social.toplap.org/@strudel</a>.
