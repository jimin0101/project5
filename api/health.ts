interface SimpleReq {
  method?: string;
}

interface SimpleRes {
  setHeader?: (name: string, value: string) => void;
  status: (code: number) => SimpleRes;
  json: (body: unknown) => void;
}

export default function handler(req: SimpleReq, res: SimpleRes) {
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  return res.status(200).json({
    ok: true,
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    keylessReady: true,
    runtime: 'vercel-serverless',
    timestamp: new Date().toISOString(),
  });
}
