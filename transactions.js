require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const { initDB, get, insert } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 5500;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  await initDB();

  // Seed a default admin account if none exists yet
  const existingAdmin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    insert(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
      ['admin', hash]
    );
    console.log('Seeded default admin -> username: admin | password: admin123 (change this immediately)');
  }

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/books', require('./routes/books'));
  app.use('/api/borrowers', require('./routes/borrowers'));
  app.use('/api/transactions', require('./routes/transactions'));

  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Dawamu Library' }));

  app.listen(PORT, () => {
    console.log(`Dawamu Library server running on http://localhost:${PORT}`);
  });
}

start();
