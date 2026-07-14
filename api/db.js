const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("WARNING: DATABASE_URL environment variable is not defined.");
}

const pool = new Pool({
  connectionString,
  ssl: connectionString && (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'))
    ? false
    : { rejectUnauthorized: false }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
