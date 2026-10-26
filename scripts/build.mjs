// Bundles the game into one self-contained HTML file: dist/dig-site.html.
// --fragment drops the <html>/<head>/<body> wrapper for hosts that add their own.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fragment = process.argv.includes('--fragment');
const out = process.argv.find((a) => a.endsWith('.html')) || path.join(ROOT, 'dist', fragment ? 'dig-site.fragment.html' : 'dig-site.html');

const res = await build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>${js}</script>`);
if (fragment) {
  html = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<\/?html[^>]*>\s*/gi, '')
    .replace(/<\/?head>\s*/gi, '')
    .replace(/<\/?body>\s*/gi, '')
    .replace(/<meta charset[^>]*>\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
}
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
