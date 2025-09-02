const axios = require('axios');

async function validateSession(sessionToken) {
  try {
    if (String(process.env.VOLCHAIN_SANDBOX || '') === '1') {
      const tok = String(sessionToken || '');
      if (tok.startsWith('test:')) {
        const parts = tok.split(':');
        const uname = parts[1] || '';
        return uname || null;
      }
    }
    const response = await axios.post('http://localhost:3002/validate-session', { sessionToken });
    if (response.data && response.data.valid) {
      return response.data.username;
    }
    return null;
  } catch (error) {
    console.error('[validateSession] Axios request failed:', error.message);
    return null;
  }
}

module.exports = { validateSession };



