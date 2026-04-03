// ================================================================
// STORM OS — PayPal PDT Verification
// Vercel Serverless Function: /api/verify-payment.js
//
// DEPLOY INSTRUCTIONS:
//   1. In your Vercel project (storm-ecosystem), create the folder /api/
//   2. Place THIS FILE inside it as: /api/verify-payment.js
//   3. Push to GitHub — Vercel auto-deploys it
//   4. Done. No env vars needed — token is embedded below.
//
// SECURITY NOTE:
//   This token only lets you READ transaction details from PayPal.
//   It cannot initiate payments or access your account.
//   It is safe to keep server-side in this file.
// ================================================================

const PDT_TOKEN = "TbwH1sUBTxzEFh7LDcIB-R5YzEyJflFjA2ULXJj1pNr1wVOUy_5VciNyPqm";
const PAYPAL_ENDPOINT = "https://www.paypal.com/cgi-bin/webscr";
const EXPECTED_AMOUNT = 14.99;
const ALLOWED_ORIGIN  = "https://storm-ecosystem.vercel.app";

export default async function handler(req, res) {

    // ── CORS headers ──────────────────────────────────────────────
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

    // ── Get tx from request body ──────────────────────────────────
    const { tx } = req.body || {};

    if (!tx || typeof tx !== "string" || tx.length < 10) {
        return res.status(400).json({ valid: false, reason: "Missing or invalid tx" });
    }

    // ── Call PayPal PDT endpoint ──────────────────────────────────
    let ppText;
    try {
        const ppRes = await fetch(PAYPAL_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                cmd: "_notify-synch",
                tx:  tx,
                at:  PDT_TOKEN
            }).toString()
        });
        ppText = await ppRes.text();
    } catch (err) {
        console.error("PayPal PDT fetch error:", err);
        return res.status(502).json({ valid: false, reason: "PayPal unreachable" });
    }

    // ── Parse PayPal response ─────────────────────────────────────
    // Format: first line = "SUCCESS" or "FAIL"
    // Remaining lines: key=value pairs (URL-encoded)
    const lines = ppText.split("\n");
    const firstLine = lines[0]?.trim();

    if (firstLine !== "SUCCESS") {
        console.warn("PayPal PDT returned:", firstLine, "for tx:", tx);
        return res.json({ valid: false, reason: "PayPal did not confirm this transaction" });
    }

    const data = {};
    lines.slice(1).forEach(line => {
        const eqIdx = line.indexOf("=");
        if (eqIdx === -1) return;
        const key = line.slice(0, eqIdx).trim();
        const val = decodeURIComponent(line.slice(eqIdx + 1).trim().replace(/\+/g, " "));
        data[key] = val;
    });

    // ── Validate: status + amount ─────────────────────────────────
    const paymentStatus = data["payment_status"];
    const grossAmount   = parseFloat(data["mc_gross"] || "0");

    const valid =
        paymentStatus === "Completed" &&
        grossAmount >= EXPECTED_AMOUNT;

    if (!valid) {
        console.warn("PDT validation failed:", { paymentStatus, grossAmount, tx });
    }

    return res.json({
        valid,
        // Only expose minimal info (not full PayPal payload)
        ...(valid ? {} : { reason: "Payment status: " + paymentStatus + ", Amount: $" + grossAmount })
    });
}
