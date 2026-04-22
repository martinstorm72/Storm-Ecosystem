// ==========================================================
// config.example.js — EXAMPLE TEMPLATE
// Copy this file and rename it to config.js locally.
// NEVER commit config.js to GitHub — it is in .gitignore
// ==========================================================
//
// To set up:
//   1. Copy this file → config.js
//   2. Fill in your real values in config.js
//   3. config.js is gitignored and stays on your machine only
//
// For deployment (GitHub Pages):
//   - GROQ_API_KEY → leave empty, handled by Cloudflare Worker
//   - SUPABASE_URL / SUPABASE_KEY → set in your hosting config
// ==========================================================

window.__APP_CONFIG__ = {
    // Supabase — get from: https://supabase.com/dashboard → Project Settings → API
    SUPABASE_URL: 'https://mryishzprrgpxauoccmr.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yeWlzaHpwcnJncHhhdW9jY21yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTI5MTEsImV4cCI6MjA4OTY4ODkxMX0.i1-354vLtuvNWorGMYFXhqb8C-1DOlGjavAzOnli5UQ',

    // Groq — NOT needed here anymore, key is secured in Cloudflare Worker
    // See: https://late-term-eeff.martinsamer91.workers.dev/
    GROQ_API_KEY: '',
};
