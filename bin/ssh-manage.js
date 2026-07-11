#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawnSync } = require("node:child_process");

const VERSION = "0.2.0";
const CONFIG_DIR = process.env.SSH_MANAGE_HOME || process.env.VPS_MANAGE_HOME || path.join(os.homedir(), ".ssh-manage");
const DATA_FILE = path.join(CONFIG_DIR, "data.json");
const LEGACY_DATA_FILES = [
  path.join(CONFIG_DIR, "servers.json"),
  path.join(os.homedir(), ".vps-manage", "servers.json")
];

const keys = {
  ctrlC: "\u0003",
  enter: "\r",
  lineFeed: "\n",
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
  reset: "\x1b[0m"
};

const connectionFields = [
  { key: "name", label: "Name", placeholder: "prod-api" },
  { key: "host", label: "IP / Host", placeholder: "203.0.113.10" },
  { key: "port", label: "Port", placeholder: "22" },
  { key: "username", label: "Username", placeholder: "root" },
  { key: "privateKeyPath", label: "Private key", placeholder: "~/.ssh/id_ed25519 (optional)" }
];

const scriptFields = [
  { key: "name", label: "Name", placeholder: "Check disk usage" },
  { key: "description", label: "Description", placeholder: "Quick disk and inode overview (optional)" },
  { key: "command", label: "Command", placeholder: "df -h && df -i", multiline: true }
];

const state = {
  mode: "list",
  view: "connections",
  data: createEmptyData(),
  selected: { connections: 0, scripts: 0 },
  query: "",
  message: "",
  messageKind: "info",
  form: null,
  deleteTarget: null
};

function main() {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log(VERSION);
    return;
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const loaded = loadData();
  state.data = loaded.data;
  if (loaded.notice) setMessage(loaded.notice, loaded.kind || "info");

  if (loaded.migrate) {
    const saved = saveData();
    if (!saved.ok) setMessage(`Loaded old data, but migration failed: ${saved.error}`, "error");
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("ssh-manage needs an interactive terminal.");
    process.exitCode = 1;
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", handleKeypress);
  process.stdout.on("resize", render);
  process.on("SIGTERM", quit);
  render();
}

function printHelp() {
  console.log(`ssh-manage

Usage:
  ssh-manage
  ssh-manage --version
  npm start

Views:
  Tab             Switch Connections / Scripts

Keys:
  Up/Down, j/k    Move selection
  /               Search current view
  ?               Show keyboard help
  n               Add item
  e               Edit selected item
  d               Delete selected item
  c or Enter      Copy selected command
  q               Quit

Form editing:
  Up/Down, Tab    Change field
  Left/Right      Move cursor
  Ctrl+U          Clear field
  Ctrl+J          Insert newline in a script command
  Esc             Cancel

Data:
  ${DATA_FILE}
`);
}

function createEmptyData() {
  return { version: 2, connections: [], scripts: [] };
}

function loadData() {
  const candidates = [DATA_FILE, ...LEGACY_DATA_FILES];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const data = normalizeData(parsed);
      const migrate = file !== DATA_FILE || Array.isArray(parsed) || parsed.version !== 2;
      return {
        data,
        migrate,
        notice: migrate ? `Imported existing data from ${file}` : "",
        kind: "ok"
      };
    } catch (error) {
      return {
        data: createEmptyData(),
        migrate: false,
        notice: `Could not read ${file}: ${error.message}`,
        kind: "error"
      };
    }
  }

  return { data: createEmptyData(), migrate: false, notice: "" };
}

function normalizeData(value) {
  if (Array.isArray(value)) {
    return {
      version: 2,
      connections: value.map(normalizeConnection).filter(Boolean),
      scripts: []
    };
  }

  if (!value || typeof value !== "object") return createEmptyData();
  const connections = Array.isArray(value.connections)
    ? value.connections
    : Array.isArray(value.servers)
      ? value.servers
      : [];

  return {
    version: 2,
    connections: connections.map(normalizeConnection).filter(Boolean),
    scripts: (Array.isArray(value.scripts) ? value.scripts : []).map(normalizeScript).filter(Boolean)
  };
}

function normalizeConnection(value) {
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

function normalizeScript(value) {
  if (!value || typeof value !== "object") return null;
  const command = String(value.command || value.script || "");
  if (!command.trim()) return null;
  return {
    id: String(value.id || createId()),
    name: String(value.name || "Untitled script").trim() || "Untitled script",
    description: String(value.description || "").trim(),
    command
  };
}

function saveData() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const tempFile = `${DATA_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tempFile, `${JSON.stringify(state.data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempFile, DATA_FILE);
    fs.chmodSync(DATA_FILE, 0o600);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function handleKeypress(input, key = {}) {
  if (input === keys.ctrlC || (key.ctrl && key.name === "c")) quit();

  if (state.mode === "list") handleListKey(input, key);
  else if (state.mode === "search") handleSearchKey(input, key);
  else if (state.mode === "form") handleFormKey(input, key);
  else if (state.mode === "delete") handleDeleteKey(input, key);
  else if (state.mode === "help") handleHelpKey(input, key);

  clampSelection();
  render();
}

function handleListKey(input, key) {
  if (input === "q") quit();
  if (input === "\t" || key.name === "tab") switchView();
  if (key.name === "up" || input === "k") moveSelection(-1);
  if (key.name === "down" || input === "j") moveSelection(1);
  if (key.name === "home" || input === "g") state.selected[state.view] = 0;
  if (key.name === "end" || input === "G") state.selected[state.view] = Math.max(0, getVisibleItems().length - 1);
  if (input === "/") openSearch();
  if (input === "?") state.mode = "help";
  if (isEscape(input, key) && state.query) clearSearch();
  if (input === "n") openForm();
  if (input === "e") editSelected();
  if (input === "d") confirmDelete();
  if (input === "c" || input === keys.enter) copySelected();
}

function handleHelpKey(input, key) {
  if (input === "?" || input === "q" || isEscape(input, key) || input === keys.enter) {
    state.mode = "list";
    setMessage("Help closed.", "info");
  }
}

function handleSearchKey(input, key) {
  if (isEscape(input, key)) {
    clearSearch();
    return;
  }
  if (input === keys.enter) {
    state.mode = "list";
    setMessage(state.query ? `Filter active: ${state.query}` : "Search closed.", "info");
    return;
  }
  if (input === keys.backspace || key.name === "backspace") {
    state.query = state.query.slice(0, -1);
    state.selected[state.view] = 0;
    return;
  }
  if (key.ctrl && key.name === "u") {
    state.query = "";
    state.selected[state.view] = 0;
    return;
  }
  if (isPrintable(input)) {
    state.query += input;
    state.selected[state.view] = 0;
  }
}

function handleFormKey(input, key) {
  const form = state.form;
  const field = form.fields[form.index];
  const value = form.values[field.key];

  if (isEscape(input, key)) {
    closeForm("Cancelled.");
    return;
  }
  if (key.name === "up") {
    selectFormField(Math.max(0, form.index - 1));
    return;
  }
  if (key.name === "down" || input === "\t") {
    selectFormField((form.index + 1) % form.fields.length);
    return;
  }
  if (key.name === "left") {
    form.cursor = Math.max(0, form.cursor - 1);
    return;
  }
  if (key.name === "right") {
    form.cursor = Math.min(value.length, form.cursor + 1);
    return;
  }
  if (key.name === "home") {
    form.cursor = 0;
    return;
  }
  if (key.name === "end") {
    form.cursor = value.length;
    return;
  }
  if (key.ctrl && key.name === "u") {
    form.values[field.key] = "";
    form.cursor = 0;
    return;
  }
  if (input === keys.enter) {
    if (form.index < form.fields.length - 1) selectFormField(form.index + 1);
    else submitForm();
    return;
  }
  if (field.multiline && input === keys.lineFeed) {
    insertFormText("\n");
    return;
  }
  if (input === keys.backspace || key.name === "backspace") {
    if (form.cursor > 0) {
      form.values[field.key] = value.slice(0, form.cursor - 1) + value.slice(form.cursor);
      form.cursor -= 1;
    }
    return;
  }
  if (key.name === "delete") {
    form.values[field.key] = value.slice(0, form.cursor) + value.slice(form.cursor + 1);
    return;
  }
  if (isPrintable(input)) insertFormText(input);
}

function handleDeleteKey(input, key) {
  if (input === "y" || input === "Y") {
    const target = state.deleteTarget;
    const collection = state.data[target.view];
    const index = collection.findIndex((item) => item.id === target.id);
    if (index !== -1) collection.splice(index, 1);
    const saved = saveData();
    state.mode = "list";
    state.deleteTarget = null;
    setMessage(saved.ok ? `Deleted "${target.name}".` : `Deleted in memory, but save failed: ${saved.error}`, saved.ok ? "ok" : "error");
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

function isPrintable(input) {
  return typeof input === "string" && input.length > 0 && !input.includes("\r") && !input.includes("\n") && [...input].every((char) => char >= " ");
}

function switchView() {
  state.view = state.view === "connections" ? "scripts" : "connections";
  state.query = "";
  state.mode = "list";
  setMessage(state.view === "connections" ? "Connections" : "Scripts", "info");
}

function openSearch() {
  state.mode = "search";
  state.query = "";
  state.selected[state.view] = 0;
  setMessage("Type to filter. Enter keeps the filter; Esc clears it.", "info");
}

function clearSearch() {
  state.mode = "list";
  state.query = "";
  state.selected[state.view] = 0;
  setMessage("Search cleared.", "info");
}

function moveSelection(offset) {
  state.selected[state.view] += offset;
}

function getCollection(view = state.view) {
  return state.data[view];
}

function getVisibleItems(view = state.view, query = state.query) {
  return filterItems(view, getCollection(view), query);
}

function filterItems(view, items, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    const values = view === "connections"
      ? [item.name, item.host, item.username, item.port, item.privateKeyPath]
      : [item.name, item.description, item.command];
    return values.some((value) => String(value || "").toLowerCase().includes(needle));
  });
}

function getSelectedItem() {
  return getVisibleItems()[state.selected[state.view]] || null;
}

function openForm(item = null) {
  const isConnection = state.view === "connections";
  const fields = isConnection ? connectionFields : scriptFields;
  const values = isConnection
    ? {
        name: item ? item.name : "",
        host: item ? item.host : "",
        port: item ? String(item.port) : "22",
        username: item ? item.username : "root",
        privateKeyPath: item ? item.privateKeyPath : ""
      }
    : {
        name: item ? item.name : "",
        description: item ? item.description : "",
        command: item ? item.command : ""
      };

  state.mode = "form";
  state.form = {
    view: state.view,
    editingId: item ? item.id : null,
    fields,
    index: 0,
    cursor: values[fields[0].key].length,
    values
  };
  setMessage(item ? "Editing item. Enter saves on the last field." : "Adding item. Enter saves on the last field.", "info");
}

function selectFormField(index) {
  state.form.index = index;
  const field = state.form.fields[index];
  state.form.cursor = state.form.values[field.key].length;
}

function insertFormText(text) {
  const form = state.form;
  const field = form.fields[form.index];
  const value = form.values[field.key];
  form.values[field.key] = value.slice(0, form.cursor) + text + value.slice(form.cursor);
  form.cursor += text.length;
}

function editSelected() {
  const item = getSelectedItem();
  if (!item) {
    setMessage("Nothing to edit. Press n to add an item.", "warn");
    return;
  }
  openForm(item);
}

function confirmDelete() {
  const item = getSelectedItem();
  if (!item) {
    setMessage("Nothing to delete.", "warn");
    return;
  }
  state.mode = "delete";
  state.deleteTarget = { view: state.view, id: item.id, name: item.name };
  setMessage(`Delete "${item.name}"? Press y to confirm, n to cancel.`, "warn");
}

function submitForm() {
  const form = state.form;
  const values = form.values;
  const item = form.view === "connections" ? validateConnection(values) : validateScript(values);
  if (!item.ok) {
    setMessage(item.error, "error");
    selectFormField(item.field);
    return;
  }

  const collection = state.data[form.view];
  const record = { id: form.editingId || createId(), ...item.value };
  if (form.editingId) {
    const index = collection.findIndex((entry) => entry.id === form.editingId);
    if (index !== -1) collection[index] = record;
  } else {
    collection.push(record);
  }

  const saved = saveData();
  state.mode = "list";
  state.form = null;
  state.query = "";
  const visibleIndex = getVisibleItems(form.view, "").findIndex((entry) => entry.id === record.id);
  state.selected[form.view] = Math.max(0, visibleIndex);
  const action = form.editingId ? "Updated" : "Added";
  setMessage(saved.ok ? `${action} "${record.name}".` : `${action} in memory, but save failed: ${saved.error}`, saved.ok ? "ok" : "error");
}

function validateConnection(values) {
  const name = values.name.trim();
  const host = values.host.trim();
  const username = values.username.trim() || "root";
  const portText = values.port.trim();
  const port = /^\d+$/.test(portText) ? Number(portText) : Number.NaN;
  if (!name) return { ok: false, error: "Name is required.", field: 0 };
  if (!host) return { ok: false, error: "IP / Host is required.", field: 1 };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Port must be a number from 1 to 65535.", field: 2 };
  }
  return {
    ok: true,
    value: { name, host, port, username, privateKeyPath: values.privateKeyPath.trim() }
  };
}

function validateScript(values) {
  const name = values.name.trim();
  const command = values.command.trim();
  if (!name) return { ok: false, error: "Name is required.", field: 0 };
  if (!command) return { ok: false, error: "Command is required.", field: 2 };
  return {
    ok: true,
    value: { name, description: values.description.trim(), command }
  };
}

function closeForm(message) {
  state.mode = "list";
  state.form = null;
  setMessage(message, "info");
}

function copySelected() {
  const item = getSelectedItem();
  if (!item) {
    setMessage("Nothing to copy. Press n to add an item.", "warn");
    return;
  }
  const command = state.view === "connections" ? buildSshCommand(item) : item.command;
  const result = copyToClipboard(command);
  setMessage(result.ok ? `Copied "${item.name}".` : `Copy failed. ${result.error || "Clipboard command not found."}`, result.ok ? "ok" : "error");
}

function buildSshCommand(connection) {
  const parts = ["ssh"];
  if (connection.privateKeyPath) parts.push("-i", shellQuote(connection.privateKeyPath));
  parts.push("-p", String(connection.port), shellQuote(`${connection.username}@${connection.host}`));
  return parts.join(" ");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./~^-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function copyToClipboard(text) {
  const platform = os.platform();
  const commands = platform === "darwin"
    ? [["pbcopy"]]
    : platform === "win32"
      ? [["clip"]]
      : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];

  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, { input: text, encoding: "utf8" });
    if (result.status === 0) return { ok: true };
  }
  return { ok: false, error: "No supported clipboard command is available." };
}

function render() {
  if (!process.stdout.isTTY) return;
  const width = Math.max(44, process.stdout.columns || 100);
  const lines = ["\x1b[?25l\x1b[2J\x1b[H"];
  lines.push(renderHeader(width));
  lines.push(repeat("-", width));

  if (state.mode === "form") lines.push(renderForm(width));
  else if (state.mode === "help") lines.push(renderHelpPanel(width));
  else {
    lines.push(renderList(width));
    if (state.mode === "delete") lines.push("", `${colors.yellow}Delete confirmation: y = yes, n/Esc = cancel${colors.reset}`);
  }

  lines.push("");
  lines.push(renderMessage(width));
  lines.push(renderHelp(width));
  process.stdout.write(lines.join("\n"));
}

function renderHelpPanel(width) {
  const shortcuts = [
    ["Tab", "Switch Connections / Scripts"],
    ["j / k, arrows", "Move through the current list"],
    ["g / G", "Jump to the first / last item"],
    ["/", "Search names, hosts, descriptions and commands"],
    ["n / e / d", "Add, edit or delete an item"],
    ["c / Enter", "Copy the selected SSH command or script"],
    ["Esc", "Clear search or cancel the current action"],
    ["q", "Quit ssh-manage"],
    ["", ""],
    ["Form: Tab", "Move to the next field"],
    ["Form: arrows", "Change field or move the text cursor"],
    ["Form: Ctrl+U", "Clear the active field"],
    ["Form: Ctrl+J", "Insert a newline in a script command"]
  ];
  const keyWidth = Math.min(18, Math.max(14, Math.floor(width * 0.25)));
  const rows = [`${colors.bold}Keyboard help${colors.reset}`, ""];
  for (const [key, description] of shortcuts) {
    if (!key) rows.push("");
    else rows.push(`  ${colors.cyan}${pad(key, keyWidth)}${colors.reset} ${fit(description, Math.max(16, width - keyWidth - 4))}`);
  }
  rows.push("", `${colors.dim}Press ?, Esc, Enter or q to return.${colors.reset}`);
  return rows.join("\n");
}

function renderHeader(width) {
  const connectionTab = renderTab("Connections", state.data.connections.length, state.view === "connections");
  const scriptTab = renderTab("Scripts", state.data.scripts.length, state.view === "scripts");
  const title = `${colors.bold}SSH MANAGE${colors.reset}`;
  const pathText = width >= 90 ? `  ${colors.dim}${DATA_FILE}${colors.reset}` : "";
  return `${title}  ${connectionTab}  ${scriptTab}${pathText}`;
}

function renderTab(label, count, active) {
  const text = `[${label} ${count}]`;
  return active ? `${colors.cyan}${colors.bold}${text}${colors.reset}` : `${colors.dim}${text}${colors.reset}`;
}

function renderList(width) {
  const items = getVisibleItems();
  const rows = [];
  if (state.mode === "search" || state.query) {
    const query = state.query || "";
    rows.push(`${colors.cyan}/${colors.reset} ${query}${state.mode === "search" ? `${colors.cyan}_${colors.reset}` : ""} ${colors.dim}(${items.length} matches)${colors.reset}`, "");
  }

  if (items.length === 0) {
    rows.push(`${colors.dim}${state.query ? "No matching items." : `No ${state.view === "connections" ? "connections" : "scripts"} yet.`}${colors.reset}`);
    rows.push("", `Press ${colors.bold}n${colors.reset} to add one${state.query ? ` or ${colors.bold}Esc${colors.reset} to clear the search` : ""}.`);
    return rows.join("\n");
  }

  const terminalRows = process.stdout.rows || 30;
  const maxRows = Math.max(3, terminalRows - (state.query ? 14 : 12));
  const selected = state.selected[state.view];
  const start = Math.max(0, Math.min(selected - Math.floor(maxRows / 2), items.length - maxRows));
  const visible = items.slice(start, start + maxRows);

  rows.push(state.view === "connections" ? renderConnectionHeader(width) : renderScriptHeader(width));
  visible.forEach((item, offset) => {
    const index = start + offset;
    rows.push(state.view === "connections"
      ? renderConnectionRow(item, index, selected, width)
      : renderScriptRow(item, index, selected, width));
  });

  if (items.length > maxRows) rows.push(`${colors.dim}Showing ${start + 1}-${Math.min(start + maxRows, items.length)} of ${items.length}${colors.reset}`);
  rows.push("", renderPreview(items[selected], width));
  return rows.join("\n");
}

function renderConnectionHeader(width) {
  if (width < 72) return `${colors.dim}  ${pad("NAME", 18)} TARGET${colors.reset}`;
  return `${colors.dim}  ${pad("NAME", 20)} ${pad("TARGET", 30)} ${pad("PORT", 7)} KEY${colors.reset}`;
}

function renderConnectionRow(item, index, selected, width) {
  const active = index === selected;
  const marker = active ? `${colors.cyan}>${colors.reset}` : " ";
  const name = fit(item.name, width < 72 ? 18 : 20);
  const target = `${item.username}@${item.host}`;
  const content = width < 72
    ? `${pad(name, 18)} ${fit(target, Math.max(12, width - 23))}`
    : `${pad(name, 20)} ${pad(fit(target, 30), 30)} ${pad(String(item.port), 7)} ${item.privateKeyPath ? fit(path.basename(item.privateKeyPath), Math.max(6, width - 63)) : "-"}`;
  return active ? `${marker} ${colors.bold}${colors.white}${content}${colors.reset}` : `${marker} ${content}`;
}

function renderScriptHeader(width) {
  return `${colors.dim}  ${pad("NAME", Math.min(24, Math.floor(width * 0.3)))} DESCRIPTION${colors.reset}`;
}

function renderScriptRow(item, index, selected, width) {
  const active = index === selected;
  const marker = active ? `${colors.cyan}>${colors.reset}` : " ";
  const nameWidth = Math.min(24, Math.floor(width * 0.3));
  const description = item.description || firstLine(item.command);
  const content = `${pad(fit(item.name, nameWidth), nameWidth)} ${fit(description, Math.max(12, width - nameWidth - 4))}`;
  return active ? `${marker} ${colors.bold}${colors.white}${content}${colors.reset}` : `${marker} ${content}`;
}

function renderPreview(item, width) {
  if (!item) return "";
  const command = state.view === "connections" ? buildSshCommand(item) : item.command;
  const heading = state.view === "connections" ? "SSH command" : item.description || "Script command";
  const wrapped = wrapText(command, Math.max(20, width - 2)).slice(0, 4);
  return [`${colors.bold}${heading}${colors.reset}`, ...wrapped.map((line) => `${colors.cyan}${line}${colors.reset}`)].join("\n");
}

function renderForm(width) {
  const form = state.form;
  const noun = form.view === "connections" ? "connection" : "script";
  const title = form.editingId ? `Edit ${noun}` : `Add ${noun}`;
  const rows = [`${colors.bold}${title}${colors.reset}`, ""];
  const valueWidth = Math.max(20, width - 18);

  form.fields.forEach((field, index) => {
    const active = index === form.index;
    const rawValue = form.values[field.key];
    const renderedValue = renderEditableValue(rawValue, active ? form.cursor : -1, valueWidth);
    const displayValue = rawValue
      ? `${colors.white}${renderedValue}${colors.reset}`
      : `${colors.faint}<${fit(field.placeholder, valueWidth)}>${colors.reset}${active ? `${colors.cyan}_${colors.reset}` : ""}`;
    const marker = active ? `${colors.cyan}>${colors.reset}` : " ";
    rows.push(`${marker} ${pad(field.label, 13)} ${displayValue}`);
  });

  rows.push("", `${colors.dim}Enter: next/save  Tab/Up/Down: field  Left/Right: cursor  Ctrl+U: clear  Esc: cancel${colors.reset}`);
  if (form.view === "scripts") rows.push(`${colors.dim}Ctrl+J inserts a newline in the command field.${colors.reset}`);
  return rows.join("\n");
}

function renderEditableValue(value, cursor, width) {
  const display = escapeInput(value);
  if (cursor < 0) return fit(display, width);

  let before = escapeInput(value.slice(0, cursor));
  const after = escapeInput(value.slice(cursor));
  while (displayWidth(before) > width - 1) before = [...before].slice(1).join("");
  const remaining = Math.max(0, width - displayWidth(before) - 1);
  return `${before}${colors.cyan}_${colors.white}${sliceToWidth(after, remaining)}`;
}

function escapeInput(value) {
  return value.replaceAll("\n", "\\n").replaceAll("\t", "\\t");
}

function renderMessage(width) {
  if (!state.message) return `${colors.dim}Ready.${colors.reset}`;
  const color = state.messageKind === "ok" ? colors.green : state.messageKind === "error" ? colors.red : state.messageKind === "warn" ? colors.yellow : colors.dim;
  return `${color}${fit(state.message, width)}${colors.reset}`;
}

function renderHelp(width) {
  let help;
  if (state.mode === "search") help = "Type: filter  Enter: keep filter  Esc: clear  Ctrl+U: clear input";
  else if (state.mode === "delete") help = "y: confirm  n/Esc: cancel";
  else if (state.mode === "form") help = "Editing form";
  else if (state.mode === "help") help = "Help";
  else help = "Tab: view  j/k: move  /: search  ?: help  n: new  e: edit  d: delete  c/Enter: copy  q: quit";
  return `${colors.dim}${fit(help, width)}${colors.reset}`;
}

function clampSelection() {
  const items = getVisibleItems();
  state.selected[state.view] = items.length === 0 ? 0 : Math.max(0, Math.min(state.selected[state.view], items.length - 1));
}

function setMessage(message, kind = "info") {
  state.message = message;
  state.messageKind = kind;
}

function fit(value, width) {
  const text = String(value ?? "").replaceAll("\n", " ");
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  if (width <= 3) return sliceToWidth(text, width);
  return `${sliceToWidth(text, width - 3)}...`;
}

function pad(value, width) {
  const text = fit(value, width);
  return text + repeat(" ", Math.max(0, width - displayWidth(text)));
}

function displayWidth(value) {
  let width = 0;
  for (const char of String(value)) width += characterWidth(char);
  return width;
}

function sliceToWidth(value, maxWidth) {
  let result = "";
  let width = 0;
  for (const char of String(value)) {
    const nextWidth = characterWidth(char);
    if (width + nextWidth > maxWidth) break;
    result += char;
    width += nextWidth;
  }
  return result;
}

function characterWidth(char) {
  const code = char.codePointAt(0);
  if (code === 0 || code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (/\p{Mark}/u.test(char)) return 0;
  if (
    code >= 0x1100 && (
      code <= 0x115f ||
      code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    )
  ) return 2;
  return 1;
}

function repeat(char, count) {
  return char.repeat(Math.max(0, count));
}

function wrapText(value, width) {
  const result = [];
  for (const sourceLine of String(value).split("\n")) {
    if (!sourceLine) {
      result.push("");
      continue;
    }
    for (let index = 0; index < sourceLine.length; index += width) result.push(sourceLine.slice(index, index + width));
  }
  return result;
}

function firstLine(value) {
  return String(value || "").split("\n")[0];
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function quit() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  VERSION,
  buildSshCommand,
  displayWidth,
  filterItems,
  fit,
  normalizeData,
  shellQuote,
  validateConnection,
  validateScript
};
