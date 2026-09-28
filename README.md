# GitHidra

A fast, native desktop Git client built with [Tauri](https://tauri.app), React, and [git2-rs](https://github.com/rust-lang/git2-rs) (libgit2). GitHidra visualizes your commit graph, branches, stashes, and working-directory changes, and lets you perform everyday Git operations without leaving the app.

## Features

- Interactive commit graph with branch lanes, merge routing, and multi-select (range diff, batch cherry-pick)
- Staging panel: stage/unstage files or hunks, commit with a summary + description
- Branch management: create, checkout, rename, delete, merge, rebase (including `--rebase-merges`)
- Stashes rendered directly in the graph, with pop/apply/drop from a context menu
- Remote operations: fetch, pull, push (with safe non-fast-forward detection), fetch-all for workspaces
- Diff viewer with unified/split view, syntax-aware text diffs, and image previews
- Reset (soft/hard) to any commit, cherry-pick, checkout detached HEAD
- Multiple commit profiles (name/email) selectable per commit
- Embedded terminal (`Ctrl+'`) opened in the repository's working directory
- Workspaces: group multiple repositories under a folder, with per-repo ignore lists and "fetch all"
- Eight built-in themes (Dark, Tokyo Night, Dracula, One Dark, Nord, Gruvbox, Solarized, Catppuccin)

## Tech stack

- [Tauri v2](https://tauri.app) + Rust backend, using [git2](https://crates.io/crates/git2) (libgit2) for all Git operations
- React 19 + TypeScript + Vite
- [TanStack Query](https://tanstack.com/query) for server-state caching, Zustand for UI state
- Tailwind CSS v4

## Development

Requires [pnpm](https://pnpm.io) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform (a Rust toolchain, plus platform-specific system dependencies).

```bash
pnpm install
pnpm tauri dev
```

### Testing

```bash
# Frontend
pnpm exec tsc --noEmit
pnpm exec vitest run

# Backend
cd src-tauri
cargo check
cargo test
```

### Building

```bash
pnpm tauri build
```

## License

MIT — see [LICENSE](LICENSE).
