import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL && !process.env.PGHOST) {
  throw new Error(
    "Database configuration is missing. Set DATABASE_URL or the standard PG* variables.",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ...(process.env.NODE_ENV === "production"
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});