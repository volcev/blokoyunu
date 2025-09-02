const axios = require('axios');

async function sendVerifyWebhook(payload) {
  try {
    const url = process.env.VERIFY_WEBHOOK_URL || '';
    if (!url) return { ok: false, skipped: true };
    await axios.post(url, payload, { timeout: 2000 });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

module.exports = { sendVerifyWebhook };



