import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  return databaseUrl;
}

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function listMigrationFiles(migrationsDirectory) {
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((leftName, rightName) => leftName.localeCompare(rightName));
}

async function applyPendingMigrations(pool, migrationsDirectory) {
  const migrationFiles = await listMigrationFiles(migrationsDirectory);
  for (const migrationFile of migrationFiles) {
    const migrationVersion = migrationFile.replace(/\.sql$/, '');
    const alreadyApplied = await pool.query('SELECT 1 FROM public.schema_migrations WHERE version = $1 LIMIT 1', [migrationVersion]);

    if (alreadyApplied.rowCount) {
      continue;
    }

    const migrationPath = path.join(migrationsDirectory, migrationFile);
    const migrationSql = await fs.readFile(migrationPath, 'utf8');

    await pool.query('BEGIN');
    try {
      await pool.query(migrationSql);
      await pool.query('INSERT INTO public.schema_migrations(version) VALUES ($1)', [migrationVersion]);
      await pool.query('COMMIT');
      console.log(`applied migration: ${migrationVersion}`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}

async function run() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(currentFilePath), '..', '..');
  const migrationsDirectory = path.join(projectRoot, 'database', 'migrations');
  const pool = new Pool({ connectionString: getDatabaseUrl() });

  try {
    await ensureMigrationsTable(pool);
    await applyPendingMigrations(pool, migrationsDirectory);
    console.log('migrations completed');
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
