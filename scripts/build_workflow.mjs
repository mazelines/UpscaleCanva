// Reuse chaiNNer v0.25.1's actual SaveFile.stringify implementation and live node registry.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'vendor', 'chaiNNer-0.25.1');
const schemaDocument = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'chainner-schema.json'), 'utf8'));
if (schemaDocument.version !== '0.25.1') throw new Error('Unexpected schema version');
const schemas = new Map(schemaDocument.nodes.map(n => [n.schemaId, n]));
const input = path.resolve(process.argv[2] || path.join(root, 'input', '_synthetic_test', 'arion_pipeline_test.png'));
if (!fs.statSync(input).isFile()) throw new Error('Input must be an existing image');
const tile = Number(process.argv[3] || 256);
if (tile < 32 || tile % 2 || !Number.isInteger(tile)) throw new Error('Tile must be an even integer >=32');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-') + '-' + randomUUID().slice(0, 8);
const sessionDir = path.join(root, 'output', 'gui', stamp);
fs.mkdirSync(sessionDir, { recursive: true });

const read = p => fs.readFileSync(path.join(sourceRoot, p), 'utf8');
const migrationSource = read('src/common/migrations.ts');
const legacy = read('src/common/migrations-legacy.js').match(/export const legacyMigrations = \[([^\]]+)\]/)[1].split(',').filter(x => x.trim()).length;
const migrationNames = migrationSource.match(/const migrations = \[([\s\S]*?)\];/)[1].split(',').map(x => x.trim()).filter(Boolean);
const currentMigration = legacy + migrationNames.filter(x => x !== '...legacyMigrations').length;
let serializer = read('src/main/SaveFile.ts').replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport /g, '');
serializer = stripTypeScriptTypes(serializer, { mode: 'strip' });
const SaveFile = new Function('createHash', 'currentMigration', serializer + '\nreturn SaveFile;')(createHash, currentMigration);
const nodes = [], edges = [];
function node(schemaId, title, x, y, overrides = {}) {
  const schema = schemas.get(schemaId);
  if (!schema) throw new Error('Missing installed schema: ' + schemaId);
  const inputData = Object.fromEntries(schema.inputs.map(i => [i.id, i.kind === 'static' && i.value === 'execution_number' ? 1 : (i.def ?? null)]));
  for (const [id, value] of Object.entries(overrides)) {
    const field = schema.inputs.find(i => String(i.id) === id);
    if (!field) throw new Error(`${schemaId} has no input ${id}`);
    if (field.options && !field.options.some(o => o.value === value)) throw new Error(`Invalid dropdown value ${schemaId}/${id}: ${value}`);
    inputData[id] = value;
  }
  const id = randomUUID();
  const n = { id, type: schema.kind, position: { x, y }, data: { id, schemaId, inputData, nodeName: title, nodeWidth: 270, isDisabled: false, isCollapsed: false } };
  nodes.push(n); return n;
}
function edge(a, out, b, inputId) {
  const output = schemas.get(a.data.schemaId).outputs.find(i => i.id === out);
  const inputField = schemas.get(b.data.schemaId).inputs.find(i => i.id === inputId);
  if (!output || !inputField) throw new Error('Invalid edge against installed schema');
  edges.push({ id: randomUUID(), source: a.id, sourceHandle: `${a.id}-${out}`, target: b.id, targetHandle: `${b.id}-${inputId}`, type: 'main', animated: false, data: {} });
}
// IDs below are grounded in the shipped node implementations and checked against the live registry above.
const load = node('chainner:image:load', 'SOURCE — change Image File here', 0, 340, { 0: input });
const run = node('chainner:utility:execution_number', 'Run number (output version)', 0, 1030);
const sourceResize = node('chainner:image:resize', 'SOURCE at 2x — Lanczos only / NOT AI', 330, -230, { 1: 0, 2: 200, 5: 1, 6: 0 });
edge(load, 0, sourceResize, 0);
const sourceView = node('chainner:image:view', 'REFERENCE — interpolated source', 1460, -230);
edge(sourceResize, 0, sourceView, 0);
const saves = [];
for (const [modelName, y] of [['RealESRGAN_x2plus', 180], ['RealESRGAN_x4plus_anime_6B', 770]]) {
  const model = node('chainner:pytorch:load_model', modelName, 330, y, { 0: path.join(root, 'models', modelName + '.pth') });
  const ai = node('chainner:pytorch:upscale_image', modelName.includes('x2plus') ? 'AI native 2x' : 'AI native 4x', 660, y, { 2: -3, 6: tile, 4: 0, 3: 0, 7: 0 });
  edge(load, 0, ai, 1); edge(model, 0, ai, 0);
  let result = ai;
  if (modelName.includes('anime')) {
    const resize = node('chainner:image:resize', 'Lanczos 50% — final 2x of SOURCE', 1010, y, { 1: 0, 2: 50, 5: 1, 6: 0 });
    edge(ai, 0, resize, 0); result = resize;
  }
  const view = node('chainner:image:view', `${modelName} — FINAL 2x`, 1460, y);
  edge(result, 0, view, 0);
  const name = node('chainner:utility:text_pattern', 'Versioned output name', 1010, y + 260, { 0: `{1}__${modelName}__2x__run-{2}` });
  edge(load, 2, name, 1); edge(run, 0, name, 2);
  const save = node('chainner:image:save', `${modelName} — PNG 2x`, 1800, y, { 1: sessionDir, 2: null, 4: 'png', 15: 'u8' });
  edge(result, 0, save, 0); edge(name, 0, save, 3); saves.push(save.id);
}
const content = { nodes, edges, viewport: { x: 50, y: 160, zoom: 0.48 } };
const serialized = SaveFile.stringify(content, '0.25.1');
const raw = JSON.parse(serialized);
if (createHash('md5').update(JSON.stringify(raw.content)).digest('hex') !== raw.checksum) throw new Error('Serializer checksum verification failed');
const workflow = process.argv[4] ? path.resolve(process.argv[4]) : path.join(root, 'workflows', 'ARION-compare-2x.chn');
fs.mkdirSync(path.dirname(workflow), { recursive: true });
fs.writeFileSync(workflow, serialized);
const manifest = { workflow, input, sessionDir, nativeSerializer: 'vendor/chaiNNer-0.25.1/src/main/SaveFile.ts', migration: currentMigration, nodes: nodes.length, edges: edges.length, requiredSchemas: [...new Set(nodes.map(n => n.data.schemaId))], tile, saves, generatedUtc: new Date().toISOString(), nativeAppValidation: 'pending' };
fs.writeFileSync(path.join(root, 'docs', 'workflow-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
