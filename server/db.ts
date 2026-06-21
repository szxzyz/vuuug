import pkg from 'pg';
const { Pool } = pkg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "../shared/schema";

const connectionString = process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set for database connection");
}

// SSL only for remote/cloud DBs (Aiven, Neon, etc.)
// Local PostgreSQL (localhost / 127.0.0.1) does NOT need SSL
const isLocalDb = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  ...(isLocalDb ? {} : { ssl: { rejectUnauthorized: false } }),
});

export const db = drizzle(pool, { schema });
