const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'library.sqlite');
let SQL = null;
let db = null;

function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDB() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'librarian',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_code TEXT,
      title TEXT NOT NULL,
      author TEXT,
      isbn TEXT,
      category TEXT,
      publisher TEXT,
      year INTEGER,
      shelf_location TEXT,
      copies_total INTEGER NOT NULL DEFAULT 1,
      copies_available INTEGER NOT NULL DEFAULT 1,
      date_received TEXT,
      delivered_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS borrowers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'student', -- student | staff
      identifier TEXT, -- admission no / staff no
      class_or_dept TEXT,
      contact TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      borrower_id INTEGER NOT NULL,
      borrowed_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      returned_date TEXT,
      status TEXT NOT NULL DEFAULT 'borrowed', -- borrowed | returned | overdue
      notes TEXT,
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (borrower_id) REFERENCES borrowers(id)
    );
  `);

  migrate();
  persist();
  return db;
}

// Adds columns to existing databases created before a schema change, without
// touching data. Safe to run on every startup.
function migrate() {
  const bookCols = db.exec("PRAGMA table_info(books)")[0]?.values.map(r => r[1]) || [];
  const addIfMissing = (table, col, def) => {
    if (!bookCols.includes(col)) db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addIfMissing('books', 'book_code', 'TEXT');
  addIfMissing('books', 'date_received', 'TEXT');
  addIfMissing('books', 'delivered_by', 'TEXT');
}

// Helper: run a write query (INSERT/UPDATE/DELETE)
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  persist();
}

// Helper: get all rows
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: get single row
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

// Helper: insert and return last inserted id
function insert(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  const idRow = get('SELECT last_insert_rowid() as id');
  persist();
  return idRow.id;
}

module.exports = { initDB, run, all, get, insert, persist };
