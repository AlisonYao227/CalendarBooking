const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
console.log('Test server starting on port', PORT);
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.json({ ok: true }));
app.listen(PORT, '0.0.0.0', () => console.log('Listening on ' + PORT));
