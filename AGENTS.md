# AGENTS.md

This file defines the working contract for coding agents in this repository.

## Product Contract

- `ssh-manage` is a local SSH command manager with a Tauri 2 desktop app and a Node.js CLI/TUI.
- The product generates and copies commands. It must never connect to hosts or execute saved scripts without a new, explicit product decision.
- The desktop app is a tray-resident app. Closing the main window hides it; quitting happens only through an explicit quit action.
- Desktop and CLI clients share `~/.ssh-manage/data.json` and must remain data-compatible.
- Never commit real hosts, usernames, private key paths, or saved commands from a user's local data file.

## Architecture

- `src-ui/`: framework-free Vite frontend. `main.js` owns rendering and interactions; `styles.css` owns the warm clay visual system.
- `src-tauri/`: Tauri 2 shell, tray lifecycle, IPC commands, validation, migration, and atomic JSON persistence.
- `bin/ssh-manage.js`: dependency-free Node.js CLI/TUI and its shared domain helpers.
- `test/`: Node tests for CLI behavior and data compatibility.
- `install.sh`: remote and local CLI installer.
- `scripts/tauri.mjs`: cross-platform Tauri launcher that prioritizes the rustup toolchain.

## Invariants

- Keep the data schema version at `2` unless a tested migration is added for both Rust and Node implementations.
- Preserve migration support for `~/.ssh-manage/servers.json` and `~/.vps-manage/servers.json`.
- Keep `SSH_MANAGE_HOME` as the preferred override and `VPS_MANAGE_HOME` as a compatibility fallback.
- Persist data atomically. Do not replace the Rust temporary-file-and-rename flow with direct writes.
- Treat private key paths as strings only. Never read private key contents.
- Keep custom filesystem access in Rust commands. Do not grant broad frontend filesystem or shell permissions.
- Keep the browser preview fallback in `src-ui/main.js`; it must use `localStorage`, not real user data.
- Tray actions that open editors must first show and focus the main window.
- Preserve the existing clay material direction when changing UI: warm neutral surfaces, restrained multi-color accents, compact utility layout, and responsive text fit.

## Toolchain

- Node.js 18 or newer.
- Rust latest stable via rustup. `rust-toolchain.toml` is authoritative.
- Tauri dependencies must remain on major version 2 across npm and Cargo manifests.
- `scripts/tauri.mjs` puts `$HOME/.cargo/bin` first for npm desktop commands. Do the same manually before direct Cargo commands when Homebrew Rust shadows rustup.

## Development

```sh
npm install
npm run desktop
```

Use `SSH_MANAGE_HOME=/tmp/ssh-manage-debug` for desktop or CLI testing that must not touch real user data.

## Required Verification

Run the checks relevant to every change. Before release or push, run the full set:

```sh
npm run check
npm test
npm run web:build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```

`npm run desktop:build` is the required ad-hoc-signed application build. DMG packaging is a separate `npm run desktop:build:dmg` release step because it requires macOS disk-image access and, for distribution, Apple Developer signing and notarization credentials.

For tray changes, also launch `npm run desktop` and manually verify:

1. The tray icon appears.
2. Left click restores and focuses the main window.
3. New connection and new script menu items open the matching editor.
4. Closing the window leaves the tray process running.
5. The explicit quit menu item exits the process.

For UI changes, verify the real rendered app at the normal desktop size and the narrow responsive layout. Check Chinese labels, long hostnames, command wrapping, and modal overflow.

## Change Discipline

- Keep edits scoped and follow the existing plain JavaScript and Rust patterns.
- Use structured JSON parsing and serialization, never string replacement for persisted data.
- Add tests when changing validation, migration, command generation, or schema behavior.
- Update `README.md` and this file when commands, architecture, toolchain, or product invariants change.
- Do not commit generated `dist/`, `node_modules/`, or `src-tauri/target/` content.
