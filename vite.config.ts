import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { openApiPlugin } from './build/openapi-plugin.ts';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'test' ? [] : [openApiPlugin()])],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
