import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const WEB = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(WEB);
const MODEL_NAMES = ['RealESRGAN_x2plus', 'RealESRGAN_x4plus_anime_6B'];
const TILES = [32, 64, 128, 256, 512];
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_JOBS = 8;
const PYTHON = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
const now = () => new Date().toISOString();
const httpError = (status, message) => Object.assign(new Error(message), { status });
const idValid = value => /^[a-f0-9-]{36}$/.test(value);

export function safeName(value) {
  const base = String(value || 'image.png').split(/[\\/]/).pop().normalize('NFC');
  return base.replace(/[^\p{L}\p{N}_. ()-]/gu, '_').slice(0, 100) || 'image.png';
}

function localOrTailnet(host) {
  if (host === '127.0.0.1') return true;
  const p = host.split('.').map(Number);
  return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && p[0] === 100 && p[1] >= 64 && p[1] <= 127;
}

async function atomicJSON(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { flag: 'wx' });
  await fs.rename(temp, file);
}

function runPython(args, onLine, timeout = 60 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ['-X', 'utf8', ...args], {
      cwd: ROOT, windowsHide: true, shell: false,
      env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', error = '', pending = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output = (output + chunk).slice(-1024 * 1024);
      pending += chunk;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) onLine?.(line);
    });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-32000); });
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (pending) onLine?.(pending);
      resolve({ code, signal, output, error });
    });
  });
}

export async function createApp(options = {}) {
  const runtime = options.runtime || path.join(ROOT, 'runtime', 'web');
  const inputRoot = options.inputRoot || path.join(ROOT, 'input', 'web');
  const outputRoot = options.outputRoot || path.join(ROOT, 'output', 'web');
  const jobsRoot = path.join(runtime, 'jobs');
  const configFile = path.join(runtime, 'config.json');
  for (const p of [runtime, inputRoot, outputRoot, jobsRoot]) await fs.mkdir(p, { recursive: true });
  let config;
  try { config = JSON.parse(await fs.readFile(configFile, 'utf8')); }
  catch (err) {
    if (err.code !== 'ENOENT') throw err;
    config = { port: 7860, hosts: ['127.0.0.1'] };
    await atomicJSON(configFile, config);
  }
  config = { ...config, ...options.config };
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535
      || !Array.isArray(config.hosts) || !config.hosts.length || !config.hosts.every(localOrTailnet)) {
    throw new Error('Web config must use port 1024–65535 and localhost/Tailscale IPv4 addresses.');
  }
  // Access is restricted by the user's private Tailscale network and explicit binds.
  // There are no application credentials or persistent login cookies.
  const jobs = new Map();
  const queue = [];
  let active = null, accepting = true, uploading = 0;
  const allowedHosts = new Set(config.hosts.map(h => `${h}:${config.port}`));
  if (config.hosts.includes('127.0.0.1')) allowedHosts.add(`localhost:${config.port}`);
  const servers = [];
  const persist = job => atomicJSON(path.join(jobsRoot, `${job.id}.json`), job);
  for (const name of await fs.readdir(jobsRoot)) {
    if (!name.endsWith('.json')) continue;
    const job = JSON.parse(await fs.readFile(path.join(jobsRoot, name), 'utf8'));
    if (!idValid(job.id)) continue;
    if (['queued', 'running', 'uploading'].includes(job.status)) {
      job.status = 'interrupted'; job.error = '서버가 재시작되었습니다. 원본을 다시 등록해 주세요.';
      job.finishedAt = now(); await persist(job);
    }
    jobs.set(job.id, job);
  }
  const publicJob = job => ({
    id: job.id, originalName: job.originalName, model: job.model, tile: job.tile,
    status: job.status, createdAt: job.createdAt, startedAt: job.startedAt,
    finishedAt: job.finishedAt, image: job.image, error: job.error,
    queuePosition: job.status === 'queued' ? queue.indexOf(job.id) + 1 : null,
    results: job.results.map((r, index) => ({
      model: r.model, inputSize: r.input_size, nativeSize: r.native_ai_size,
      outputSize: r.output_size, gpu: r.gpu, elapsedSeconds: r.elapsed_seconds,
      cudaForwards: r.cuda_forward_calls, iccPreserved: r.icc_preserved,
      tileUsed: r.tile_used, oomRetries: r.oom_retries, index,
    })),
  });
  async function pump() {
    if (active || !queue.length || !accepting) return;
    active = queue.shift();
    const job = jobs.get(active);
    try {
      job.status = 'running'; job.startedAt = now(); await persist(job);
      const args = [path.join(ROOT, 'scripts', 'upscale.py'), '--input', job.source,
        '--output', path.join(outputRoot, job.id), '--model', job.model, '--tile', String(job.tile)];
      const run = await (options.runner || runPython)(args, line => {
        try {
          const r = JSON.parse(line);
          if (r.status === 'success' && r.device === 'cuda:0' && r.cuda_forward_calls > 0) job.results.push(r);
        } catch { /* CUDA CLI emits other diagnostic lines too. */ }
      });
      await fs.writeFile(path.join(jobsRoot, `${job.id}.log`), `${run.output}\n${run.error}`);
      if (run.code !== 0 || job.results.length !== (job.model === 'both' ? 2 : 1)) {
        throw new Error(/out of memory|CUDA OOM/i.test(run.error)
          ? 'GPU 메모리가 부족합니다. 타일을 줄이거나 다른 GPU 작업이 끝난 뒤 다시 시도해 주세요.'
          : '업스케일을 완료하지 못했습니다. PC의 runtime/web/jobs 작업 로그를 확인해 주세요.');
      }
      for (const result of job.results) {
        const expected = path.join(outputRoot, job.id);
        if (path.dirname(path.resolve(result.output)) !== path.resolve(expected)) throw new Error('Invalid output path.');
        if (result.output_size[0] !== job.image.size[0] * 2 || result.output_size[1] !== job.image.size[1] * 2) {
          throw new Error('출력 해상도 검증에 실패했습니다.');
        }
      }
      job.status = 'completed';
    } catch (err) { job.status = 'failed'; job.error = err.message; }
    finally {
      job.finishedAt = now();
      try { await persist(job); } catch (err) { console.error('Job metadata save failed:', err.message); }
      active = null; setImmediate(pump);
    }
  }
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
  async function body(req, limit) {
    if (Number(req.headers['content-length'] || 0) > limit) throw httpError(413, '파일 크기 제한을 초과했습니다.');
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw httpError(413, '파일 크기 제한을 초과했습니다.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function file(res, filename, type, downloadName) {
    const stat = await fs.stat(filename);
    if (downloadName) {
      const encoded = encodeURIComponent(downloadName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
      res.setHeader('Content-Disposition', `attachment; filename="arion-result.png"; filename*=UTF-8''${encoded}`);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size });
    const stream = createReadStream(filename);
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  async function handle(req, res) {
    res.setHeader('X-Arion-Service', 'upscaler-v1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      if (!localOrTailnet(req.socket.remoteAddress || '')) throw httpError(403, '로컬 또는 Tailscale 기기에서 접속해 주세요.');
      const host = req.headers.host;
      if (!allowedHosts.has(host)) throw httpError(403, '허용되지 않은 접속 주소입니다.');
      const url = new URL(req.url, `http://${host}`);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw httpError(403, '다른 사이트의 요청은 허용하지 않습니다.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, '다른 사이트의 요청은 허용하지 않습니다.');
      if (req.method === 'GET' && ['/', '/app.js', '/compare.js', '/styles.css', '/favicon.svg'].includes(url.pathname)) {
        const names = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
          '/compare.js': ['compare.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
        const [name, type] = names[url.pathname]; return await file(res, path.join(WEB, 'public', name), type);
      }
      if (['POST', 'DELETE'].includes(req.method) && req.headers['x-arion-request'] !== '1') throw httpError(403, '올바른 웹 화면에서 요청해 주세요.');
      if (url.pathname === '/api/local-stop' && req.method === 'POST') {
        if (req.socket.remoteAddress !== '127.0.0.1') throw httpError(403, '서버 종료는 PC에서만 가능합니다.');
        accepting = false;
        json(res, 200, { ok: true, activeJobWillFinish: Boolean(active) });
        setImmediate(() => { for (const server of servers) { server.close(); server.closeIdleConnections(); } });
        return;
      }
      if (url.pathname === '/api/session' && req.method === 'GET') {
        return json(res, 200, { access: 'private-tailscale', loginRequired: false, gpu: 'NVIDIA RTX 4090', maxBytes: MAX_BYTES,
          maxPixels: 16_000_000, maxQueued: MAX_JOBS, active, queueLength: queue.length, models: MODEL_NAMES });
      }
      if (url.pathname === '/api/jobs' && req.method === 'GET') {
        return json(res, 200, { jobs: [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(publicJob) });
      }
      if (url.pathname === '/api/jobs' && req.method === 'POST') {
        if (!accepting || queue.length + (active ? 1 : 0) + uploading >= MAX_JOBS) throw httpError(429, '대기열이 가득 찼습니다. 작업 완료 후 등록해 주세요.');
        const model = url.searchParams.get('model') || MODEL_NAMES[0];
        const tile = Number(url.searchParams.get('tile') || 256);
        if (![...MODEL_NAMES, 'both'].includes(model) || !TILES.includes(tile)) throw httpError(400, '모델 또는 타일 설정을 확인해 주세요.');
        const originalName = safeName(url.searchParams.get('name'));
        if (!/\.(png|jpe?g|webp)$/i.test(originalName)) throw httpError(400, 'PNG, JPEG, WebP를 선택해 주세요.');
        if (req.headers['content-type'] !== 'application/octet-stream') throw httpError(415, '이미지 파일을 직접 업로드해 주세요.');
        uploading++;
        try {
          const storage = await fs.statfs(outputRoot);
          if (storage.bavail * storage.bsize < 5 * 1024 ** 3) throw httpError(507, 'PC의 저장 공간이 부족합니다. 5GB 이상 확보해 주세요.');
          const data = await body(req, MAX_BYTES);
          if (!data.length) throw httpError(400, '빈 파일은 등록할 수 없습니다.');
          const id = randomUUID();
          const dir = path.join(inputRoot, id); await fs.mkdir(dir);
          const source = path.join(dir, `source-${originalName}`);
          await fs.writeFile(source, data, { flag: 'wx' });
          const validation = await runPython([path.join(WEB, 'image_check.py'), source, path.join(dir, 'preview.png')], null, 30000);
          let image;
          try { image = JSON.parse(validation.output.trim()); } catch { throw httpError(400, '이미지 파일을 읽을 수 없습니다.'); }
          if (validation.code !== 0) throw httpError(400, image.error || '지원하지 않는 이미지입니다.');
          const job = { id, source, originalName, model, tile, image, createdAt: now(), status: 'queued', results: [] };
          await persist(job); jobs.set(id, job); queue.push(id); setImmediate(pump);
          return json(res, 202, publicJob(job));
        } finally { uploading--; }
      }
      const match = /^\/api\/jobs\/([a-f0-9-]{36})(?:\/(source|original|result|metadata)(?:\/(\d+))?)?$/.exec(url.pathname);
      if (match && !match[2] && req.method === 'DELETE') {
        const job = jobs.get(match[1]); if (!job) throw httpError(404, '작업을 찾을 수 없습니다.');
        if (active === job.id || !['completed', 'failed', 'interrupted'].includes(job.status)) {
          throw httpError(409, '대기 또는 처리 중인 작업은 완료된 뒤 삭제할 수 있습니다.');
        }
        // Delete the persisted history entry while keeping source and output files on disk.
        await fs.rm(path.join(jobsRoot, `${job.id}.json`), { force: true });
        jobs.delete(job.id);
        return json(res, 200, { ok: true });
      }
      if (match && req.method === 'GET') {
        const job = jobs.get(match[1]); if (!job) throw httpError(404, '작업을 찾을 수 없습니다.');
        if (!match[2]) return json(res, 200, publicJob(job));
        if (match[2] === 'source') return await file(res, path.join(inputRoot, job.id, 'preview.png'), 'image/png');
        if (match[2] === 'original') {
          if (path.dirname(path.resolve(job.source)) !== path.resolve(inputRoot, job.id)) throw httpError(403, '잘못된 원본 경로입니다.');
          const type = { PNG: 'image/png', JPEG: 'image/jpeg', WEBP: 'image/webp' }[job.image.format];
          if (!type) throw httpError(415, '지원하지 않는 이미지입니다.');
          return await file(res, job.source, type);
        }
        const result = job.results[Number(match[3] ?? -1)];
        if (!result || job.status !== 'completed') throw httpError(404, '아직 결과가 없습니다.');
        const expectedDir = path.resolve(outputRoot, job.id);
        if (path.dirname(path.resolve(result.output)) !== expectedDir) throw httpError(403, '잘못된 결과 경로입니다.');
        if (match[2] === 'metadata') return json(res, 200, result);
        const download = url.searchParams.has('download') ? `${path.parse(job.originalName).name}__${result.model}__2x.png` : null;
        if (url.searchParams.get('clipboard') === '1' && !download) {
          // Only validated PNG results may be framed by this same-origin viewer.
          // The browser's built-in image document uses inline styles.
          res.setHeader('X-Frame-Options', 'SAMEORIGIN');
          res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'");
        }
        return await file(res, result.output, 'image/png', download);
      }
      throw httpError(404, '요청한 페이지를 찾을 수 없습니다.');
    } catch (err) {
      if (res.headersSent || res.destroyed) return;
      const status = err.status || (err instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error('Web request failed:', err.message);
      json(res, status, { error: status === 500 ? '서버 오류가 발생했습니다. PC의 웹 서버 로그를 확인해 주세요.' : err.message });
    }
  }
  return {
    config, jobs,
    async listen() {
      try {
        for (const host of config.hosts) {
          const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 120000, headersTimeout: 15000 }, handle);
          server.maxConnections = 64;
          server.keepAliveTimeout = 5000;
          server.on('clientError', (_err, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
          server.listen(config.port, host); await once(server, 'listening'); servers.push(server);
        }
      } catch (err) { await this.close(); throw err; }
      return config.hosts.map(h => `http://${h}:${config.port}`);
    },
    async close() {
      accepting = false;
      await Promise.all(servers.map(s => new Promise(resolve => { s.close(resolve); s.closeIdleConnections(); })));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const urls = await app.listen();
  await atomicJSON(path.join(ROOT, 'runtime', 'web', 'server.json'), { pid: process.pid, startedAt: now(), urls });
  console.log(`ARION web ready: ${urls.join(' | ')}`);
  console.log('Private Tailscale access; no application login.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    console.log('Stopping web listener. Current GPU job will finish; queued jobs resume as interrupted.');
    await app.close();
  });
}
