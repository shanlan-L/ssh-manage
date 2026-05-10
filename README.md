# vps-manage

`vps-manage` is a small local CLI/TUI for managing VPS SSH command snippets. It stores server connection metadata, shows entries in a terminal list, and copies the generated `ssh` command to your clipboard.

It does not open SSH sessions for you. The intended workflow is: pick a VPS, copy the command, then paste it into a separate terminal window.

## Features

- Manage VPS entries with a custom name, host/IP, port, username, and private key path.
- Add, edit, delete, and browse entries from a terminal UI.
- Copy generated SSH commands with one key.
- Store data locally in a JSON file.
- Install with a single bash command from GitHub.
- No runtime npm dependencies.

## Install

Install from GitHub:

```sh
curl -fsSL https://raw.githubusercontent.com/shanlan-L/vps-manage/main/install.sh | bash
```

If `vps-manage` is not found after installation, add `~/.local/bin` to your shell profile:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Then run:

```sh
vps-manage
```

## Requirements

- Node.js 18 or newer
- macOS, Linux, or Windows

Clipboard support uses the platform clipboard command:

- macOS: `pbcopy`
- Linux: `wl-copy`, `xclip`, or `xsel`
- Windows: `clip`

## Local Development

Run directly from this checkout:

```sh
npm start
```

Install from this local checkout:

```sh
bash install.sh
```

Use an isolated data directory while debugging:

```sh
VPS_MANAGE_HOME=/tmp/vps-manage-debug npm start
```

Check syntax:

```sh
npm run check
```

## Keys

- `n`: add a VPS
- `e`: edit the selected VPS
- `d`: delete the selected VPS
- `c` or `Enter`: copy the selected SSH command
- `j`/`k` or arrow keys: move through the list
- `Esc`: cancel add, edit, or delete confirmation
- `q`: quit

## SSH Command Format

With a private key path:

```sh
ssh -i ~/.ssh/id_rsa -p 22 root@203.0.113.10
```

Without a private key path:

```sh
ssh -p 22 root@203.0.113.10
```

Values are shell-quoted when needed before being copied.

## Data

By default, entries are saved to:

```text
~/.vps-manage/servers.json
```

Set `VPS_MANAGE_HOME` to use a different config directory:

```sh
VPS_MANAGE_HOME=/path/to/config vps-manage
```

The tool stores only connection metadata. It does not read or copy private key file contents.

## Install Options

The installer writes the executable to:

```text
~/.local/share/vps-manage/vps-manage.js
```

And creates this command symlink:

```text
~/.local/bin/vps-manage
```

To choose another command directory:

```sh
VPS_MANAGE_INSTALL_DIR=/usr/local/bin bash install.sh
```

To install from a different fork or branch:

```sh
curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/<branch>/install.sh | VPS_MANAGE_REPO=<user>/<repo> VPS_MANAGE_REF=<branch> bash
```

## Uninstall

```sh
rm -f ~/.local/bin/vps-manage
rm -rf ~/.local/share/vps-manage
```

This does not delete your VPS entries. To remove stored entries too:

```sh
rm -rf ~/.vps-manage
```

## Security Notes

- `vps-manage` does not initiate SSH connections.
- It copies commands to the clipboard only after you press the copy key.
- It stores private key paths as text, but never reads private key file contents.
- Keep `~/.vps-manage/servers.json` private if your hostnames, usernames, or key paths are sensitive.
