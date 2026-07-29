const express = require('express');
const router = express.Router();
const { all, get, insert, run } = require('../db/database');
const { authRequired } = require('../middleware/auth');

const DEFAULT_LOAN_DAYS = 14;

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// GET /api/transactions?status=&borrower_id=&book_id=&q=
// q matches against book title or book_code, for quick lookups at the desk
router.get('/', authRequired, (req, res) => {
  const { status, borrower_id, book_id, q } = req.query;
  let sql = `
    SELECT t.*, b.title, b.author, b.book_code, b.category, br.name as borrower_name, br.type as borrower_type, br.identifier as borrower_identifier, br.class_or_dept
    FROM transactions t
    JOIN books b ON b.id = t.book_id
    JOIN borrowers br ON br.id = t.borrower_id
    WHERE 1=1`;
  const params = [];

  if (status) {
    sql += ' AND t.status = ?';
    params.push(status);
  }
  if (borrower_id) {
    sql += ' AND t.borrower_id = ?';
    params.push(borrower_id);
  }
  if (book_id) {
    sql += ' AND t.book_id = ?';
    params.push(book_id);
  }
  if (q) {
    sql += ' AND (b.title LIKE ? OR b.book_code LIKE ? OR br.name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  sql += ' ORDER BY t.borrowed_date DESC';
  res.json(all(sql, params));
});

// GET /api/transactions/overdue
router.get('/overdue', authRequired, (req, res) => {
  const today = todayStr();
  const rows = all(
    `SELECT t.*, b.title, b.author, b.book_code, br.name as borrower_name, br.contact, br.identifier as borrower_identifier, br.class_or_dept
     FROM transactions t
     JOIN books b ON b.id = t.book_id
     JOIN borrowers br ON br.id = t.borrower_id
     WHERE t.status = 'borrowed' AND t.due_date < ?
     ORDER BY t.due_date ASC`,
    [today]
  );
  res.json(rows);
});

// POST /api/transactions/borrow
router.post('/borrow', authRequired, (req, res) => {
  const { book_id, borrower_id, loan_days } = req.body;
  if (!book_id || !borrower_id) {
    return res.status(400).json({ error: 'book_id and borrower_id are required' });
  }

  const book = get('SELECT * FROM books WHERE id = ?', [book_id]);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  if (book.copies_available < 1) {
    return res.status(400).json({ error: 'No copies available for this book' });
  }

  const borrower = get('SELECT * FROM borrowers WHERE id = ?', [borrower_id]);
  if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

  const borrowedDate = todayStr();
  const dueDate = addDays(borrowedDate, loan_days || DEFAULT_LOAN_DAYS);

  const id = insert(
    `INSERT INTO transactions (book_id, borrower_id, borrowed_date, due_date, status) VALUES (?, ?, ?, ?, 'borrowed')`,
    [book_id, borrower_id, borrowedDate, dueDate]
  );

  run('UPDATE books SET copies_available = copies_available - 1 WHERE id = ?', [book_id]);

  res.status(201).json(get('SELECT * FROM transactions WHERE id = ?', [id]));
});

// POST /api/transactions/return/:id
router.post('/return/:id', authRequired, (req, res) => {
  const txn = get('SELECT * FROM transactions WHERE id = ?', [req.params.id]);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  if (txn.status === 'returned') {
    return res.status(400).json({ error: 'Book already returned' });
  }

  const returnedDate = todayStr();

  run(
    `UPDATE transactions SET status = 'returned', returned_date = ? WHERE id = ?`,
    [returnedDate, req.params.id]
  );
  run('UPDATE books SET copies_available = copies_available + 1 WHERE id = ?', [txn.book_id]);

  res.json(get('SELECT * FROM transactions WHERE id = ?', [req.params.id]));
});

function fetchAllTransactions(scope) {
  let sql = `
    SELECT t.id, b.book_code, b.title, b.author, br.name as borrower_name, br.type as borrower_type,
           br.identifier as borrower_identifier, br.class_or_dept,
           t.borrowed_date, t.due_date, t.returned_date, t.status, t.notes
    FROM transactions t
    JOIN books b ON b.id = t.book_id
    JOIN borrowers br ON br.id = t.borrower_id`;
  const params = [];
  if (scope === 'borrowed') {
    sql += ' WHERE t.status = ?';
    params.push('borrowed');
  } else if (scope === 'exchanged') {
    sql += " WHERE t.notes LIKE 'Exchanged%'";
  }
  sql += ' ORDER BY t.borrowed_date DESC';
  return all(sql, params);
}

const EXPORT_LABELS = {
  borrowed: { title: 'Unreturned Books', filename: 'unreturned_books' },
  exchanged: { title: 'Exchanged Books', filename: 'exchanged_books' },
};

// GET /api/transactions/export/csv?status=borrowed|exchanged (omit for all records)
router.get('/export/csv', authRequired, (req, res) => {
  const scope = req.query.status;
  const rows = fetchAllTransactions(scope);
  const label = EXPORT_LABELS[scope];

  const header = 'ID,Book Code,Book Title,Author,Borrower,Admission/Staff No.,Grade/Dept.,Borrower Type,Borrowed Date,Due Date,Returned Date,Status,Notes\n';
  const csvRows = rows.map(r =>
    [r.id, r.book_code, r.title, r.author, r.borrower_name, r.borrower_identifier, r.class_or_dept, r.borrower_type, r.borrowed_date, r.due_date, r.returned_date || '', r.status, r.notes || '']
      .map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`)
      .join(',')
  );

  const csv = header + csvRows.join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${label ? label.filename : 'library_transactions'}.csv"`);
  res.send(csv);
});

// GET /api/transactions/export/pdf?status=borrowed|exchanged (omit for all records)
router.get('/export/pdf', authRequired, (req, res) => {
  const PDFDocument = require('pdfkit');
  const scope = req.query.status;
  const rows = fetchAllTransactions(scope);
  const label = EXPORT_LABELS[scope];

  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${label ? label.filename : 'library_transactions'}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).text(`Dawamu School Library — ${label ? label.title : 'Loan Records'}`, { align: 'left' });
  doc.fontSize(9).fillColor('#555').text(`Generated ${todayStr()}`, { align: 'left' });
  doc.moveDown(1);

  const cols = [
    { label: 'Code', key: 'book_code', width: 55 },
    { label: 'Title', key: 'title', width: 150 },
    { label: 'Borrower', key: 'borrower_name', width: 110 },
    { label: 'Adm/Staff No.', key: 'borrower_identifier', width: 85 },
    { label: 'Grade/Dept.', key: 'class_or_dept', width: 85 },
    { label: 'Borrowed', key: 'borrowed_date', width: 65 },
    { label: 'Due', key: 'due_date', width: 65 },
    { label: 'Returned', key: 'returned_date', width: 65 },
    { label: 'Status', key: 'status', width: 60 },
  ];

  let y = doc.y;
  const startX = doc.page.margins.left;
  doc.fontSize(9).fillColor('#000');

  function drawHeader() {
    let x = startX;
    doc.font('Helvetica-Bold');
    cols.forEach(c => { doc.text(c.label, x, y, { width: c.width }); x += c.width; });
    doc.font('Helvetica');
    y += 16;
    doc.moveTo(startX, y - 3).lineTo(startX + cols.reduce((a, c) => a + c.width, 0), y - 3).strokeColor('#ccc').stroke();
  }

  drawHeader();
  rows.forEach(r => {
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage({ margin: 40, size: 'A4', layout: 'landscape' });
      y = doc.page.margins.top;
      drawHeader();
    }
    let x = startX;
    cols.forEach(c => {
      const val = r[c.key] ?? (c.key === 'returned_date' ? '—' : '');
      doc.text(String(val), x, y, { width: c.width });
      x += c.width;
    });
    y += 16;
  });

  doc.end();
});

// POST /api/transactions/exchange/:id
// For consumable exercise books (single ruled, graph, square ruled): the student's
// filled book is retired from circulation entirely (not returned to the shelf),
// and a fresh copy of the same title is issued to them in one step.
router.post('/exchange/:id', authRequired, (req, res) => {
  const txn = get('SELECT * FROM transactions WHERE id = ?', [req.params.id]);
  if (!txn) return res.status(404).json({ error: 'Record not found' });
  if (txn.status !== 'borrowed') {
    return res.status(400).json({ error: 'This book is not currently checked out' });
  }

  const book = get('SELECT * FROM books WHERE id = ?', [txn.book_id]);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  if (book.copies_available < 1) {
    return res.status(400).json({ error: 'No fresh copies in stock to issue a replacement' });
  }

  const today = todayStr();

  // Old copy is filled and permanently retired — total stock drops by one,
  // and it was never counted back into "available" since it's not going back on the shelf.
  run(
    `UPDATE transactions SET status = 'returned', returned_date = ?, notes = 'Exchanged - book filled' WHERE id = ?`,
    [today, req.params.id]
  );
  run('UPDATE books SET copies_total = copies_total - 1, copies_available = copies_available - 1 WHERE id = ?', [book.id]);

  // Issue a fresh copy to the same student. Exercise books aren't due back on a
  // schedule, so give this a long horizon rather than the usual 14-day loan.
  const dueDate = addDays(today, 365);
  const newId = insert(
    `INSERT INTO transactions (book_id, borrower_id, borrowed_date, due_date, status) VALUES (?, ?, ?, ?, 'borrowed')`,
    [book.id, txn.borrower_id, today, dueDate]
  );

  res.status(201).json(get(
    `SELECT t.*, b.title, b.book_code, b.category FROM transactions t JOIN books b ON b.id = t.book_id WHERE t.id = ?`,
    [newId]
  ));
});

module.exports = router;
