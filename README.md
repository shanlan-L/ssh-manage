# ssh-manage

`ssh-manage` 是一个本地 CLI/TUI 工具，用来管理 SSH 连接信息和常用脚本，并快速复制生成好的命令。

它不会直接连接服务器，也不会帮你打开新的终端窗口。推荐的用法是：在 `ssh-manage` 里选中一台服务器，复制命令，然后在另一个终端窗口里粘贴执行。

## 功能

- 在 `Connections` 和 `Scripts` 两个视图之间快速切换。
- 管理连接名称、IP/Host、端口、用户名、本地私钥路径。
- 保存常用命令和多行脚本，并添加名称与说明。
- 搜索连接、脚本名称、说明和命令内容。
- 在终端里新增、编辑、删除、浏览并复制内容。
- 数据只保存在本地 JSON 文件里。
- 支持通过 GitHub 一行命令安装。
- 没有运行时 npm 依赖。

## 安装

从 GitHub 安装：

```sh
curl -fsSL https://raw.githubusercontent.com/shanlan-L/ssh-manage/main/install.sh | bash
```

如果安装后提示找不到 `ssh-manage`，把 `~/.local/bin` 加到你的 shell 配置里：

```sh
export PATH="$HOME/.local/bin:$PATH"
```

然后重新打开终端，或者在当前终端里执行上面的 `export` 命令，再运行：

```sh
ssh-manage
```

查看当前版本：

```sh
ssh-manage --version
```

## 环境要求

- Node.js 18 或更新版本
- macOS、Linux 或 Windows

复制到剪贴板时会调用系统命令：

- macOS：`pbcopy`
- Linux：`wl-copy`、`xclip` 或 `xsel`
- Windows：`clip`

## 本地开发

直接从当前目录运行：

```sh
npm start
```

从本地目录安装命令：

```sh
bash install.sh
```

调试时可以使用独立的数据目录，避免影响真实配置：

```sh
SSH_MANAGE_HOME=/tmp/ssh-manage-debug npm start
```

检查脚本语法：

```sh
npm run check
```

运行测试：

```sh
npm test
```

## 快捷键

- `Tab`：切换 `Connections` / `Scripts` 视图
- `/`：搜索当前视图，`Esc` 清除搜索
- `?`：打开完整快捷键帮助
- `n`：新增连接或脚本
- `e`：编辑当前选中的内容
- `d`：删除当前选中的内容
- `c` 或 `Enter`：复制当前选中的命令
- `j` / `k` 或方向键：移动选择
- `Esc`：取消新增、编辑或删除确认
- `q`：退出

编辑表单时：

- `Tab` 或上下方向键：切换字段
- 左右方向键：移动输入光标
- `Ctrl+U`：清空当前字段
- `Ctrl+J`：在脚本命令中插入换行
- `Enter`：进入下一个字段，在最后一个字段保存

## SSH 命令格式

填写私钥路径时：

```sh
ssh -i ~/.ssh/id_rsa -p 22 root@203.0.113.10
```

不填写私钥路径时：

```sh
ssh -p 22 root@203.0.113.10
```

复制命令前，工具会对需要转义的值做 shell quote。

## 数据位置

默认数据文件：

```text
~/.ssh-manage/data.json
```

可以通过 `SSH_MANAGE_HOME` 指定其他配置目录：

```sh
SSH_MANAGE_HOME=/path/to/config ssh-manage
```

连接和脚本保存在同一个版本化 JSON 文件里。首次启动新版时，工具会自动读取并迁移下面的旧数据文件：

```text
~/.ssh-manage/servers.json
~/.vps-manage/servers.json
```

迁移后不会主动删除旧文件。确认新版数据正常后，可以自行清理旧目录。

为了兼容旧版本，`VPS_MANAGE_HOME` 也仍然可用，但新配置建议使用 `SSH_MANAGE_HOME`。

工具只保存连接元信息，不会读取、上传或复制私钥文件内容。

## 安装位置

安装脚本会把可执行文件写入：

```text
~/.local/share/ssh-manage/ssh-manage.js
```

并创建命令软链接：

```text
~/.local/bin/ssh-manage
```

如果想安装到其他目录：

```sh
SSH_MANAGE_INSTALL_DIR=/usr/local/bin bash install.sh
```

旧的 `VPS_MANAGE_INSTALL_DIR` 和 `VPS_MANAGE_APP_DIR` 仍然兼容，但建议新安装使用 `SSH_MANAGE_*` 环境变量。

如果从 fork 或其他分支安装：

```sh
curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/<branch>/install.sh | SSH_MANAGE_REPO=<user>/<repo> SSH_MANAGE_REF=<branch> bash
```

## 卸载

只卸载命令：

```sh
rm -f ~/.local/bin/ssh-manage
rm -rf ~/.local/share/ssh-manage
```

如果也要删除本地 SSH 配置：

```sh
rm -rf ~/.ssh-manage
```

如果你之前安装过旧版 `vps-manage`，可以额外清理旧命令：

```sh
rm -f ~/.local/bin/vps-manage
rm -rf ~/.local/share/vps-manage
```

## 404 排查

如果安装命令返回 404：

```text
curl: (56) The requested URL returned error: 404
```

通常是下面几种原因：

- GitHub 仓库还不是公开仓库。
- 默认分支不是 `main`，比如实际分支是 `master`。
- `install.sh` 没有推送到仓库根目录。
- 仓库名、用户名或大小写写错了。

可以先在浏览器里打开这个地址确认文件是否存在：

```text
https://raw.githubusercontent.com/shanlan-L/ssh-manage/main/install.sh
```

如果你的默认分支是 `master`，安装命令要改成：

```sh
curl -fsSL https://raw.githubusercontent.com/shanlan-L/ssh-manage/master/install.sh | SSH_MANAGE_REF=master bash
```

## 安全说明

- `ssh-manage` 不会主动发起 SSH 连接，也不会执行保存的脚本。
- 只有按下复制快捷键时，才会把命令写入剪贴板。
- 工具只保存私钥路径字符串，不读取私钥文件内容。
- 数据文件使用仅当前用户可读写的权限保存。
- 如果主机名、用户名、私钥路径或脚本内容也算敏感信息，请保护好 `~/.ssh-manage/data.json`。
