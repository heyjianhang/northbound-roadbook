import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, loadEnv } from 'vite';
import { createAccountsMiddleware } from './scripts/accounts.mjs';
import { createAgentMiddleware } from './scripts/agent.mjs';
import { createAmapMiddleware } from './scripts/amap-proxy.mjs';
export default defineConfig({
  plugins: [
    vinext(),
    sites(),
    {
      name: 'roadbook-amap',
      configureServer(server) {
        const env = {
          ...loadEnv(server.config.mode, process.cwd(), ''),
          ...process.env,
        };
        const accounts = createAccountsMiddleware(env);
        const agent = createAgentMiddleware(env);
        server.middlewares.use(accounts);
        server.middlewares.use(agent);
        server.httpServer?.once('close', () => {
          agent.close();
          accounts.close();
        });
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
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/.runtime/**',
        '**/.venv/**',
        '**/*.{sqlite,sqlite-shm,sqlite-wal,db,db-shm,db-wal}',
      ],
    },
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    watch: {
      useFsEvents: false,
      usePolling: true,
      ignored: ['**/.runtime/**', '**/.venv/**', '**/__pycache__/**'],
    },
  },
});
