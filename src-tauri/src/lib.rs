use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::fs;
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DataFile {
    version: u8,
    connections: Vec<Connection>,
    scripts: Vec<Script>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Connection {
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    #[serde(rename = "privateKeyPath")]
    private_key_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Script {
    id: String,
    name: String,
    description: String,
    command: String,
}

#[derive(Debug, Deserialize)]
struct ConnectionInput {
    id: Option<String>,
    name: String,
    host: String,
    port: u16,
    username: String,
    #[serde(rename = "privateKeyPath")]
    private_key_path: String,
}

#[derive(Debug, Deserialize)]
struct ScriptInput {
    id: Option<String>,
    name: String,
    description: String,
    command: String,
}

#[derive(Debug, Serialize)]
struct LoadResult {
    data: DataFile,
    data_file: String,
    notice: String,
}

#[derive(Debug, Serialize)]
struct SaveResult {
    data: DataFile,
    saved_id: String,
    saved_name: String,
}

fn empty_data() -> DataFile {
    DataFile {
        version: 2,
        connections: Vec::new(),
        scripts: Vec::new(),
    }
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn config_dir() -> PathBuf {
    env::var_os("SSH_MANAGE_HOME")
        .or_else(|| env::var_os("VPS_MANAGE_HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".ssh-manage"))
}

fn data_file() -> PathBuf {
    config_dir().join("data.json")
}

fn legacy_files() -> Vec<PathBuf> {
    vec![
        config_dir().join("servers.json"),
        home_dir().join(".vps-manage").join("servers.json"),
    ]
}

fn create_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("tauri-{nanos:x}")
}

fn normalize_connection(value: &Value) -> Option<Connection> {
    let host = value.get("host")?.as_str().unwrap_or("").trim().to_string();
    if host.is_empty() {
        return None;
    }
    let username = value
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or("root")
        .trim()
        .to_string();
    let port = value
        .get("port")
        .and_then(Value::as_u64)
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port > 0)
        .unwrap_or(22);
    Some(Connection {
        id: value
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(create_id),
        name: value
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(&host)
            .to_string(),
        host,
        port,
        username: if username.is_empty() {
            "root".to_string()
        } else {
            username
        },
        private_key_path: value
            .get("privateKeyPath")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
    })
}

fn normalize_script(value: &Value) -> Option<Script> {
    let command = value
        .get("command")
        .or_else(|| value.get("script"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if command.trim().is_empty() {
        return None;
    }
    Some(Script {
        id: value
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(create_id),
        name: value
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("Untitled script")
            .to_string(),
        description: value
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        command,
    })
}

fn normalize_data(value: Value) -> DataFile {
    if let Value::Array(items) = value {
        return DataFile {
            version: 2,
            connections: items.iter().filter_map(normalize_connection).collect(),
            scripts: Vec::new(),
        };
    }

    let Some(object) = value.as_object() else {
        return empty_data();
    };

    let connection_source = object
        .get("connections")
        .or_else(|| object.get("servers"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let script_source = object
        .get("scripts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    DataFile {
        version: 2,
        connections: connection_source
            .iter()
            .filter_map(normalize_connection)
            .collect(),
        scripts: script_source.iter().filter_map(normalize_script).collect(),
    }
}

fn read_data() -> Result<(DataFile, bool, String), String> {
    let primary = data_file();
    let mut candidates = vec![primary.clone()];
    candidates.extend(legacy_files());

    for file in candidates {
        if !file.exists() {
            continue;
        }
        let raw = fs::read_to_string(&file)
            .map_err(|error| format!("无法读取 {}: {error}", file.display()))?;
        let parsed: Value = serde_json::from_str(&raw)
            .map_err(|error| format!("无法解析 {}: {error}", file.display()))?;
        let migrate = file != primary
            || parsed.is_array()
            || parsed.get("version").and_then(Value::as_u64) != Some(2);
        return Ok((normalize_data(parsed), migrate, file.display().to_string()));
    }

    Ok((empty_data(), false, String::new()))
}

fn write_data(data: &DataFile) -> Result<(), String> {
    let directory = config_dir();
    let file = data_file();
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建 {}: {error}", directory.display()))?;
    let temp_file = file.with_extension(format!("json.tmp-{}", std::process::id()));
    let payload =
        serde_json::to_string_pretty(data).map_err(|error| format!("无法序列化数据: {error}"))?;
    fs::write(&temp_file, format!("{payload}\n"))
        .map_err(|error| format!("无法写入 {}: {error}", temp_file.display()))?;
    fs::rename(&temp_file, &file)
        .map_err(|error| format!("无法保存 {}: {error}", file.display()))?;
    Ok(())
}

fn validate_connection(input: ConnectionInput) -> Result<Connection, String> {
    let name = input.name.trim().to_string();
    let host = input.host.trim().to_string();
    let username = input.username.trim().to_string();
    if name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if host.is_empty() {
        return Err("IP / Host 不能为空".to_string());
    }
    if input.port == 0 {
        return Err("端口必须在 1 到 65535 之间".to_string());
    }
    Ok(Connection {
        id: input
            .id
            .filter(|id| !id.is_empty())
            .unwrap_or_else(create_id),
        name,
        host,
        port: input.port,
        username: if username.is_empty() {
            "root".to_string()
        } else {
            username
        },
        private_key_path: input.private_key_path.trim().to_string(),
    })
}

fn validate_script(input: ScriptInput) -> Result<Script, String> {
    let name = input.name.trim().to_string();
    let command = input.command.trim().to_string();
    if name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if command.is_empty() {
        return Err("命令不能为空".to_string());
    }
    Ok(Script {
        id: input
            .id
            .filter(|id| !id.is_empty())
            .unwrap_or_else(create_id),
        name,
        description: input.description.trim().to_string(),
        command,
    })
}

#[tauri::command]
fn load_state() -> Result<LoadResult, String> {
    let (data, migrate, source) = read_data()?;
    if migrate {
        write_data(&data)?;
    }
    let notice = if migrate {
        format!("已导入旧数据: {source}")
    } else {
        String::new()
    };
    Ok(LoadResult {
        data,
        data_file: data_file().display().to_string(),
        notice,
    })
}

#[tauri::command]
fn save_connection(input: ConnectionInput) -> Result<SaveResult, String> {
    let mut data = read_data()?.0;
    let record = validate_connection(input)?;
    let saved_id = record.id.clone();
    let saved_name = record.name.clone();
    if let Some(existing) = data
        .connections
        .iter_mut()
        .find(|connection| connection.id == record.id)
    {
        *existing = record;
    } else {
        data.connections.push(record);
    }
    write_data(&data)?;
    Ok(SaveResult {
        data,
        saved_id,
        saved_name,
    })
}

#[tauri::command]
fn save_script(input: ScriptInput) -> Result<SaveResult, String> {
    let mut data = read_data()?.0;
    let record = validate_script(input)?;
    let saved_id = record.id.clone();
    let saved_name = record.name.clone();
    if let Some(existing) = data
        .scripts
        .iter_mut()
        .find(|script| script.id == record.id)
    {
        *existing = record;
    } else {
        data.scripts.push(record);
    }
    write_data(&data)?;
    Ok(SaveResult {
        data,
        saved_id,
        saved_name,
    })
}

#[tauri::command]
fn delete_item(view: String, id: String) -> Result<LoadResult, String> {
    let mut data = read_data()?.0;
    match view.as_str() {
        "connections" => data.connections.retain(|connection| connection.id != id),
        "scripts" => data.scripts.retain(|script| script.id != id),
        _ => return Err("未知视图".to_string()),
    }
    write_data(&data)?;
    Ok(LoadResult {
        data,
        data_file: data_file().display().to_string(),
        notice: String::new(),
    })
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_tray_action(app: &AppHandle, action: &str) {
    show_main_window(app);
    let _ = app.emit("tray-action", action);
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开工作台", true, None::<&str>)?;
    let new_connection = MenuItem::with_id(app, "new-connection", "新增连接", true, None::<&str>)?;
    let new_script = MenuItem::with_id(app, "new-script", "新增脚本", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 ssh-manage", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &new_connection, &new_script, &separator, &quit],
    )?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("ssh-manage")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "new-connection" => emit_tray_action(app, "new-connection"),
            "new-script" => emit_tray_action(app, "new-script"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_connection,
            save_script,
            delete_item
        ])
        .run(tauri::generate_context!())
        .expect("error while running ssh-manage desktop");
}
