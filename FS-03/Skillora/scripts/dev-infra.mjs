#!/usr/bin/env node
/**
 * Local development infrastructure for machines without Docker.
 *
 *   node scripts/dev-infra.mjs setup   # download mongod + redis binaries (once)
 *   node scripts/dev-infra.mjs start   # start MongoDB (27017) and Redis (6379)
 *
 * Both commands are no-ops for services that are already running, so this is
 * safe to re-run. In Docker environments use `npm run infra:up` instead.
 *
 * Binaries land in .tools/ (gitignored) and data lands in data/ (gitignored).
 */
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = path.join(root, '.tools');
const dataDir = path.join(root, 'data');
const logDir = path.join(dataDir, 'logs');
const mode = process.argv[2] ?? 'start';

const REDIS_ZIP_URL =
  'https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip';
const REDIS_ZIP = path.join(toolsDir, 'redis-windows.zip');
const REDIS_DIR = path.join(toolsDir, 'redis');
const REDIS_EXE = path.join(REDIS_DIR, 'redis-server.exe');
const REDIS_CLI = path.join(REDIS_DIR, 'redis-cli.exe');

function log(msg) {
  process.stdout.write(`[dev-infra] ${msg}\n`);
}

function ensureDirs() {
  for (const dir of [toolsDir, dataDir, path.join(dataDir, 'mongo'), logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function stopPort(port, imageName) {
  const { exec } = await import('node:child_process');
  const util = await import('node:util');
  const run = util.promisify(exec);
  try {
    const { stdout } = await run(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
    );
    for (const pid of stdout.split(/\s+/).map((s) => s.trim()).filter(Boolean)) {
      try {
        process.kill(Number(pid));
        log(`stopped ${imageName} (pid ${pid})`);
      } catch {
        /* already gone */
      }
    }
  } catch {
    log(`no ${imageName} listening on ${port}`);
  }
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 800);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    log(`downloading ${url}`);
    const out = fs.createWriteStream(dest);
    // curl.exe ships with Windows 10+; fall back to system curl otherwise.
    const child = spawn('curl.exe', ['-L', '--fail', '--silent', '--show-error', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      out.close();
      if (code === 0) resolve();
      else {
        fs.rmSync(dest, { force: true });
        reject(new Error(`download failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    // Windows' built-in libarchive tar understands zip archives.
    const tar = 'C:\\Windows\\System32\\tar.exe';
    execFile(tar, ['-xf', zipPath, '-C', destDir], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function setupRedis() {
  if (fs.existsSync(REDIS_EXE)) {
    log('redis binary already present');
    return;
  }
  fs.mkdirSync(toolsDir, { recursive: true });
  await download(REDIS_ZIP_URL, REDIS_ZIP);
  await extractZip(REDIS_ZIP, REDIS_DIR);
  if (!fs.existsSync(REDIS_EXE)) throw new Error('redis-server.exe missing after extraction');
  fs.rmSync(REDIS_ZIP, { force: true });
  log('redis extracted to .tools/redis');
}

const MONGOD_CACHE = path.join(root, 'node_modules', '.cache', 'mongodb-memory-server');

/** Find the downloaded mongod build, fetching it through mongodb-memory-server if absent. */
async function ensureMongoBinary() {
  const cached = findMongod();
  if (cached) return cached;
  log('mongod binary not cached yet — downloading official MongoDB build');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  // The instance itself may fail to boot within MMS's default timeout on slow
  // disks; the binary download happens first and is all we need here.
  try {
    const server = await MongoMemoryServer.create({
      instance: { port: 27018, ip: '127.0.0.1' },
    });
    await server.stop();
  } catch (err) {
    log(`provisioning probe failed (${err.message.split('\n')[0]}) — checking the cache anyway`);
  }
  return findMongod();
}

function findMongod() {
  if (!fs.existsSync(MONGOD_CACHE)) return null;
  const match = fs
    .readdirSync(MONGOD_CACHE)
    .find((f) => /^mongod-.*\.exe$/i.test(f) || /^mongod$/.test(f));
  return match ? path.join(MONGOD_CACHE, match) : null;
}

async function setupMongo() {
  const bin = await ensureMongoBinary();
  if (!bin) throw new Error('mongod binary could not be downloaded');
  log(`mongod binary ready: ${bin}`);
}

async function startRedis() {
  if (await portOpen(6379)) {
    log('redis already listening on 6379');
    return;
  }
  if (!fs.existsSync(REDIS_EXE)) {
    log('redis binary not found — run "node scripts/dev-infra.mjs setup" (or use Docker)');
    return;
  }
  const logFile = fs.openSync(path.join(logDir, 'redis.log'), 'a');
  const child = spawn(
    REDIS_EXE,
    ['--port', '6379', '--save', '', '--appendonly', 'no', '--dir', path.join(dataDir, 'redis')],
    { detached: true, stdio: ['ignore', logFile, logFile], windowsHide: true },
  );
  fs.mkdirSync(path.join(dataDir, 'redis'), { recursive: true });
  child.unref();
  await new Promise((r) => setTimeout(r, 700));
  log((await portOpen(6379)) ? 'redis started on 6379' : 'redis failed to start — see data/logs/redis.log');
}

async function startMongo() {
  if (await portOpen(27017)) {
    log('mongodb already listening on 27017');
    return;
  }
  const bin = await ensureMongoBinary();
  if (!bin) {
    log('mongod binary unavailable — run "node scripts/dev-infra.mjs setup" (or use Docker)');
    return;
  }
  const dbPath = path.join(dataDir, 'mongo');
  fs.mkdirSync(dbPath, { recursive: true });
  const logFile = fs.openSync(path.join(logDir, 'mongod.log'), 'a');
  const child = spawn(
    bin,
    ['--dbpath', dbPath, '--port', '27017', '--bind_ip', '127.0.0.1', '--quiet'],
    { detached: true, stdio: ['ignore', logFile, logFile], windowsHide: true },
  );
  child.unref();
  // mongod needs several seconds to open WiredTiger on cold start.
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await portOpen(27017)) break;
  }
  log(
    (await portOpen(27017))
      ? `mongodb started on 27017 (dbPath=data/mongo, binary=${path.basename(bin)})`
      : 'mongodb failed to start — see data/logs/mongod.log',
  );
}

async function main() {
  ensureDirs();
  if (mode === 'setup') {
    await setupRedis();
    await setupMongo();
    log('setup complete');
    return;
  }
  if (mode === 'stop') {
    await stopPort(6379, 'redis-server.exe');
    await stopPort(27017, 'mongod.exe');
    return;
  }
  // start mode: redis in the background, mongod held by this process
  try {
    await setupRedis();
  } catch (err) {
    log(`redis download failed: ${err.message} — continuing (Redis is required for queues)`);
  }
  await startRedis();
  await startMongo();
}

main().catch((err) => {
  log(`error: ${err.message}`);
  process.exit(1);
});
