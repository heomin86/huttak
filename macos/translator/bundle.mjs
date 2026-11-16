import { build } from 'vite';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const outfile = process.argv[2] ?? resolve(root, 'macos/.cache/translator.mjs');

await build({
  configFile: false,
  root,
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  build: {
    ssr: resolve(root, 'macos/translator/server.ts'),
    outDir: resolve(outfile, '..'),
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: outfile.split('/').at(-1),
      },
    },
  },
  logLevel: 'warn',
});
