/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  // tw_platform's deploy.py injects VITE_PUBLIC_BASE=/lambdalab/ at build time.
  base: process.env.VITE_PUBLIC_BASE || '/lambdalab/',
  plugins: [react(), tailwindcss()],
  build: {
    // enlace discovers the app's SPA at <app_dir>/frontend/ (see app.toml).
    outDir: 'frontend',
    emptyOutDir: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
