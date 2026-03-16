import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

declare global {
  var __pgPool: Pool | undefined;
}

function getDatabaseUrlOrThrow(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

export function getPool(): Pool {
  if (global.__pgPool) {
    return global.__pgPool;
  }

  const pool = new Pool({ connectionString: getDatabaseUrlOrThrow() });

  if (process.env.NODE_ENV !== "production") {
    global.__pgPool = pool;
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, values);
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function pingDb(): Promise<void> {
  await query("SELECT 1");
}
