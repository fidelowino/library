const express = require('express');
const router = express.Router();
const { all, get, insert, run } = require('../db/database');
const { authRequired } = require('../middleware/auth');

// GET /api/borrowers?q=search&type=student
router.get('/', authRequired, (req, res) => {
  const { q, type } = req.query;
  let sql = 'SELECT * FROM borrowers WHERE 1=1';
  const params = [];

  if (q) {
    sql += ' AND (name LIKE ? OR identifier LIKE ? OR contact LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  sql += ' ORDER BY name ASC';
  res.json(all(sql, params));
});

// GET /api/borrowers/:id  (includes borrowing history)
router.get('/:id', authRequired, (req, res) => {
  const borrower = get('SELECT * FROM borrowers WHERE id = ?', [req.params.id]);
  if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

  const history = all(
    `SELECT t.*, b.title, b.author FROM transactions t
     JOIN books b ON b.id = t.book_id
     WHERE t.borrower_id = ? ORDER BY t.borrowed_date DESC`,
    [req.params.id]
  );

  res.json({ ...borrower, history });
});

// POST /api/borrowers
router.post('/', authRequired, (req, res) => {
  const { name, type, identifier, class_or_dept, contact } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const id = insert(
    `INSERT INTO borrowers (name, type, identifier, class_or_dept, contact) VALUES (?, ?, ?, ?, ?)`,
    [name, type || 'student', identifier || null, class_or_dept || null, contact || null]
  );

  res.status(201).json(get('SELECT * FROM borrowers WHERE id = ?', [id]));
});

// PUT /api/borrowers/:id
router.put('/:id', authRequired, (req, res) => {
  const borrower = get('SELECT * FROM borrowers WHERE id = ?', [req.params.id]);
  if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

  const { name, type, identifier, class_or_dept, contact } = req.body;
  run(
    `UPDATE borrowers SET name = ?, type = ?, identifier = ?, class_or_dept = ?, contact = ? WHERE id = ?`,
    [
      name ?? borrower.name,
      type ?? borrower.type,
      identifier ?? borrower.identifier,
      class_or_dept ?? borrower.class_or_dept,
      contact ?? borrower.contact,
      req.params.id
    ]
  );

  res.json(get('SELECT * FROM borrowers WHERE id = ?', [req.params.id]));
});

// DELETE /api/borrowers/:id
router.delete('/:id', authRequired, (req, res) => {
  const borrower = get('SELECT * FROM borrowers WHERE id = ?', [req.params.id]);
  if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

  const activeLoans = get(
    "SELECT COUNT(*) as cnt FROM transactions WHERE borrower_id = ? AND status = 'borrowed'",
    [req.params.id]
  );
  if (activeLoans.cnt > 0) {
    return res.status(400).json({ error: 'Cannot delete a borrower with active loans' });
  }

  run('DELETE FROM borrowers WHERE id = ?', [req.params.id]);
  res.json({ message: 'Borrower deleted' });
});

module.exports = router;
