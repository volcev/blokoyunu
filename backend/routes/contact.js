const express = require('express');
const fs = require('fs');
const path = require('path');
const { validateSession } = require('../lib/session');
const logger = require('../lib/logger');

const router = express.Router();

// POST /api/contact: Handle contact form submissions
router.post('/api/contact', async (req, res) => {
  const { name, email, message, username } = req.body;

  const sessionToken = req.headers.authorization?.replace('Bearer ', '');
  if (!sessionToken) {
    return res.status(401).json({ error: 'Authentication required. Please log in to send a message.' });
  }

  const isValidSession = await validateSession(sessionToken);
  if (!isValidSession) {
    return res.status(401).json({ error: 'Invalid session. Please log in again.' });
  }

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    const contactData = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      name: String(name).trim(),
      email: String(email).trim(),
      message: String(message).trim(),
      username: username || 'Anonymous',
      ip: req.ip,
      status: 'new'
    };

    const contactsFile = path.join(__dirname, '..', 'contacts.json');
    let contacts = [];
    try {
      if (fs.existsSync(contactsFile)) {
        const data = fs.readFileSync(contactsFile, 'utf8');
        contacts = JSON.parse(data);
      }
    } catch {}

    contacts.unshift(contactData);
    if (contacts.length > 1000) contacts = contacts.slice(0, 1000);

    fs.writeFileSync(contactsFile, JSON.stringify(contacts, null, 2));

    return res.json({ success: true, message: 'Your message has been received. We will get back to you soon!' });
  } catch (error) {
    logger.error('Contact form error:', error);
    return res.status(500).json({ error: 'Failed to process your message. Please try again.' });
  }
});

// GET /api/admin/contacts: View all contact messages (admin only)
router.get('/api/admin/contacts', async (req, res) => {
  try {
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required. Admin access only.' });
    }

    const isValidSession = await validateSession(sessionToken);
    if (!isValidSession) {
      return res.status(401).json({ error: 'Invalid session. Please log in again.' });
    }

    const contactsFile = path.join(__dirname, '..', 'contacts.json');
    if (!fs.existsSync(contactsFile)) {
      return res.json([]);
    }
    const data = fs.readFileSync(contactsFile, 'utf8');
    const contacts = JSON.parse(data);
    return res.json(contacts);
  } catch (error) {
    logger.error('Error reading contacts:', error);
    return res.status(500).json({ error: 'Failed to load contacts' });
  }
});

module.exports = router;


