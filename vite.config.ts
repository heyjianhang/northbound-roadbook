import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, loadEnv } from 'vite';
import { createAmapMiddleware } from './scripts/amap-proxy.mjs';
export default defineConfig({
  plugins: [
    vinext(),
    sites(),
    {
      name: 'roadbook-amap',
      configureServer(server) {
        server.middlewares.use(
          createAmapMiddleware({
            ...loadEnv(server.config.mode, process.cwd(), ''),
            ...process.env,
          }),
        );
      },
    },
    {
      name: 'roadbook-navigation-chunks',
      enforce: 'post',
      configEnvironment(name) {
        if (name === 'client')
          return {
            build: {
              rolldownOptions: {
                // Vinext dynamically imports runtime namespaces. Vite's
                // relaxed entry signatures can drop those callable exports.
                preserveEntrySignatures: 'strict',
              },
            },
          };
      },
    },
  ],
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    watch: { useFsEvents: false, usePolling: true },
  },
});
