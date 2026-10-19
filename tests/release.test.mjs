import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function filesIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(file)); else result.push(file);
  }
  return result;
}
const publicFiles = [
  ...await filesIn(path.join(root, 'sede-3d')),
  ...await filesIn(path.join(root, 'cube-world-lab')),
];
const entryFile = path.join(root, 'sede-3d/index.html');
const html = await readFile(entryFile, 'utf8');
const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;

test('JavaScript syntax and all local module imports resolve', async () => {
  for (const file of publicFiles.filter(file => file.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    const source = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const match of source.matchAll(/(?:^\s*(?:import|export)\s+[\w*$,\s{}]+?\s+from\s*|^\s*import\s*|import\s*\(\s*)['"]([^'"]+)['"]/gm)) {
      const spec = match[1];
      let target;
      if (spec.startsWith('.')) target = path.resolve(path.dirname(file), spec.split('?')[0]);
      else if (imports[spec]) target = path.resolve(path.dirname(entryFile), imports[spec].split('?')[0]);
      else {
        const prefix = Object.keys(imports).find(key => key.endsWith('/') && spec.startsWith(key));
        assert.ok(prefix, `Unmapped dependency ${spec} in ${path.relative(root, file)}`);
        target = path.resolve(path.dirname(entryFile), imports[prefix], spec.slice(prefix.length).split('?')[0]);
      }
      assert.ok((await stat(target)).isFile(), `Missing dependency ${spec}`);
    }
  }
});

test('HTML and CSS local resources are included', async () => {
  for (const file of publicFiles.filter(file => /\.(html|css)$/.test(file))) {
    const source = await readFile(file, 'utf8');
    const pattern = file.endsWith('.html') ? /(?:src|href)="([^"]+)"/g : /url\(['"]?([^)'"\s]+)['"]?\)/g;
    for (const match of source.matchAll(pattern)) {
      const reference = match[1];
      if (/^(https?:|data:|#)/.test(reference)) continue;
      const local = path.resolve(path.dirname(file), reference.split('?')[0]);
      assert.ok(await stat(local), `Missing resource ${reference}`);
    }
  }
});

test('GLB assets match the recorded source hashes', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'cube-world-lab/assets/manifest.json'), 'utf8'));
  for (const model of [...manifest.models, ...manifest.props]) {
    const data = await readFile(path.join(root, 'cube-world-lab', model.path));
    assert.equal(data.toString('ascii', 0, 4), 'glTF');
    assert.equal(data.length, model.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), model.sha256);
  }
});

test('Server serves the complete runtime and rejects private paths', async () => {
  const server = createStaticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const redirect = await fetch(base, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/sede-3d/');
    for (const file of publicFiles) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (path.extname(file) === '') continue;
      const response = await fetch(`${base}/${relative}`, { method: 'HEAD' });
      assert.equal(response.status, 200, relative);
      assert.equal(Number(response.headers.get('content-length')), (await stat(file)).size);
    }
    for (const privatePath of ['/.git/config', '/.env', '/server.mjs', '/package.json', '/sede-3d/%2e%2e%2fserver.mjs', '/cube-world-lab/%5c..%5cserver.mjs']) {
      assert.equal((await fetch(base + privatePath)).status, 404, privatePath);
    }
    assert.equal((await fetch(base + '/sede-3d/', { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
