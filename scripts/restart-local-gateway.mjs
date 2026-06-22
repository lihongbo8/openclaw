#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 18789;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_BUILD_TIMEOUT_MS = 20 * 60 * 1000;

function printHelp() {
  console.log(`Usage: node scripts/restart-local-gateway.mjs [options]

Stops the local OpenClaw gateway, removes dist, rebuilds, starts the gateway,
and waits for /healthz.

Options:
  --port <number>       Gateway port. Defaults to 18789.
  --timeout-ms <ms>     Startup health timeout. Defaults to 120000.
  --build-timeout-ms <ms>
                       Build timeout. Defaults to 1200000.
  --skip-build          Do not run scripts/build-all.mjs.
  --skip-clean          Do not remove dist.
  --no-start            Stop/clean/build only; do not start gateway.
  --force               Stop any process on the port even if it is not clearly OpenClaw.
  --dry-run             Print planned actions without changing processes or files.
  -h, --help            Show this help.
`);
}

function parsePositiveInt(raw, optionName) {
  if (!/^[0-9]+$/.test(String(raw ?? ""))) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    buildTimeoutMs: DEFAULT_BUILD_TIMEOUT_MS,
    dryRun: false,
    force: false,
    port: DEFAULT_PORT,
    skipBuild: false,
    skipClean: false,
    start: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--skip-clean") {
      options.skipClean = true;
    } else if (arg === "--no-start") {
      options.start = false;
    } else if (arg === "--port") {
      i += 1;
      options.port = parsePositiveInt(argv[i], "--port");
    } else if (arg === "--timeout-ms") {
      i += 1;
      options.timeoutMs = parsePositiveInt(argv[i], "--timeout-ms");
    } else if (arg === "--build-timeout-ms") {
      i += 1;
      options.buildTimeoutMs = parsePositiveInt(argv[i], "--build-timeout-ms");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    killSignal: "SIGKILL",
    stdio: options.stdio ?? "pipe",
    timeout: options.timeout,
  });
}

function listPortListeners(port) {
  const result = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"]);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("p"))
    .map((line) => Number.parseInt(line.slice(1), 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

function readCommand(pid) {
  const result = run("ps", ["-p", String(pid), "-o", "command="]);
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function isOpenClawGatewayCommand(command, port) {
  if (!command) {
    return false;
  }
  const normalizedRoot = repoRoot.replaceAll("\\", "/");
  const normalizedCommand = command.replaceAll("\\", "/");
  const pointsAtThisRepo =
    normalizedCommand.includes(normalizedRoot) || normalizedCommand.includes("openclaw-base");
  const looksLikeGateway =
    normalizedCommand.includes(" gateway") || normalizedCommand.includes("dist/index.js gateway");
  const mentionsOpenClaw =
    normalizedCommand.includes("openclaw.mjs") ||
    normalizedCommand.includes("dist/index.js") ||
    normalizedCommand.includes("openclaw-base");
  const mentionsPort = normalizedCommand.includes(String(port));
  return pointsAtThisRepo && looksLikeGateway && mentionsOpenClaw && mentionsPort;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await sleep(250);
    } catch {
      return true;
    }
  }
  return false;
}

async function stopGatewayProcesses(port, options) {
  const pids = listPortListeners(port);
  if (pids.length === 0) {
    console.error(`[restart-local-gateway] no listener found on port ${port}`);
    return;
  }
  for (const pid of pids) {
    const command = readCommand(pid);
    const allowed = options.force || isOpenClawGatewayCommand(command, port);
    if (!allowed) {
      throw new Error(
        `Refusing to stop non-OpenClaw process on port ${port}: pid ${pid} ${command || "(unknown command)"}. Use --force to override.`,
      );
    }
    console.error(`[restart-local-gateway] stopping pid ${pid}: ${command || "(unknown command)"}`);
    if (options.dryRun) {
      continue;
    }
    process.kill(pid, "SIGTERM");
    if (!(await waitForExit(pid, 10_000))) {
      console.error(
        `[restart-local-gateway] pid ${pid} did not exit after SIGTERM; sending SIGKILL`,
      );
      process.kill(pid, "SIGKILL");
      if (!(await waitForExit(pid, 5_000))) {
        throw new Error(`Failed to stop gateway process pid ${pid}`);
      }
    }
  }
}

function cleanDist(options) {
  const distPath = path.resolve(repoRoot, "dist");
  const relative = path.relative(repoRoot, distPath);
  if (relative !== "dist" || distPath === repoRoot || relative.startsWith("..")) {
    throw new Error(`Unsafe dist path: ${distPath}`);
  }
  if (!existsSync(distPath)) {
    console.error("[restart-local-gateway] dist does not exist; skipping clean");
    return;
  }
  console.error(`[restart-local-gateway] removing ${distPath}`);
  if (!options.dryRun) {
    rmSync(distPath, { force: true, recursive: true });
  }
}

function buildDist(options) {
  console.error("[restart-local-gateway] building OpenClaw dist");
  if (options.dryRun) {
    return;
  }
  const result = run(process.execPath, ["scripts/build-all.mjs"], {
    stdio: "inherit",
    timeout: options.buildTimeoutMs,
  });
  if (result.error) {
    throw result.error;
  }
  const status = result.status ?? (result.signal ? 1 : 0);
  if (status !== 0) {
    throw new Error(`build failed with exit code ${status}`);
  }
}

function startGateway(port, options) {
  const entry = path.join(repoRoot, "dist", "index.js");
  if (!existsSync(entry)) {
    throw new Error(`Cannot start gateway; missing ${entry}`);
  }
  const artifactDir = path.join(repoRoot, ".artifacts");
  const logPath = path.join(artifactDir, `local-gateway-${port}.log`);
  console.error(`[restart-local-gateway] starting gateway on port ${port}`);
  console.error(`[restart-local-gateway] log: ${logPath}`);
  if (options.dryRun) {
    return;
  }
  mkdirSync(artifactDir, { recursive: true });
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [entry, "gateway", "--port", String(port)], {
    cwd: repoRoot,
    detached: true,
    env: process.env,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
}

async function waitForHealth(port, timeoutMs, options) {
  const url = `http://127.0.0.1:${port}/healthz`;
  console.error(`[restart-local-gateway] waiting for ${url}`);
  if (options.dryRun) {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.error("[restart-local-gateway] gateway health check passed");
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`gateway did not pass health check within ${timeoutMs}ms: ${lastError}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  console.error(`[restart-local-gateway] repo: ${repoRoot}`);
  console.error(`[restart-local-gateway] port: ${options.port}`);
  await stopGatewayProcesses(options.port, options);
  if (!options.skipClean) {
    cleanDist(options);
  }
  if (!options.skipBuild) {
    buildDist(options);
  }
  if (options.start) {
    startGateway(options.port, options);
    await waitForHealth(options.port, options.timeoutMs, options);
  }
  console.error("[restart-local-gateway] done");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
