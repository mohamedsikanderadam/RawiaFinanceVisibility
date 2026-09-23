import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __rawiaFinancePool?: Pool };
const pool =
  globalForDb.__rawiaFinancePool ??
  new Pool({
    connectionString,
    max: 10,
    ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });
if (process.env.NODE_ENV !== "production") globalForDb.__rawiaFinancePool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
