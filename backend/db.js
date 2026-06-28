const Database = require('better-sqlite3');
const path = require('path');

// Point to the sqlite file created in Step 1
const dbPath = path.join(__dirname, '..', 'db', 'beauty_store.db');

// Readonly because these handlers only fetch context string info
const db = new Database(dbPath, { fileMustExist: true, readonly: true });

module.exports = db;
