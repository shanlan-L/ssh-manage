# ssh-manage

`ssh-manage` 是一个本地 SSH 命令工作台，提供 Tauri 2 桌面端和轻量 CLI/TUI。桌面端常驻系统状态栏，可以快速打开工作台、新增连接或脚本；应用只生成和复制命令，不会主动连接服务器或执行脚本。

## 主要功能

- 管理 SSH 连接名称、主机、端口、用户名和私钥路径。
- 保存常用单行命令或多行脚本。
- 搜索连接、脚本名称、说明和命令内容。
- 一键复制经过 shell quote 的 SSH 命令。
- macOS 状态栏快速入口，关闭主窗口后继续在后台运行。
- 本地 JSON 持久化，兼容旧版 `servers.json` 数据。
- 保留无运行时依赖的 CLI/TUI，适合纯终端环境。

## 桌面端

### 环境要求

- Node.js 18 或更新版本
- Rust stable，推荐通过 [rustup](https://rustup.rs/) 安装
- 当前平台的 Tauri 2 系统依赖

项目通过 `rust-toolchain.toml` 固定使用最新 stable，并自动安装 `rustfmt` 和 `clippy`。桌面端 npm 脚本会自动把 `~/.cargo/bin` 放到 PATH 前面，避免 Homebrew 的旧 Rust 覆盖 rustup 工具链。仍建议在 shell 配置中保持相同顺序：

```sh
export PATH="$HOME/.cargo/bin:$PATH"
rustup update stable
rustc --version
```

### 启动开发版

```sh
npm install
npm run desktop
```

Vite 开发服务默认运行在 `http://127.0.0.1:5173`，Tauri 会自动打开原生窗口。

### 状态栏操作

- 左键单击状态栏图标：显示并聚焦主窗口。
- 右键单击状态栏图标：打开快捷菜单。
- `打开工作台`：恢复主窗口。
- `新增连接`：打开工作台并进入连接编辑器。
- `新增脚本`：打开工作台并进入脚本编辑器。
- 关闭主窗口：隐藏到状态栏，数据和进程保持可用。
- `退出 ssh-manage`：结束应用进程。

### 构建安装包

```sh
npm run desktop:build
```

默认生成 macOS `.app`，产物位于 `src-tauri/target/release/bundle/macos/`。需要 DMG 时运行：

```sh
npm run desktop:build:dmg
```

本地构建使用 ad-hoc 签名。macOS 正式分发仍需配置 Apple Developer 签名和公证。

## CLI/TUI

从 GitHub 安装：

```sh
curl -fsSL https://raw.githubusercontent.com/shanlan-L/ssh-manage/main/install.sh | bash
```

如果安装后找不到命令，把 `~/.local/bin` 加入 PATH：

```sh
export PATH="$HOME/.local/bin:$PATH"
```

运行：

```sh
ssh-manage
ssh-manage --version
```

CLI 需要 Node.js 18 或更新版本。复制到剪贴板时会调用 macOS 的 `pbcopy`、Linux 的 `wl-copy` / `xclip` / `xsel`，或 Windows 的 `clip`。

### CLI 快捷键

- `Tab`：切换连接和脚本视图
- `/`：搜索，`Esc` 清除搜索
- `n`：新增连接或脚本
- `e`：编辑当前项目
- `d`：删除当前项目
- `c` 或 `Enter`：复制当前命令
- `j` / `k` 或方向键：移动选择
- `?`：打开快捷键帮助
- `q`：退出

## 数据与迁移

默认数据文件：

```text
~/.ssh-manage/data.json
```

桌面端与 CLI 使用同一个版本化数据文件。首次启动会自动读取并迁移：

```text
~/.ssh-manage/servers.json
~/.vps-manage/servers.json
```

迁移不会删除旧文件。可以使用 `SSH_MANAGE_HOME` 指定独立配置目录，旧的 `VPS_MANAGE_HOME` 仍兼容：

```sh
SSH_MANAGE_HOME=/tmp/ssh-manage-debug npm run desktop
SSH_MANAGE_HOME=/tmp/ssh-manage-debug npm start
```

应用只保存私钥路径字符串，不读取、复制或上传私钥文件内容。

## 开发命令

```sh
npm run desktop       # 启动 Tauri 2 开发版
npm run desktop:build # 构建桌面应用
npm run desktop:build:dmg # 构建 macOS DMG
npm run web:dev       # 只启动浏览器预览
npm run web:build     # 构建前端资源
npm run check         # 检查 CLI 语法
npm test              # 运行 Node 测试
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

浏览器预览使用 `localStorage`，不会写入真实的 `~/.ssh-manage/data.json`。

## 安全边界

- 不主动发起 SSH 连接。
- 不执行保存的脚本。
- 只有用户点击复制时才写入剪贴板。
- 数据仅保存在本机，仓库中不应提交真实服务器信息。
- 主机名、用户名和命令也可能包含敏感信息，请保护好数据文件。

## License

MIT
