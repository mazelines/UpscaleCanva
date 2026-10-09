import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(path.join(root, 'runtime/web/config.json'), 'utf8'));
const host = config.hosts.find(h => h.startsWith('100.')) || '127.0.0.1';
const base = `http://${host}:${config.port}`;
const headers = { 'X-Arion-Request': '1', Origin: base };
const source = await fs.readFile(path.join(root, 'input/_synthetic_test/arion_pipeline_test.png'));
const response = await fetch(base + '/api/jobs?name=ARION_web_test.png&model=both&tile=128', {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: source,
});
assert.equal(response.status, 202);
let job = await response.json(); const deadline = Date.now() + 120000;
while (!['completed', 'failed'].includes(job.status) && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 500));
  job = await (await fetch(base + `/api/jobs/${job.id}`, { headers })).json();
}
assert.equal(job.status, 'completed');
for (const result of job.results) {
  assert.deepEqual(result.outputSize, [386, 258]); assert.ok(result.cudaForwards > 0);
  const download = await fetch(base + `/api/jobs/${job.id}/result/${result.index}?download=1`, { headers });
  assert.equal(download.status, 200);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.readUInt32BE(16), 386); assert.equal(bytes.readUInt32BE(20), 258);
}
const report = { testedAt: new Date().toISOString(), url: base, status: 'passed', loginRequired: false, job,
  scope: 'HTTP request to the Tailscale IP from this PC; offsite client not yet verified' };
await fs.writeFile(path.join(root, 'docs/web-live-test.json'), JSON.stringify(report, null, 2));
console.log(`Live upload + both CUDA models + PNG downloads passed: ${base}, job ${job.id}`);
