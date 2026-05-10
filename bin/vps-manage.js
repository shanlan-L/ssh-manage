#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawnSync } = require("node:child_process");

const CONFIG_DIR = process.env.VPS_MANAGE_HOME || path.join(os.homedir(), ".vps-manage");
const DATA_FILE = path.join(CONFIG_DIR, "servers.json");

const keys = {
  ctrlC: "\u0003",
  enter: "\r",
  escape: "\u001b",
  backspace: "\u007f"
};

const colors = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  white: "\x1b[37m",
  faint: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  inverse: "\x1b[7m",
  reset: "\x1b[0m"
};

const fields = [
  { key: "name", label: "Name", placeholder: "prod-api" },
  { key: "host", label: "IP / Host", placeholder: "203.0.113.10" },
  { key: "port", label: "Port", placeholder: "22" },
  { key: "username", label: "Username", placeholder: "root" },
  { key: "privateKeyPath", label: "Private key", placeholder: "~/.ssh/id_rsa (optional)" }
];

const state = {
  mode: "list",
  servers: [],
  selected: 0,
  message: "",
  messageKind: "info",
  form: null,
  deleteTarget: null
};

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  state.servers = loadServers();
  render();

  if (!process.stdin.isTTY) {
    console.log("This tool needs an interactive terminal.");
    process.exit(1);
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", handleKeypress);
}

function printHelp() {
  console.log(`vps-manage

Usage:
  vps-manage
  npm start

Keys:
  Up/Down or j/k  Move selection
  n               Add VPS
  e               Edit selected VPS
  d               Delete selected VPS
  c               Copy SSH command
  q               Quit

Data:
  ${DATA_FILE}
`);
}

function loadServers() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeServer).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeServer(value) {
  if (!value || typeof value !== "object") return null;
  const host = String(value.host || "").trim();
  const username = String(value.username || "root").trim() || "root";
  const port = Number.parseInt(value.port, 10) || 22;
  if (!host) return null;

  return {
    id: String(value.id || createId()),
    name: String(value.name || host).trim() || host,
    host,
    port,
    username,
    privateKeyPath: String(value.privateKeyPath || "").trim()
  };
}

function saveServers() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(state.servers, null, 2)}\n`, "utf8");
}

function handleKeypress(input, key = {}) {
  if (input === keys.ctrlC) quit();

  if (state.mode === "list") {
    handleListKey(input, key);
  } else if (state.mode === "form") {
    handleFormKey(input, key);
  } else if (state.mode === "delete") {
    handleDeleteKey(input, key);
  }

  clampSelected();
  render();
}

function handleListKey(input, key) {
  if (input === "q") quit();
  if (key.name === "up" || input === "k") state.selected -= 1;
  if (key.name === "down" || input === "j") state.selected += 1;
  if (input === "n") openForm();
  if (input === "e") editSelected();
  if (input === "d") confirmDelete();
  if (input === "c" || input === keys.enter) copySelectedCommand();
}

function handleFormKey(input, key) {
  const form = state.form;
  const field = fields[form.index];

  if (isEscape(input, key)) {
    closeForm("Cancelled.");
    return;
  }

  if (key.name === "up") {
    form.index = Math.max(0, form.index - 1);
    return;
  }

  if (key.name === "down") {
    form.index = Math.min(fields.length - 1, form.index + 1);
    return;
  }

  if (input === keys.enter) {
    if (form.index < fields.length - 1) {
      form.index += 1;
    } else {
      submitForm();
    }
    return;
  }

  if (input === keys.backspace || key.name === "backspace") {
    form.values[field.key] = form.values[field.key].slice(0, -1);
    return;
  }

  if (input === "\t") {
    form.index = (form.index + 1) % fields.length;
    return;
  }

  if (input && input >= " " && input !== "\u007f") {
    form.values[field.key] += input;
  }
}

function handleDeleteKey(input, key) {
  if (input === "y" || input === "Y") {
    const deleted = state.servers.splice(state.selected, 1)[0];
    saveServers();
    state.mode = "list";
    state.deleteTarget = null;
    setMessage(`Deleted "${deleted.name}".`, "info");
    return;
  }

  if (input === "n" || input === "N" || isEscape(input, key) || input === "q") {
    state.mode = "list";
    state.deleteTarget = null;
    setMessage("Delete cancelled.", "info");
  }
}

function isEscape(input, key = {}) {
  return input === keys.escape || key.name === "escape" || key.sequence === keys.escape;
}

function openForm(server = null) {
  state.mode = "form";
  state.form = {
    editingId: server ? server.id : null,
    index: 0,
    values: {
      name: server ? server.name : "",
      host: server ? server.host : "",
      port: server ? String(server.port) : "22",
      username: server ? server.username : "root",
      privateKeyPath: server ? server.privateKeyPath : ""
    }
  };
  setMessage(server ? "Editing VPS. Enter saves on the last field." : "Adding VPS. Enter saves on the last field.", "info");
}

function editSelected() {
  const server = state.servers[state.selected];
  if (!server) {
    setMessage("Nothing to edit yet. Press n to add a VPS.", "warn");
    return;
  }
  openForm(server);
}

function confirmDelete() {
  const server = state.servers[state.selected];
  if (!server) {
    setMessage("Nothing to delete yet.", "warn");
    return;
  }
  state.mode = "delete";
  state.deleteTarget = server.id;
  setMessage(`Delete "${server.name}"? Press y to confirm, n to cancel.`, "warn");
}

function submitForm() {
  const values = state.form.values;
  const name = values.name.trim();
  const host = values.host.trim();
  const username = values.username.trim() || "root";
  const port = Number.parseInt(values.port, 10);
  const privateKeyPath = values.privateKeyPath.trim();

  if (!name) {
    setMessage("Name is required.", "error");
    state.form.index = 0;
    return;
  }

  if (!host) {
    setMessage("IP / Host is required.", "error");
    state.form.index = 1;
    return;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    setMessage("Port must be a number from 1 to 65535.", "error");
    state.form.index = 2;
    return;
  }

  const server = {
    id: state.form.editingId || createId(),
    name,
    host,
    port,
    username,
    privateKeyPath
  };

  if (state.form.editingId) {
    const index = state.servers.findIndex((item) => item.id === state.form.editingId);
    if (index !== -1) state.servers[index] = server;
    setMessage(`Updated "${server.name}".`, "ok");
  } else {
    state.servers.push(server);
    state.selected = state.servers.length - 1;
    setMessage(`Added "${server.name}".`, "ok");
  }

  saveServers();
  state.mode = "list";
  state.form = null;
}

function closeForm(message) {
  state.mode = "list";
  state.form = null;
  setMessage(message, "info");
}

function copySelectedCommand() {
  const server = state.servers[state.selected];
  if (!server) {
    setMessage("Nothing to copy yet. Press n to add a VPS.", "warn");
    return;
  }

  const command = buildSshCommand(server);
  const result = copyToClipboard(command);
  if (result.ok) {
    setMessage(`Copied: ${command}`, "ok");
  } else {
    setMessage(`Copy failed. Command: ${command}`, "error");
  }
}

function buildSshCommand(server) {
  const parts = ["ssh"];
  if (server.privateKeyPath) parts.push("-i", shellQuote(server.privateKeyPath));
  parts.push("-p", String(server.port), shellQuote(`${server.username}@${server.host}`));
  return parts.join(" ");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./~^-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function copyToClipboard(text) {
  const platform = os.platform();
  const commands = [];

  if (platform === "darwin") {
    commands.push(["pbcopy"]);
  } else if (platform === "win32") {
    commands.push(["clip"]);
  } else {
    commands.push(["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]);
  }

  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, { input: text, encoding: "utf8" });
    if (result.status === 0) return { ok: true };
  }

  return { ok: false };
}

function render() {
  const lines = [];
  lines.push("\x1b[2J\x1b[H");
  lines.push(`${colors.bold}VPS Manage${colors.reset} ${colors.dim}${DATA_FILE}${colors.reset}`);
  lines.push("");

  if (state.mode === "form") {
    lines.push(renderForm());
  } else {
    lines.push(renderList());
    if (state.mode === "delete") lines.push(renderDeletePrompt());
  }

  lines.push("");
  lines.push(renderMessage());
  lines.push("");
  lines.push(renderHelp());
  process.stdout.write(lines.join("\n"));
}

function renderList() {
  if (state.servers.length === 0) {
    return [
      `${colors.dim}No VPS entries yet.${colors.reset}`,
      "",
      `Press ${colors.bold}n${colors.reset} to add your first server.`
    ].join("\n");
  }

  const rows = state.servers.map((server, index) => {
    const selected = index === state.selected;
    const marker = selected ? ">" : " ";
    const command = buildSshCommand(server);
    const line = `${marker} ${pad(server.name, 18)} ${pad(server.username, 12)} ${pad(server.host, 18)} :${pad(String(server.port), 5)} ${colors.dim}${command}${colors.reset}`;
    return selected ? `${colors.inverse}${line}${colors.reset}` : line;
  });

  const selected = state.servers[state.selected];
  rows.push("");
  rows.push(`${colors.bold}Selected command${colors.reset}`);
  rows.push(selected ? buildSshCommand(selected) : "");
  return rows.join("\n");
}

function renderForm() {
  const form = state.form;
  const title = form.editingId ? "Edit VPS" : "Add VPS";
  const rows = [`${colors.bold}${title}${colors.reset}`, ""];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const active = index === form.index;
    const value = form.values[field.key];
    const displayValue = value
      ? `${colors.white}${value}${colors.reset}`
      : `${colors.faint}<${field.placeholder}>${colors.reset}`;
    const cursor = active ? `${colors.cyan}>${colors.reset}` : " ";
    rows.push(`${cursor} ${pad(field.label, 12)} ${displayValue}${active ? colors.cyan + "_" + colors.reset : ""}`);
  }

  rows.push("");
  rows.push(`${colors.dim}Enter: next/save  Up/Down: move  Esc: cancel${colors.reset}`);
  return rows.join("\n");
}

function renderDeletePrompt() {
  const server = state.servers[state.selected];
  if (!server) return "";
  return `\n${colors.yellow}Confirm delete "${server.name}"? Press y or n.${colors.reset}`;
}

function renderMessage() {
  if (!state.message) return colors.dim + "Ready." + colors.reset;
  const color = state.messageKind === "ok" ? colors.green : state.messageKind === "error" ? colors.red : state.messageKind === "warn" ? colors.yellow : colors.dim;
  return `${color}${state.message}${colors.reset}`;
}

function renderHelp() {
  if (state.mode === "list") {
    return `${colors.dim}j/k or arrows: move  n: new  e: edit  d: delete  c/enter: copy  q: quit${colors.reset}`;
  }
  if (state.mode === "delete") {
    return `${colors.dim}y: confirm  n/esc: cancel${colors.reset}`;
  }
  return `${colors.dim}Type to edit the active field.${colors.reset}`;
}

function pad(value, width) {
  const text = String(value);
  if (text.length >= width) return `${text.slice(0, width - 1)} `;
  return text + " ".repeat(width - text.length);
}

function clampSelected() {
  if (state.servers.length === 0) {
    state.selected = 0;
    return;
  }
  state.selected = Math.max(0, Math.min(state.selected, state.servers.length - 1));
}

function setMessage(message, kind = "info") {
  state.message = message;
  state.messageKind = kind;
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function quit() {
  process.stdout.write("\x1b[2J\x1b[H");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exit(0);
}

main();
