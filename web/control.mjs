import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime = path.join(root, 'runtime', 'web');
const command = process.argv[2] || 'start';
let config = { port: 7860, hosts: ['127.0.0.1'] };
try { config = JSON.parse(await fs.readFile(path.join(runtime, 'config.json'), 'utf8')); }
catch (err) { if (err.code !== 'ENOENT') throw err; }
const localURL = `http://127.0.0.1:${config.port}`;
async function running() {
  try { const res = await fetch(localURL, { signal: AbortSignal.timeout(1500) }); await res.body.cancel(); return res.headers.get('x-arion-service') === 'upscaler-v1'; }
  catch { return false; }
}
if (command === 'start' && await running()) {
  console.log(`Already running: ${localURL}`);
} else if (command === 'start') {
  await fs.mkdir(runtime, { recursive: true });
  const log = await fs.open(path.join(root, 'logs', 'web-server.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'web', 'server.mjs')], {
    cwd: root, detached: true, windowsHide: true, shell: false, stdio: ['ignore', log.fd, log.fd],
  });
  child.unref(); await log.close();
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    if (await running()) { ready = true; break; }
  }
  if (!ready) throw new Error('Web server did not start. See logs/web-server.log.');
  console.log(`ARION web: ${config.hosts.map(h => `http://${h}:${config.port}`).join(' | ')}`);
  console.log('Open the URL directly. No login is required inside your private Tailscale network.');
} else if (command === 'stop' && !await running()) {
  console.log('ARION web server is not running.');
} else if (command === 'stop') {
  const stopped = await fetch(`${localURL}/api/local-stop`, { method: 'POST', headers: { 'X-Arion-Request': '1' } });
  if (!stopped.ok) throw new Error('Server could not stop.');
  console.log('Web listener stopped. Any active GPU job will finish; waiting jobs will be marked interrupted on restart.');
} else throw new Error('Expected start or stop.');
