# gitHydra

A fast, native desktop Git client built with [Tauri](https://tauri.app), React, and [git2-rs](https://github.com/rust-lang/git2-rs) (libgit2). gitHydra visualizes your commit graph, branches, stashes, and working-directory changes, and lets you perform everyday Git operations without leaving the app.

## Features

- Interactive commit graph with branch lanes, merge routing, and multi-select (range diff, batch cherry-pick)
- Staging panel: stage/unstage/discard whole files, hunks or individual lines; add files to `.gitignore` or `.git/info/exclude`; commit with a summary + description, amend, or compose several commits
- Branch management: create, checkout, rename, delete, merge, rebase (including `--rebase-merges`)
- Interactive rebase: reorder, reword, squash, fixup and drop commits from the graph
- Revert commits (including merges, choosing the parent to keep), with the shared conflict panel
- File history (follows renames, lists deletions), blame, and compare two branches
- Stashes rendered directly in the graph, with pop/apply/drop from a context menu
- Remotes: add, rename, remove and edit several remotes; fetch one or all, push with a remote picker and safe non-fast-forward detection; periodic background auto-fetch (configurable)
- Pull with fast-forward only, merge or rebase (honours `pull.ff` / `pull.rebase`), autostash, and a behind-count badge
- Authentication: SSH keys chosen per repository or workspace with passphrase prompts, and HTTPS username/password or token (git credential helper, then a prompt); background operations never prompt
- Git hooks (pre-commit, prepare-commit-msg, commit-msg, post-commit, merge hooks) run for commits the app makes, with a per-commit "skip hooks" option
- Commit signing with SSH or GPG keys (`commit.gpgsign` or an app setting), with a signed badge in commit details
- Worktrees (list, add, remove, prune), submodules (status and update) and Git LFS (detect and `git lfs pull`)
- Undo/redo for most operations, plus reflog, tree and statistics views
- Activity Logs (`Ctrl+L`) showing every backend command, network round trip and hook run, with secrets masked
- Diff viewer with unified/split view, syntax-aware text diffs, and image previews
- Reset (soft/hard) to any commit, cherry-pick, checkout detached HEAD
- Multiple commit profiles (name/email) selectable per commit
- Embedded terminal (`Ctrl+'`) opened in the repository's working directory
- Workspaces: group multiple repositories under a folder, with per-repo ignore lists and "fetch all"
- Eight built-in themes (Dark, Tokyo Night, Dracula, One Dark, Nord, Gruvbox, Solarized, Catppuccin)

## Tech stack

- [Tauri v2](https://tauri.app) + Rust backend, using [git2](https://crates.io/crates/git2) (libgit2) for Git operations; the `git` CLI only where libgit2 can't (hooks, interactive rebase, LFS) and `ssh-keygen`/`gpg` for signing
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
