const test = require("node:test");
const assert = require("node:assert/strict");

const {
  VERSION,
  buildSshCommand,
  displayWidth,
  filterItems,
  fit,
  normalizeData,
  shellQuote,
  validateConnection,
  validateScript
} = require("../bin/ssh-manage.js");
const packageJson = require("../package.json");

test("keeps the CLI and package versions in sync", () => {
  assert.equal(VERSION, packageJson.version);
});

test("migrates the legacy connection array", () => {
  const data = normalizeData([
    { name: "prod", host: "203.0.113.10", port: 2222, username: "deploy" }
  ]);

  assert.equal(data.version, 2);
  assert.equal(data.connections.length, 1);
  assert.equal(data.connections[0].name, "prod");
  assert.deepEqual(data.scripts, []);
});

test("normalizes scripts in the versioned data format", () => {
  const data = normalizeData({
    version: 2,
    connections: [],
    scripts: [{ name: "uptime", command: "uptime" }]
  });

  assert.equal(data.scripts.length, 1);
  assert.equal(data.scripts[0].command, "uptime");
});

test("quotes unsafe SSH destination and key paths", () => {
  const command = buildSshCommand({
    host: "host; echo unsafe",
    port: 22,
    username: "root",
    privateKeyPath: "/tmp/my key"
  });

  assert.equal(command, "ssh -i '/tmp/my key' -p 22 'root@host; echo unsafe'");
  assert.equal(shellQuote("plain-value"), "plain-value");
});

test("filters connections and scripts across useful fields", () => {
  const connections = [
    { name: "Production", host: "10.0.0.1", username: "root", port: 22, privateKeyPath: "" },
    { name: "Staging", host: "10.0.0.2", username: "deploy", port: 2202, privateKeyPath: "" }
  ];
  const scripts = [
    { name: "Disk", description: "disk usage", command: "df -h" },
    { name: "Memory", description: "RAM usage", command: "free -m" }
  ];

  assert.equal(filterItems("connections", connections, "deploy").length, 1);
  assert.equal(filterItems("scripts", scripts, "df -h").length, 1);
});

test("validates connection ports and required script commands", () => {
  assert.equal(validateConnection({
    name: "bad",
    host: "example.com",
    port: "70000",
    username: "root",
    privateKeyPath: ""
  }).ok, false);

  assert.equal(validateConnection({
    name: "bad suffix",
    host: "example.com",
    port: "22abc",
    username: "root",
    privateKeyPath: ""
  }).ok, false);

  assert.equal(validateScript({ name: "empty", description: "", command: "" }).ok, false);
  assert.equal(validateScript({ name: "uptime", description: "", command: "uptime" }).ok, true);
});

test("measures and truncates Chinese terminal text by display width", () => {
  assert.equal(displayWidth("生产-api"), 8);
  assert.equal(fit("生产服务器", 7), "生产...");
  assert.equal(displayWidth(fit("生产服务器", 7)), 7);
});
