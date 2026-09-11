import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import express from 'express';
import { mexcRouter } from './server/mexc/mexcRoutes';

function mexcApiPlugin(): Plugin {
  const apiApp = express();
  apiApp.use(express.json());
  apiApp.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'TradeMate Institutional Analytics Backend',
      timestamp: new Date().toISOString(),
    });
  });
  apiApp.use('/api/mexc', mexcRouter);

  const apiMiddleware: express.RequestHandler = (req, res, next) => {
    if (req.url && req.url.startsWith('/api')) {
      apiApp(req, res, next);
    } else {
      next();
    }
  };

  return {
    name: 'mexc-api-server',
    configureServer(server) {
      server.middlewares.use(apiMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), mexcApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
