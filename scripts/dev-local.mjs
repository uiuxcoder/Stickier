import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executableExtension = process.platform === "win32" ? ".cmd" : "";

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Stop the existing Stickier dev process and try again.`));
        return;
      }
      reject(error);
    });
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

await Promise.all([assertPortAvailable(5173), assertPortAvailable(8788)]);

const build = spawnSync("npm", ["run", "build"], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const children = new Set();
let shuttingDown = false;
let exitCode = 0;

function stopChildren(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);
}

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });
  children.add(child);
  child.once("error", (error) => {
    console.error(`[dev] ${name} failed to start:`, error);
    exitCode = 1;
    stopChildren();
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (${signal ?? code ?? "unknown"}); stopping local development.`);
      exitCode = code ?? 1;
      stopChildren();
    }
    if (children.size === 0) process.exit(exitCode);
  });
}

process.once("SIGINT", () => {
  exitCode = 130;
  stopChildren("SIGINT");
});
process.once("SIGTERM", () => {
  exitCode = 143;
  stopChildren("SIGTERM");
});

start(
  "API worker",
  path.join(projectRoot, "node_modules", ".bin", `wrangler${executableExtension}`),
  ["dev", "--port", "8788"]
);
start(
  "frontend",
  path.join(projectRoot, "node_modules", ".bin", `vite${executableExtension}`),
  [],
  { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" }
);