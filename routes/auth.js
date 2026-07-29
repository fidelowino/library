const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const dbHelpers = require('../db/database');
const { SECRET, authRequired, adminOnly } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const { get } = require('../db/database');
  const user = get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: '12h' }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// POST /api/auth/register (admin only, for creating new librarian accounts)
router.post('/register', authRequired, adminOnly, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const { get, insert } = require('../db/database');
  const existing = get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const id = insert(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    [username, hash, role || 'librarian']
  );

  res.status(201).json({ id, username, role: role || 'librarian' });
});

// PUT /api/auth/change-password (any logged-in user, changes their own password)
router.put('/change-password', authRequired, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const { get, run } = require('../db/database');
  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const valid = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = bcrypt.hashSync(newPassword, 10);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

  res.json({ message: 'Password updated' });
});

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

module.exports = router;
