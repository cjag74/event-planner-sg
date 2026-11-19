// Builds the GitHub Pages site into docs/: the same pages as public/, but with the browser-only
// data layer (static/api.js) in place of the server version, plus the sample events.
// Run with: npm run build:static
import { cp, mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'public'), out, { recursive: true });
await copyFile(path.join(root, 'static', 'api.js'), path.join(out, 'api.js')); // replaces the server version
await copyFile(path.join(root, 'events.json'), path.join(out, 'events.json'));
await writeFile(path.join(out, '.nojekyll'), '');
console.log('Built static site in docs/');
