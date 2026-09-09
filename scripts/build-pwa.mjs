import { readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../dist/client/', import.meta.url);
const rootPath = fileURLToPath(root);
async function files(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const path = join(dir, item.name);
    if (item.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
await copyFile(
  new URL('../data/roadbook.json', import.meta.url),
  new URL('trip-template.json', root),
);
const assets = (await files(rootPath))
  .filter(
    (p) =>
      /\.(html|rsc|js|css|png|svg|jpg|jpeg|webp|woff2|webmanifest)$/.test(p) &&
      !p.endsWith('/sw.js'),
  )
  .sort();
const paths = assets.map((p) => '/' + relative(rootPath, p));
const pages = {};
for (const route of [
  '/',
  '/map',
  '/place',
  '/place/add',
  '/place/edit',
  '/reorder',
  '/settings',
]) {
  const base = route === '/' ? '/index' : route;
  const html = paths.find(
    (p) => p === base + '.html' || p === route + '/index.html',
  );
  const rsc = paths.find(
    (p) => p === base + '.rsc' || p === route + '/index.rsc',
  );
  if (!html || !rsc) throw new Error(`Missing static HTML/RSC for ${route}`);
  pages[route] = { html, rsc };
}
const hash = createHash('sha256');
for (const path of assets) {
  hash.update(relative(rootPath, path));
  hash.update(await readFile(path));
}
const source = await readFile(
  new URL('../public/sw.js', import.meta.url),
  'utf8',
);
hash.update(source);
const version = hash.digest('hex').slice(0, 16);
const worker = source
  .replace(
    "const VERSION = 'development';",
    `const VERSION = ${JSON.stringify(version)};`,
  )
  .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(paths)};`)
  .replace('const PAGES = {};', `const PAGES = ${JSON.stringify(pages)};`);
await writeFile(new URL('sw.js', root), worker);
await writeFile(
  new URL('pwa-assets.json', root),
  JSON.stringify({ version, pages, assets: paths }, null, 2) + '\n',
);
console.log(
  `PWA ${version}: ${Object.keys(pages).length} pages, ${paths.length} offline resources`,
);
