import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const cargoBin = join(homedir(), ".cargo", "bin");
const pathParts = (process.env.PATH || "").split(delimiter).filter(Boolean);
const path = existsSync(cargoBin)
  ? [cargoBin, ...pathParts.filter((part) => part !== cargoBin)].join(delimiter)
  : pathParts.join(delimiter);
const localTauri = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri"
);
const tauriCommand = existsSync(localTauri) ? localTauri : "tauri";

const child = spawn(tauriCommand, process.argv.slice(2), {
  env: { ...process.env, PATH: path },
  shell: process.platform === "win32",
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(`Unable to start Tauri: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
