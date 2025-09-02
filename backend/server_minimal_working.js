const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Basic routes
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/test/system', (req, res) => res.json({ status: 'ok', message: 'Minimal server working' }));

// PATCH /gridb/:index - Simple implementation
app.patch('/gridb/:index', (req, res) => {
  const index = req.params.index;
  res.json({
    success: true,
    message: `GridB block ${index} attacked (minimal)`,
    index: index
  });
});

// Start server
app.listen(3001, () => {
  console.log('Minimal GridB server running on port 3001');
});
