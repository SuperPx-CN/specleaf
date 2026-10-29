import { chmod, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));

// Bundle our Node code, leaving only the contract parser as a runtime dependency.
await build({
  configFile: false,
  logLevel: 'warn',
  root,
  publicDir: false,
  build: {
    target: 'node22',
    ssr: resolve(root, 'build/cli.ts'),
    outDir: resolve(root, 'lib'),
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'cli.js' } },
  },
});
await chmod(resolve(root, 'lib/cli.js'), 0o755);

// The browser bundle is contract-independent and needs no frontend build at use time.
await build({
  configFile: false,
  logLevel: 'warn',
  root,
  publicDir: false,
  plugins: [react(), {
    name: 'packaged-openapi-data',
    resolveId(id) {
      if (id === 'virtual:openapi') return '\0virtual:openapi';
    },
    load(id) {
      if (id === '\0virtual:openapi')
        return `export default JSON.parse(document.getElementById('specleaf-contract').textContent);`;
    },
  }],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: resolve(root, 'lib/assets'),
    emptyOutDir: true,
    copyPublicDir: false,
    cssCodeSplit: false,
    sourcemap: false,
    minify: true,
    lib: {
      entry: resolve(root, 'src/main.tsx'),
      formats: ['iife'],
      name: 'SpecLeaf',
      fileName: () => 'ui.js',
      cssFileName: 'ui',
    },
  },
});
await copyFile(resolve(root, 'public/favicon.svg'), resolve(root, 'lib/assets/favicon.svg'));
