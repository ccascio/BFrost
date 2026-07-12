import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const adminPort = Number(process.env.ADMIN_PORT || '3030');
const webPort = Number(process.env.VITE_PORT || process.env.BFROST_WEB_PORT || '5173');

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${adminPort}`,
    },
  },
});
