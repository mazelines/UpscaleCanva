import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { createApp, ROOT, safeName } from '../server.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
const run = path.join(ROOT, 'runtime', 'web-tests', `${Date.now()}`);
const fixture = path.join(ROOT, 'input', '_synthetic_test', 'arion_pipeline_test.png');
const port = 17860;
const base = `http://127.0.0.1:${port}`;
const common = { 'X-Arion-Request': '1', Origin: base };

test('Web access controls, uploaded image validation, real CUDA inference and downloads', { timeout: 120000 }, async t => {
  const app = await createApp({ runtime: path.join(run, 'state'), inputRoot: path.join(run, 'input'), outputRoot: path.join(run, 'output'), config: { hosts: ['127.0.0.1'], port } });
  await app.listen(); t.after(() => app.close());
  const original = await fs.readFile(fixture), sourceHash = hash(original);
  const checks = [];
  async function status(url, expected, init) { const response = await fetch(base + url, init); assert.equal(response.status, expected); await response.arrayBuffer(); return response; }
  await status('/api/jobs', 200); checks.push('No application login, as requested for personal Tailscale use');
  await status('/compare.js', 200);
  const pageResponse = await status('/', 200);
  assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY');
  assert.match(pageResponse.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const badHost = await new Promise((resolve, reject) => {
    const req = http.get(base, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject);
  });
  assert.equal(badHost, 403); checks.push('Host allowlist');
  await status('/api/login', 403, { method: 'POST', headers: { ...common, Origin: 'http://evil.example' }, body: '{}' });
  await status('/api/login', 403, { method: 'POST', body: '{}' }); checks.push('Cross-site / missing CSRF header denied');
  const headers = { ...common };
  await status('/api/login', 404, { method: 'POST', headers, body: '{}' });
  await status('/api/jobs?name=test.png', 415, { method: 'POST', headers, body: original });
  await status('/api/jobs?name=test.png&model=bogus', 400, { method: 'POST', headers, body: original });
  await status('/api/jobs?name=test.svg', 400, { method: 'POST', headers, body: '<svg/>' });
  const uploadHeaders = { ...headers, 'Content-Type': 'application/octet-stream' };
  const oversized = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/jobs?name=too-large.png', {
      method: 'POST', headers: { ...uploadHeaders, 'Content-Length': 33 * 1024 * 1024 },
    }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(oversized, 413); checks.push('Upload byte limit enforced before reading an oversized body');
  await status('/api/jobs?name=broken.png', 400, { method: 'POST', headers: uploadHeaders, body: 'not an image' });
  checks.push('Invalid model, type, extension, corrupt image rejected');
  assert.equal(safeName('../../한글.png'), '한글.png');
  assert.equal(safeName('C:\\evil\\a.png'), 'a.png'); checks.push('Upload filename normalized without path traversal');
  const response = await fetch(base + '/api/jobs?name=' + encodeURIComponent('../../테스트 원화.png') + '&model=both&tile=128', { method: 'POST', headers: uploadHeaders, body: original });
  assert.equal(response.status, 202); let job = await response.json(); const id = job.id;
  await status(`/api/jobs/${id}/source`, 200);
  const deadline = Date.now() + 90000;
  while (!['completed', 'failed', 'interrupted'].includes(job.status) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300));
    job = await (await fetch(base + `/api/jobs/${id}`, { headers })).json();
  }
  assert.equal(job.status, 'completed', JSON.stringify(job)); assert.equal(job.results.length, 2);
  const downloads = [];
  for (const r of job.results) {
    assert.deepEqual(r.inputSize, [193, 129]); assert.deepEqual(r.outputSize, [386, 258]);
    assert.ok(r.cudaForwards > 0); assert.match(r.gpu, /4090/); assert.equal(r.iccPreserved, true);
    const download = await fetch(base + `/api/jobs/${id}/result/${r.index}?download=1`, { headers });
    assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'image/png');
    assert.match(download.headers.get('content-disposition'), /attachment/);
    const image = Buffer.from(await download.arrayBuffer());
    assert.equal(image.subarray(1, 4).toString(), 'PNG'); assert.equal(image.readUInt32BE(16), 386); assert.equal(image.readUInt32BE(20), 258);
    downloads.push({ model: r.model, sha256: hash(image), bytes: image.length, ...r });
  }
  assert.equal(hash(await fs.readFile(fixture)), sourceHash);
  checks.push('Both real CUDA models, exact 2x PNG downloads, ICC retained, original unchanged');
  const preview = await fetch(base + `/api/jobs/${id}/source`, { headers }); assert.equal(preview.status, 200); await preview.arrayBuffer();
  const copyImage = await fetch(base + `/api/jobs/${id}/result/0?clipboard=1`, { headers });
  assert.equal(copyImage.status, 200);
  assert.equal(copyImage.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(copyImage.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(hash(Buffer.from(await copyImage.arrayBuffer())), downloads[0].sha256);
  const copyDownload = await status(`/api/jobs/${id}/result/0?clipboard=1&download=1`, 200, { headers });
  assert.equal(copyDownload.headers.get('x-frame-options'), 'DENY');
  const fullSource = await fetch(base + `/api/jobs/${id}/original`, { headers });
  assert.equal(fullSource.status, 200); assert.equal(fullSource.headers.get('content-type'), 'image/png');
  assert.equal(hash(Buffer.from(await fullSource.arrayBuffer())), sourceHash);
  const savedSource = app.jobs.get(id).source;
  app.jobs.get(id).source = fixture;
  await status(`/api/jobs/${id}/original`, 403, { headers });
  app.jobs.get(id).source = savedSource;
  checks.push('Full-resolution comparison serves original bytes and rejects paths outside the job input directory');
  await status('/api/jobs/../../models/RealESRGAN_x2plus.pth', 404, { headers });
  await status('/runtime/web/access-key.txt', 404); checks.push('No filesystem static exposure');
  await fs.writeFile(path.join(ROOT, 'docs', 'web-test-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed', checks, downloads, jobId: id, artifacts: run, realArtworkReview: false }, null, 2));
});

test('Web GPU queue is serialized and unfinished persisted jobs are marked interrupted', { timeout: 30000 }, async t => {
  const state = path.join(run, 'queue-state');
  const queuePort = 17861, queueBase = `http://127.0.0.1:${queuePort}`;
  const gates = [], started = [];
  const app = await createApp({ runtime: state, inputRoot: path.join(run, 'queue-input'), outputRoot: path.join(run, 'queue-output'),
    config: { hosts: ['127.0.0.1'], port: queuePort }, runner: async args => {
      started.push(args);
      return new Promise(resolve => gates.push(() => resolve({ code: 1, output: '', error: 'Injected queue-test failure' })));
    } });
  await app.listen(); t.after(() => app.close());
  const original = await fs.readFile(fixture);
  const upload = async () => {
    const res = await fetch(queueBase + '/api/jobs?name=queue.png', { method: 'POST',
      headers: { 'X-Arion-Request': '1', 'Content-Type': 'application/octet-stream', Origin: queueBase }, body: original });
    assert.equal(res.status, 202); return res.json();
  };
  const first = await upload(), second = await upload();
  assert.equal(started.length, 1);
  assert.equal(app.jobs.get(first.id).status, 'running');
  assert.equal(app.jobs.get(second.id).status, 'queued');
  for (const job of [first, second]) {
    const denied = await fetch(`${queueBase}/api/jobs/${job.id}`, { method: 'DELETE', headers: { 'X-Arion-Request': '1' } });
    assert.equal(denied.status, 409); await denied.arrayBuffer();
    assert.ok(app.jobs.has(job.id));
  }
  gates.shift()();
  for (let i = 0; i < 50 && started.length !== 2; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(started.length, 2); assert.equal(app.jobs.get(first.id).status, 'failed');
  gates.shift()();
  for (let i = 0; i < 50 && app.jobs.get(second.id).status !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(app.jobs.get(second.id).status, 'failed');
  await app.close();
  const file = path.join(state, 'jobs', `${second.id}.json`);
  const interrupted = JSON.parse(await fs.readFile(file, 'utf8')); interrupted.status = 'running';
  await fs.writeFile(file, JSON.stringify(interrupted));
  const restarted = await createApp({ runtime: state, inputRoot: path.join(run, 'queue-input'), outputRoot: path.join(run, 'queue-output'), config: { hosts: ['127.0.0.1'], port: queuePort } });
  assert.equal(restarted.jobs.get(second.id).status, 'interrupted');
  await assert.rejects(createApp({ runtime: path.join(run, 'reject-bind'), config: { hosts: ['0.0.0.0'], port: queuePort } }), /localhost\/Tailscale/);
  await fs.writeFile(path.join(ROOT, 'docs/web-queue-test.json'), JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
    checks: ['Only one worker active; next starts after first closes', 'Failure does not block next queued job', 'Restart marks unfinished jobs interrupted', 'Binding all interfaces is refused'],
    note: 'Controlled mock runner for queue lifecycle; real CUDA is tested separately in web-test-results.json' }, null, 2));
});

test('Deleting job history is scoped, protected and persists after restart', async t => {
  const state = path.join(run, 'delete-state'), inputRoot = path.join(run, 'delete-input'), outputRoot = path.join(run, 'delete-output');
  const jobsRoot = path.join(state, 'jobs'), deletePort = 17862, deleteBase = `http://127.0.0.1:${deletePort}`;
  await fs.mkdir(jobsRoot, { recursive: true });
  const entries = ['completed', 'failed', 'interrupted'].map(status => ({
    id: randomUUID(), originalName: 'same-name.png', model: 'RealESRGAN_x2plus', tile: 256,
    status, createdAt: new Date().toISOString(), image: { size: [193, 129] }, results: [],
  }));
  for (const job of entries) await fs.writeFile(path.join(jobsRoot, `${job.id}.json`), JSON.stringify(job));
  const options = { runtime: state, inputRoot, outputRoot, config: { hosts: ['127.0.0.1'], port: deletePort } };
  const app = await createApp(options); await app.listen(); t.after(() => app.close());
  const target = entries[0], url = `${deleteBase}/api/jobs/${target.id}`;
  const sourceDir = path.join(inputRoot, target.id), outputDir = path.join(outputRoot, target.id);
  await fs.mkdir(sourceDir); await fs.mkdir(outputDir);
  await fs.writeFile(path.join(sourceDir, 'source.png'), 'original');
  await fs.writeFile(path.join(outputDir, 'result.png'), 'result');
  const request = async (endpoint, expected, headers = { 'X-Arion-Request': '1' }) => {
    const response = await fetch(endpoint, { method: 'DELETE', headers });
    assert.equal(response.status, expected); return response.json();
  };
  await request(url, 403, {});
  await request(url, 403, { 'X-Arion-Request': '1', Origin: 'http://evil.example' });
  await request(`${url}/source`, 404);
  assert.equal(app.jobs.size, 3);
  assert.deepEqual(await request(url, 200), { ok: true });
  assert.equal(app.jobs.has(target.id), false);
  await assert.rejects(fs.stat(path.join(jobsRoot, `${target.id}.json`)), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(sourceDir, 'source.png'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(outputDir, 'result.png'), 'utf8'), 'result');
  const listed = await (await fetch(`${deleteBase}/api/jobs`)).json();
  assert.deepEqual(new Set(listed.jobs.map(job => job.id)), new Set(entries.slice(1).map(job => job.id)));
  await request(url, 404);
  const missing = await fetch(url); assert.equal(missing.status, 404); await missing.arrayBuffer();
  await app.close();
  const restarted = await createApp(options); await restarted.listen(); t.after(() => restarted.close());
  assert.equal(restarted.jobs.has(target.id), false);
  for (const job of entries.slice(1)) await request(`${deleteBase}/api/jobs/${job.id}`, 200);
  assert.equal(restarted.jobs.size, 0);
});
