import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

const hasTauriIpc = Boolean(window.__TAURI_INTERNALS__ || window.__TAURI_IPC__);
const previewStorageKey = "ssh-manage-preview-data";

const emptyConnection = {
  id: "",
  name: "",
  host: "",
  port: 22,
  username: "root",
  privateKeyPath: ""
};

const emptyScript = {
  id: "",
  name: "",
  description: "",
  command: ""
};

const state = {
  data: { version: 2, connections: [], scripts: [] },
  dataFile: "",
  view: "connections",
  query: "",
  selectedId: "",
  editing: null,
  toast: { text: "Ready", kind: "info" },
  confirmDelete: null
};

const app = document.querySelector("#app");

async function callCommand(command, args = {}) {
  if (hasTauriIpc) return invoke(command, args);
  return previewCommand(command, args);
}

function readPreviewData() {
  try {
    return JSON.parse(localStorage.getItem(previewStorageKey)) || { version: 2, connections: [], scripts: [] };
  } catch {
    return { version: 2, connections: [], scripts: [] };
  }
}

function writePreviewData(data) {
  localStorage.setItem(previewStorageKey, JSON.stringify(data));
}

async function previewCommand(command, args) {
  const data = readPreviewData();
  if (command === "load_state") {
    return {
      data,
      data_file: "Browser preview, Tauri uses ~/.ssh-manage/data.json",
      notice: "浏览器预览模式"
    };
  }
  if (command === "save_connection") {
    const record = normalizePreviewConnection(args.input);
    const index = data.connections.findIndex((item) => item.id === record.id);
    if (index >= 0) data.connections[index] = record;
    else data.connections.push(record);
    writePreviewData(data);
    return { data, saved_id: record.id, saved_name: record.name };
  }
  if (command === "save_script") {
    const record = normalizePreviewScript(args.input);
    const index = data.scripts.findIndex((item) => item.id === record.id);
    if (index >= 0) data.scripts[index] = record;
    else data.scripts.push(record);
    writePreviewData(data);
    return { data, saved_id: record.id, saved_name: record.name };
  }
  if (command === "delete_item") {
    if (args.view === "connections") data.connections = data.connections.filter((item) => item.id !== args.id);
    if (args.view === "scripts") data.scripts = data.scripts.filter((item) => item.id !== args.id);
    writePreviewData(data);
    return { data, data_file: "Browser preview", notice: "" };
  }
  throw new Error(`Unsupported preview command: ${command}`);
}

function normalizePreviewConnection(input) {
  const name = String(input.name || "").trim();
  const host = String(input.host || "").trim();
  const port = Number(input.port);
  if (!name) throw new Error("名称不能为空");
  if (!host) throw new Error("IP / Host 不能为空");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须在 1 到 65535 之间");
  return {
    id: input.id || `preview-${Date.now().toString(36)}`,
    name,
    host,
    port,
    username: String(input.username || "root").trim() || "root",
    privateKeyPath: String(input.privateKeyPath || "").trim()
  };
}

function normalizePreviewScript(input) {
  const name = String(input.name || "").trim();
  const command = String(input.command || "").trim();
  if (!name) throw new Error("名称不能为空");
  if (!command) throw new Error("命令不能为空");
  return {
    id: input.id || `preview-${Date.now().toString(36)}`,
    name,
    description: String(input.description || "").trim(),
    command
  };
}

function collection() {
  return state.view === "connections" ? state.data.connections : state.data.scripts;
}

function visibleItems() {
  const needle = state.query.trim().toLowerCase();
  const items = collection();
  if (!needle) return items;
  return items.filter((item) => {
    const values = state.view === "connections"
      ? [item.name, item.host, item.username, item.port, item.privateKeyPath]
      : [item.name, item.description, item.command];
    return values.some((value) => String(value || "").toLowerCase().includes(needle));
  });
}

function selectedItem() {
  const items = visibleItems();
  return items.find((item) => item.id === state.selectedId) || items[0] || null;
}

function setToast(text, kind = "info") {
  state.toast = { text, kind };
}

async function loadData() {
  try {
    const result = await callCommand("load_state");
    state.data = result.data;
    state.dataFile = result.data_file;
    state.selectedId = selectedItem()?.id || "";
    setToast(result.notice || "本地数据已加载", result.notice ? "ok" : "info");
  } catch (error) {
    setToast(String(error), "error");
  }
  render();
}

async function setupTrayActions() {
  if (!hasTauriIpc) return;
  await listen("tray-action", ({ payload }) => {
    if (payload === "new-connection") {
      state.view = "connections";
      state.selectedId = state.data.connections[0]?.id || "";
      openEditor();
    }
    if (payload === "new-script") {
      state.view = "scripts";
      state.selectedId = state.data.scripts[0]?.id || "";
      openEditor();
    }
  });
}

function buildSshCommand(connection) {
  const parts = ["ssh"];
  if (connection.privateKeyPath) parts.push("-i", shellQuote(connection.privateKeyPath));
  parts.push("-p", String(connection.port), shellQuote(`${connection.username}@${connection.host}`));
  return parts.join(" ");
}

function shellQuote(value) {
  return /^[A-Za-z0-9_@%+=:,./~^-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function commandFor(item) {
  if (!item) return "";
  return state.view === "connections" ? buildSshCommand(item) : item.command;
}

function openEditor(item = null) {
  state.editing = {
    view: state.view,
    values: state.view === "connections"
      ? { ...emptyConnection, ...(item || {}) }
      : { ...emptyScript, ...(item || {}) },
    errors: {}
  };
  state.confirmDelete = null;
  render();
}

function closeEditor() {
  state.editing = null;
  render();
}

async function saveEditor(event) {
  event.preventDefault();
  if (!state.editing) return;
  const form = new FormData(event.currentTarget);
  const values = Object.fromEntries(form.entries());
  values.id = state.editing.values.id;
  if (state.editing.view === "connections") values.port = Number(values.port);

  try {
    const command = state.editing.view === "connections" ? "save_connection" : "save_script";
    const result = await callCommand(command, { input: values });
    state.data = result.data;
    state.selectedId = result.saved_id;
    state.editing = null;
    setToast(`已保存 ${result.saved_name}`, "ok");
  } catch (error) {
    setToast(String(error), "error");
  }
  render();
}

async function deleteCurrent() {
  const item = selectedItem();
  if (!item) return;
  try {
    const result = await callCommand("delete_item", { view: state.view, id: item.id });
    state.data = result.data;
    state.selectedId = selectedItem()?.id || "";
    state.confirmDelete = null;
    setToast(`已删除 ${item.name}`, "ok");
  } catch (error) {
    setToast(String(error), "error");
  }
  render();
}

async function copyCurrent() {
  const item = selectedItem();
  if (!item) {
    setToast("没有可复制的项目", "warn");
    render();
    return;
  }
  const command = commandFor(item);
  try {
    await navigator.clipboard.writeText(command);
    setToast(`已复制 ${item.name}`, "ok");
  } catch {
    setToast("无法写入剪贴板，请手动复制预览命令", "error");
  }
  render();
}

function render() {
  const items = visibleItems();
  const selected = selectedItem();
  if (!state.selectedId && selected) state.selectedId = selected.id;

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" aria-label="资源">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">SM</div>
          <div>
            <p>ssh-manage</p>
            <span>本地命令工作台</span>
          </div>
        </div>

        <div class="segmented" role="tablist" aria-label="视图">
          ${tabButton("connections", "连接", state.data.connections.length)}
          ${tabButton("scripts", "脚本", state.data.scripts.length)}
        </div>

        <label class="search">
          <span>搜索</span>
          <input id="search-input" value="${escapeHtml(state.query)}" placeholder="名称、主机、命令" />
        </label>

        <div class="list" role="listbox" aria-label="${state.view === "connections" ? "连接列表" : "脚本列表"}">
          ${items.length ? items.map((item) => listItem(item, selected?.id === item.id)).join("") : emptyList()}
        </div>

        <button class="primary action-wide" id="new-item" type="button">新增${state.view === "connections" ? "连接" : "脚本"}</button>
      </aside>

      <main class="workspace" id="main-content">
        <section class="topbar">
          <div>
            <p class="eyebrow">${state.view === "connections" ? "Connections" : "Scripts"}</p>
            <h1>${selected ? escapeHtml(selected.name) : "还没有项目"}</h1>
          </div>
          <div class="toolbar" aria-label="操作">
            <button id="copy-item" class="clay-button" type="button" ${selected ? "" : "disabled"}>复制</button>
            <button id="edit-item" class="clay-button" type="button" ${selected ? "" : "disabled"}>编辑</button>
            <button id="delete-item" class="danger-button" type="button" ${selected ? "" : "disabled"}>删除</button>
          </div>
        </section>

        <section class="command-stage" aria-label="命令预览">
          <div class="stage-header">
            <span>${state.view === "connections" ? "SSH command" : "Script command"}</span>
            <span>${selected ? "可复制" : "等待新增"}</span>
          </div>
          <pre>${escapeHtml(commandFor(selected) || "新增一条连接或脚本后，这里会显示可复制命令。")}</pre>
        </section>

        <section class="detail-grid">
          ${detailPanel(selected)}
          ${localPanel()}
        </section>
      </main>
    </div>

    ${state.editing ? editorOverlay() : ""}
    ${state.confirmDelete ? deleteOverlay() : ""}
    <div class="toast ${state.toast.kind}" role="status">${escapeHtml(state.toast.text)}</div>
  `;

  bindEvents();
}

function tabButton(view, label, count) {
  const active = state.view === view;
  return `<button class="${active ? "active" : ""}" data-view="${view}" role="tab" aria-selected="${active}" type="button">
    <span>${label}</span><strong>${count}</strong>
  </button>`;
}

function listItem(item, active) {
  const subtitle = state.view === "connections"
    ? `${item.username}@${item.host}:${item.port}`
    : item.description || firstLine(item.command);
  return `<button class="list-item ${active ? "active" : ""}" data-id="${escapeHtml(item.id)}" role="option" aria-selected="${active}" type="button">
    <span>${escapeHtml(item.name)}</span>
    <small>${escapeHtml(subtitle)}</small>
  </button>`;
}

function emptyList() {
  return `<div class="empty">
    <strong>${state.query ? "没有匹配结果" : "列表是空的"}</strong>
    <span>${state.query ? "换个关键词试试" : "先新增一条常用连接或脚本"}</span>
  </div>`;
}

function detailPanel(item) {
  if (!item) {
    return `<article class="soft-panel">
      <h2>详情</h2>
      <p class="muted">选择或新增项目后，这里会显示主机、端口、说明等信息。</p>
    </article>`;
  }
  if (state.view === "connections") {
    return `<article class="soft-panel">
      <h2>连接信息</h2>
      <dl>
        <div><dt>Host</dt><dd>${escapeHtml(item.host)}</dd></div>
        <div><dt>Port</dt><dd>${item.port}</dd></div>
        <div><dt>User</dt><dd>${escapeHtml(item.username)}</dd></div>
        <div><dt>Key</dt><dd>${escapeHtml(item.privateKeyPath || "未设置")}</dd></div>
      </dl>
    </article>`;
  }
  return `<article class="soft-panel">
    <h2>脚本说明</h2>
    <p>${escapeHtml(item.description || "未填写说明")}</p>
    <dl><div><dt>Lines</dt><dd>${String(item.command.split("\n").length)}</dd></div></dl>
  </article>`;
}

function localPanel() {
  return `<article class="soft-panel">
    <h2>本地数据</h2>
    <p class="path">${escapeHtml(state.dataFile || "~/.ssh-manage/data.json")}</p>
    <p class="muted">只读写本机 JSON，不读取私钥内容，不主动发起 SSH 连接。</p>
  </article>`;
}

function editorOverlay() {
  const editing = state.editing;
  const isConnection = editing.view === "connections";
  const values = editing.values;
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="${isConnection ? "编辑连接" : "编辑脚本"}">
    <form class="editor" id="editor-form">
      <header>
        <div>
          <p class="eyebrow">${values.id ? "Edit" : "New"}</p>
          <h2>${isConnection ? "连接" : "脚本"}</h2>
        </div>
        <button class="icon-button" id="close-editor" type="button" aria-label="关闭">×</button>
      </header>
      ${isConnection ? connectionFields(values) : scriptFields(values)}
      <footer>
        <button class="clay-button" id="cancel-editor" type="button">取消</button>
        <button class="primary" type="submit">保存</button>
      </footer>
    </form>
  </div>`;
}

function connectionFields(values) {
  return `
    ${field("name", "名称", values.name, "prod-api", true)}
    ${field("host", "IP / Host", values.host, "203.0.113.10", true)}
    ${field("port", "端口", values.port, "22", true, "number")}
    ${field("username", "用户名", values.username, "root", false)}
    ${field("privateKeyPath", "私钥路径", values.privateKeyPath, "~/.ssh/id_ed25519", false)}
  `;
}

function scriptFields(values) {
  return `
    ${field("name", "名称", values.name, "Check disk usage", true)}
    ${field("description", "说明", values.description, "Quick disk and inode overview", false)}
    <label class="field textarea-field">
      <span>命令</span>
      <textarea name="command" required rows="8" placeholder="df -h && df -i">${escapeHtml(values.command)}</textarea>
    </label>
  `;
}

function field(name, label, value, placeholder, required, type = "text") {
  return `<label class="field">
    <span>${label}</span>
    <input name="${name}" type="${type}" value="${escapeHtml(String(value ?? ""))}" placeholder="${placeholder}" ${required ? "required" : ""} />
  </label>`;
}

function deleteOverlay() {
  const item = state.confirmDelete;
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="删除确认">
    <div class="editor compact">
      <header><div><p class="eyebrow">Delete</p><h2>${escapeHtml(item.name)}</h2></div></header>
      <p class="muted">删除后会立即写入本地数据文件。</p>
      <footer>
        <button class="clay-button" id="cancel-delete" type="button">取消</button>
        <button class="danger-button solid" id="confirm-delete" type="button">删除</button>
      </footer>
    </div>
  </div>`;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.query = "";
      state.selectedId = selectedItem()?.id || "";
      render();
    });
  });
  document.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      render();
    });
  });
  document.querySelector("#search-input")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.selectedId = visibleItems()[0]?.id || "";
    render();
    document.querySelector("#search-input")?.focus();
  });
  document.querySelector("#new-item")?.addEventListener("click", () => openEditor());
  document.querySelector("#edit-item")?.addEventListener("click", () => selectedItem() && openEditor(selectedItem()));
  document.querySelector("#copy-item")?.addEventListener("click", copyCurrent);
  document.querySelector("#delete-item")?.addEventListener("click", () => {
    const item = selectedItem();
    if (item) {
      state.confirmDelete = item;
      render();
    }
  });
  document.querySelector("#editor-form")?.addEventListener("submit", saveEditor);
  document.querySelector("#close-editor")?.addEventListener("click", closeEditor);
  document.querySelector("#cancel-editor")?.addEventListener("click", closeEditor);
  document.querySelector("#cancel-delete")?.addEventListener("click", () => {
    state.confirmDelete = null;
    render();
  });
  document.querySelector("#confirm-delete")?.addEventListener("click", deleteCurrent);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function firstLine(value) {
  return String(value || "").split("\n")[0];
}

setupTrayActions().catch((error) => {
  setToast(`状态栏初始化失败: ${String(error)}`, "error");
  render();
});
loadData();
