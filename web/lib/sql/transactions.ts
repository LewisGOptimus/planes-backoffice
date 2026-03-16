import { PoolClient } from "pg";
import { withClient } from "@/lib/db";

export async function runInTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function lockIdempotencyKey(client: PoolClient, key: string): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock((('x' || substr(md5($1), 1, 16))::bit(64))::bigint)",
    [key],
  );
}
