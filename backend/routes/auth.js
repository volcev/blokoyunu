const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/login', async (req, res) => {
  try { const r = await axios.post('http://localhost:3002/login', req.body); return res.json(r.data); }
  catch (error) { if (error.response) return res.status(error.response.status).json(error.response.data); return res.status(500).json({ error: 'Auth server connection failed' }); }
});

router.post('/signup', async (req, res) => {
  try { const r = await axios.post('http://localhost:3002/signup', req.body); return res.json(r.data); }
  catch (error) { if (error.response) return res.status(error.response.status).json(error.response.data); return res.status(500).json({ error: 'Auth server connection failed' }); }
});

router.get('/verify-email', async (req, res) => {
  try { const r = await axios.get('http://localhost:3002/verify-email', { params: req.query }); return res.json(r.data); }
  catch (error) { if (error.response) return res.status(error.response.status).json(error.response.data); return res.status(500).json({ error: 'Auth server connection failed' }); }
});

router.post('/forgot-password', async (req, res) => {
  try { const r = await axios.post('http://localhost:3002/forgot-password', req.body); return res.json(r.data); }
  catch (error) { if (error.response) return res.status(error.response.status).json(error.response.data); return res.status(500).json({ error: 'Auth server connection failed' }); }
});

router.post('/reset-password', async (req, res) => {
  try { const r = await axios.post('http://localhost:3002/reset-password', req.body); return res.json(r.data); }
  catch (error) { if (error.response) return res.status(error.response.status).json(error.response.data); return res.status(500).json({ error: 'Auth server connection failed' }); }
});

module.exports = router;



