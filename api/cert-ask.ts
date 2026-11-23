import { formatFriendlyError, runCertAsk } from '../lib/certResearchService.js';

interface SimpleReq {
  method?: string;
  body?: unknown;
}

interface SimpleRes {
  setHeader?: (name: string, value: string) => void;
  status: (code: number) => SimpleRes;
  json: (body: unknown) => void;
}

function normalizeBody<T>(raw: unknown): T {
  if (typeof raw === 'string') {
    return (raw ? JSON.parse(raw) : {}) as T;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    const str = raw.toString('utf8');
    return (str ? JSON.parse(str) : {}) as T;
  }
  return (raw ?? {}) as T;
}

export default async function handler(req: SimpleReq, res: SimpleRes) {
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const parsedBody = normalizeBody<{ certName?: string; question?: string; useKeyless?: boolean }>(
      req.body
    );
    const payload = await runCertAsk(
      parsedBody.certName,
      parsedBody.question,
      Boolean(parsedBody.useKeyless)
    );
    return res.status(200).json(payload);
  } catch (err: unknown) {
    console.error('[api/cert-ask] Error:', err);
    const friendly = formatFriendlyError(err);
    return res.status(friendly.status).json({ error: friendly.message });
  }
}
