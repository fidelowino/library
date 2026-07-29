{
  "name": "dawamu-library",
  "version": "1.0.0",
  "description": "Book inventory and borrow/return system for Dawamu School Library",
  "main": "server.js",
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "start": "node server.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": ["library", "school", "inventory"],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "bcryptjs": "^3.0.3",
    "cors": "^2.8.6",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "jsonwebtoken": "^9.0.3",
    "pdfkit": "^0.19.1",
    "sql.js": "^1.14.1"
  }
}
