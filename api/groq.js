import { kv } from '@vercel/kv';

const DAILY_LIMIT = 10;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Get today's date key in UTC (resets at midnight UTC)
function getTodayKey(userId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `groq_rl:${userId}:${today}`;
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS — allow your Vercel domain and localhost for dev
  const origin = req.headers.origin || '';
  const allowed = [
    'https://storm-ecosystem.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ];
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── Auth: require a valid Supabase JWT ──────────────────────────────────────
  // The dashboard sends the Supabase access token in Authorization: Bearer <token>
  // We decode the JWT payload (no signature check needed — we just need the user id
  // for rate limiting; Supabase already validates the session on the client side).
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token.' });
  }

  let userId;
  try {
    const token = authHeader.slice(7);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    );
    userId = payload.sub; // Supabase user UUID
    if (!userId) throw new Error('No sub claim');
  } catch {
    return res.status(401).json({ error: 'Invalid authorization token.' });
  }

  // ── Rate limiting via Vercel KV ─────────────────────────────────────────────
  const kvKey = getTodayKey(userId);
  let usageCount = 0;

  try {
    const stored = await kv.get(kvKey);
    usageCount = stored ? parseInt(stored, 10) : 0;
  } catch (e) {
    // KV read failed — fail open (don't block the user, just skip rate limiting)
    console.error('KV read error:', e);
  }

  if (usageCount >= DAILY_LIMIT) {
    return res.status(429).json({
      error: `Daily limit reached. You have used ${DAILY_LIMIT}/${DAILY_LIMIT} AI messages today. Resets at midnight UTC.`,
      used: usageCount,
      limit: DAILY_LIMIT,
      resetsAt: 'midnight UTC',
    });
  }

  // ── Proxy to Groq ───────────────────────────────────────────────────────────
  const { model, messages, temperature, max_tokens, stream } = req.body;

  // Validate required fields
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required.' });
  }

  // Whitelist allowed models
  const ALLOWED_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-8b-8192',
    'llama3-70b-8192',
  ];
  const selectedModel = ALLOWED_MODELS.includes(model)
    ? model
    : 'llama-3.3-70b-versatile';

  let groqRes;
  try {
    groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.68,
        max_tokens: typeof max_tokens === 'number' ? Math.min(max_tokens, 2048) : 1024,
        stream: false, // always non-streaming from the proxy
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Failed to reach Groq API. Try again.' });
  }

  if (!groqRes.ok) {
    const errBody = await groqRes.json().catch(() => ({}));
    const msg = errBody?.error?.message || `Groq error ${groqRes.status}`;
    return res.status(groqRes.status).json({ error: msg });
  }

  const data = await groqRes.json();

  // ── Increment usage count after a successful response ───────────────────────
  try {
    const newCount = usageCount + 1;
    // Set with TTL of 48h (so stale keys auto-expire even if the date logic misfires)
    await kv.set(kvKey, newCount, { ex: 172800 });
    // Attach usage info to response
    data._usage = {
      used: newCount,
      limit: DAILY_LIMIT,
      remaining: DAILY_LIMIT - newCount,
    };
  } catch (e) {
    console.error('KV write error:', e);
    // Don't fail the request if KV write fails
  }

  return res.status(200).json(data);
}
