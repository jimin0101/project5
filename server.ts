import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  formatFriendlyError,
  runCertAsk,
  runCertResearch,
  type CertResearchInput,
} from './lib/certResearchService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

export async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      keylessReady: true,
      runtime: 'express',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/download-zip', (_req, res) => {
    const zipPath = path.resolve(__dirname, 'jagyeok-baekseo-github.zip');
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'ZIP 파일이 아직 생성되지 않았습니다.' });
    }
    return res.download(zipPath, 'jagyeok-baekseo-github.zip');
  });

  app.post('/api/cert-research', async (req, res) => {
    try {
      const payload = await runCertResearch(req.body as CertResearchInput);
      return res.json(payload);
    } catch (err: unknown) {
      console.error('[/api/cert-research] Error:', err);
      const friendly = formatFriendlyError(err);
      return res.status(friendly.status).json({ error: friendly.message });
    }
  });

  app.post('/api/cert-ask', async (req, res) => {
    try {
      const { certName, question, useKeyless } = req.body as {
        certName?: string;
        question?: string;
        useKeyless?: boolean;
      };
      const payload = await runCertAsk(certName, question, Boolean(useKeyless));
      return res.json(payload);
    } catch (err: unknown) {
      console.error('[/api/cert-ask] Error:', err);
      const friendly = formatFriendlyError(err);
      return res.status(friendly.status).json({ error: friendly.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
