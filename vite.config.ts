import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honor an externally assigned port (e.g. the preview harness) so a second
  // dev server can run beside the default 5173 one; falls back to Vite's own
  // default when PORT is unset. A PORT-assigned instance also gets its own
  // dep-optimizer cache dir — two concurrent vite instances sharing
  // node_modules/.vite can race re-optimization and serve each other's
  // clients stale deps. `vercel dev` / `npm run dev` (no PORT) are unchanged.
  ...(process.env.PORT !== undefined
    ? {
        server: { port: Number(process.env.PORT) },
        cacheDir: `node_modules/.vite-port-${process.env.PORT}`,
      }
    : {}),
});
