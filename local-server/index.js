const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const { parseOrder } = require('./lib/anthropic');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: falta ANTHROPIC_API_KEY en .env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, model: 'claude-haiku-4-5' });
});

app.post('/parse-order', async (req, res) => {
  const { text, clients, todayIso } = req.body || {};

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Falta `text` (string no vacío).' });
  }
  if (!Array.isArray(clients)) {
    return res.status(400).json({ error: '`clients` debe ser un array.' });
  }
  if (!todayIso || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    return res.status(400).json({ error: '`todayIso` debe ser YYYY-MM-DD.' });
  }

  try {
    const result = await parseOrder({ text, clients, todayIso });
    res.json(result);
  } catch (err) {
    console.error('parse-order error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Servidor local en http://localhost:${PORT}`);
  console.log(`  - GET  /health`);
  console.log(`  - POST /parse-order  body: { text, clients, todayIso }`);
});
