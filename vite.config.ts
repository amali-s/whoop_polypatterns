import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honor an externally assigned port (e.g. the preview harness) so a second
  // dev server can run beside the default 5173 one; falls back to Vite's own
  // default when PORT is unset.
  server: process.env.PORT !== undefined ? { port: Number(process.env.PORT) } : undefined,
});
