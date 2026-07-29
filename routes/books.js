const express = require('express');
const router = express.Router();
const { all, get, insert, run } = require('../db/database');
const { authRequired } = require('../middleware/auth');

// GET /api/books?q=search&category=&available=true
router.get('/', authRequired, (req, res) => {
  const { q, category, available } = req.query;
  let sql = 'SELECT * FROM books WHERE 1=1';
  const params = [];

  if (q) {
    sql += ' AND (title LIKE ? OR author LIKE ? OR isbn LIKE ? OR book_code LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (available === 'true') {
    sql += ' AND copies_available > 0';
  }

  sql += ' ORDER BY title ASC';
  res.json(all(sql, params));
});

// GET /api/books/:id
router.get('/:id', authRequired, (req, res) => {
  const book = get('SELECT * FROM books WHERE id = ?', [req.params.id]);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  res.json(book);
});

// POST /api/books
router.post('/', authRequired, (req, res) => {
  const { title, author, isbn, category, publisher, year, shelf_location, copies_total, book_code, date_received, delivered_by } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  if (book_code) {
    const dupe = get('SELECT id FROM books WHERE book_code = ?', [book_code]);
    if (dupe) return res.status(409).json({ error: 'A book with this code already exists' });
  }

  const total = copies_total ? parseInt(copies_total) : 1;
  const id = insert(
    `INSERT INTO books (book_code, title, author, isbn, category, publisher, year, shelf_location, copies_total, copies_available, date_received, delivered_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [book_code || null, title, author || null, isbn || null, category || null, publisher || null, year || null, shelf_location || null, total, total, date_received || null, delivered_by || null]
  );

  res.status(201).json(get('SELECT * FROM books WHERE id = ?', [id]));
});

// PUT /api/books/:id
router.put('/:id', authRequired, (req, res) => {
  const book = get('SELECT * FROM books WHERE id = ?', [req.params.id]);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const { title, author, isbn, category, publisher, year, shelf_location, copies_total, book_code, date_received, delivered_by } = req.body;

  if (book_code && book_code !== book.book_code) {
    const dupe = get('SELECT id FROM books WHERE book_code = ? AND id != ?', [book_code, req.params.id]);
    if (dupe) return res.status(409).json({ error: 'A book with this code already exists' });
  }

  let newTotal = book.copies_total;
  let newAvailable = book.copies_available;
  if (copies_total !== undefined) {
    const diff = parseInt(copies_total) - book.copies_total;
    newTotal = parseInt(copies_total);
    newAvailable = Math.max(0, book.copies_available + diff);
  }

  run(
    `UPDATE books SET book_code = ?, title = ?, author = ?, isbn = ?, category = ?, publisher = ?, year = ?, shelf_location = ?, copies_total = ?, copies_available = ?, date_received = ?, delivered_by = ?
     WHERE id = ?`,
    [
      book_code ?? book.book_code,
      title ?? book.title,
      author ?? book.author,
      isbn ?? book.isbn,
      category ?? book.category,
      publisher ?? book.publisher,
      year ?? book.year,
      shelf_location ?? book.shelf_location,
      newTotal,
      newAvailable,
      date_received ?? book.date_received,
      delivered_by ?? book.delivered_by,
      req.params.id
    ]
  );

  res.json(get('SELECT * FROM books WHERE id = ?', [req.params.id]));
});

// DELETE /api/books/:id
router.delete('/:id', authRequired, (req, res) => {
  const book = get('SELECT * FROM books WHERE id = ?', [req.params.id]);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const activeLoans = get(
    "SELECT COUNT(*) as cnt FROM transactions WHERE book_id = ? AND status = 'borrowed'",
    [req.params.id]
  );
  if (activeLoans.cnt > 0) {
    return res.status(400).json({ error: 'Cannot delete a book with active loans' });
  }

  run('DELETE FROM books WHERE id = ?', [req.params.id]);
  res.json({ message: 'Book deleted' });
});

// GET /api/books/meta/categories - distinct categories for filter dropdown
router.get('/meta/categories', authRequired, (req, res) => {
  const rows = all("SELECT DISTINCT category FROM books WHERE category IS NOT NULL AND category != '' ORDER BY category");
  res.json(rows.map(r => r.category));
});

// GET /api/books/export/pdf - inventory list as a PDF
router.get('/export/pdf', authRequired, (req, res) => {
  const PDFDocument = require('pdfkit');
  const books = all('SELECT * FROM books ORDER BY title ASC');

  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="book_inventory.pdf"');
  doc.pipe(res);

  doc.fontSize(16).text('Dawamu School Library — Book Inventory', { align: 'left' });
  doc.fontSize(9).fillColor('#555').text(`Generated ${new Date().toISOString().split('T')[0]}`, { align: 'left' });
  doc.moveDown(1);

  const cols = [
    { label: 'Code', key: 'book_code', width: 60 },
    { label: 'Title', key: 'title', width: 190 },
    { label: 'Author', key: 'author', width: 120 },
    { label: 'Category', key: 'category', width: 110 },
    { label: 'Shelf', key: 'shelf_location', width: 70 },
    { label: 'Total', key: 'copies_total', width: 45 },
    { label: 'Available', key: 'copies_available', width: 60 },
    { label: 'Received', key: 'date_received', width: 70 },
    { label: 'Delivered by', key: 'delivered_by', width: 100 },
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
  books.forEach(b => {
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage({ margin: 40, size: 'A4', layout: 'landscape' });
      y = doc.page.margins.top;
      drawHeader();
    }
    let x = startX;
    cols.forEach(c => {
      const val = b[c.key] ?? '';
      doc.text(String(val), x, y, { width: c.width });
      x += c.width;
    });
    y += 16;
  });

  doc.end();
});

module.exports = router;
