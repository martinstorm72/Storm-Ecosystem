// api/gemini.js — Vercel Serverless Function
// The API key lives ONLY here as an environment variable.
// It is never exposed to the browser.

const DAILY_LIMIT = 30;

// In-memory store for rate limiting (resets on cold start, good enough for free tier)
// For production persistence, replace with Vercel KV or Upstash Redis.
const usageMap = new Map(); // key: "YYYY-MM-DD", value: count

function getTodayKey() {
    return new Date().toISOString().split('T')[0];
}

export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // CORS — allow same origin only (your Vercel domain)
    const origin = req.headers.origin || '';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // ── Server-side daily rate limit ─────────────────────────────
    const today = getTodayKey();
    const currentCount = usageMap.get(today) || 0;

    if (currentCount >= DAILY_LIMIT) {
        return res.status(429).json({
            error: `Daily limit of ${DAILY_LIMIT} requests reached. Resets at midnight UTC.`
        });
    }

    // ── Validate request body ────────────────────────────────────
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || prompt.length < 10) {
        return res.status(400).json({ error: 'Invalid prompt' });
    }

    if (prompt.length > 4000) {
        return res.status(400).json({ error: 'Prompt too long' });
    }

    // ── Read key from environment (never from client) ────────────
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY environment variable not set');
        return res.status(503).json({ error: 'AI service not configured' });
    }

    // ── Call Gemini ──────────────────────────────────────────────
    try {
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
                })
            }
        );

        if (!geminiRes.ok) {
            const errData = await geminiRes.json().catch(() => ({}));
            const msg = errData?.error?.message || `Gemini HTTP ${geminiRes.status}`;
            console.error('Gemini API error:', msg);
            return res.status(502).json({ error: 'AI service error. Try again.' });
        }

        const data = await geminiRes.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            return res.status(502).json({ error: 'Empty response from AI' });
        }

        // ── Increment counter only on success ────────────────────
        usageMap.set(today, currentCount + 1);

        // Clean up old date keys to avoid memory leak
        for (const key of usageMap.keys()) {
            if (key !== today) usageMap.delete(key);
        }

        return res.status(200).json({ text, remaining: DAILY_LIMIT - (currentCount + 1) });

    } catch (err) {
        console.error('Proxy error:', err.message);
        return res.status(503).json({ error: 'AI service temporarily unavailable' });
    }
}
