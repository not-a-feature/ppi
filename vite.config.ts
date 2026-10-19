import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { cpSync, existsSync, readFileSync } from 'node:fs';

const pdfVersion = JSON.parse(
  readFileSync(new URL('./node_modules/pdfjs-dist/package.json', import.meta.url), 'utf8')
).version;
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const destination = new URL(`./static/pdfjs/${pdfVersion}/${directory}`, import.meta.url);
  if (!existsSync(destination))
    cpSync(new URL(`./node_modules/pdfjs-dist/${directory}`, import.meta.url), destination, {
      recursive: true
    });
}

export default defineConfig({
  plugins: [sveltekit()],
  server: { watch: { ignored: ['**/static/pdfjs/**'] } }
});
