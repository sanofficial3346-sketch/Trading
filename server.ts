import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { mexcRouter } from './server/mexc/mexcRoutes';
import { databaseRouter } from './server/db/databaseRoutes';
import { marketRouter } from './server/marketData/marketRoutes';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'TradeMate Institutional Analytics Backend',
      timestamp: new Date().toISOString(),
    });
  });

  // Mount Persistent Database Health and Management Router
  app.use('/api/database', databaseRouter);

  // Mount MEXC Futures Read-Only Integration Router (Private Accounts)
  app.use('/api/mexc', mexcRouter);

  // Mount Public Market Data & Setup Lab Router (No API keys required)
  app.use('/api/market', marketRouter);

  // Vite middleware for development / static serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TradeMate Server active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
