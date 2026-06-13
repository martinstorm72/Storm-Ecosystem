const DAILY_LIMIT = 10;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function getTodayKey(userId) {
  const today = new Date().toISOString().slice(0, 10);
  return `groq_rl:${userId}:${today}`;
}

// Upstash Redis REST helpers — uses REDIS_URL env var injected by Vercel
async function redisGet(key) {
  const url = `${process.env.REDIS_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result; // null or string value
}

async function redisSet(key, value, exSeconds) {
  const url = `${process.env.REDIS_URL}/set/${encodeURIComponent(key)}/${value}/ex/${exSeconds}`;
  await fetch(url);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  // ── Auth ────────────────────────────────────────────────────────────────────
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
    userId = payload.sub;
    if (!userId) throw new Error('No sub claim');
  } catch {
    return res.status(401).json({ error: 'Invalid authorization token.' });
  }

  // ── Rate limiting via Upstash Redis ─────────────────────────────────────────
  const kvKey = getTodayKey(userId);
  let usageCount = 0;

  try {
    const stored = await redisGet(kvKey);
    usageCount = stored ? parseInt(stored, 10) : 0;
  } catch (e) {
    // Redis read failed — fail open
  }

  if (usageCount >= DAILY_LIMIT) {
    return res.status(429).json({
      error: `Daily limit reached. You have used ${DAILY_LIMIT}/${DAILY_LIMIT} AI messages today. Resets at midnight UTC.`,
      used: usageCount,
      limit: DAILY_LIMIT,
    });
  }

  // ── Proxy to Groq ────────────────────────────────────────────────────────────
  const { model, messages, temperature, max_tokens } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required.' });
  }

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
        stream: false,
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

  // ── Increment usage count ────────────────────────────────────────────────────
  try {
    const newCount = usageCount + 1;
    await redisSet(kvKey, newCount, 172800); // 48h TTL
    data._usage = {
      used: newCount,
      limit: DAILY_LIMIT,
      remaining: DAILY_LIMIT - newCount,
    };
  } catch (e) {
    // Don't fail the request if Redis write fails
  }

  return res.status(200).json(data);
}
