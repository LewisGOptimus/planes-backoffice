import { QueryResultRow } from "pg";
import { AppError } from "@/lib/api/types";
import { query } from "@/lib/db";

type KeyKind = "uuid" | "date" | "text";

export type TableConfig = {
  resource: string;
  tableName: string;
  columns: string[];
  requiredOnCreate?: string[];
  idKeys: { name: string; kind?: KeyKind }[];
};

const asSet = (values: string[]) => new Set(values);

function sanitizePayload(config: TableConfig, payload: Record<string, unknown>) {
  const allowed = asSet(config.columns);
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (allowed.has(key)) {
      data[key] = value;
    }
  }
  return data;
}

function parseKey(kind: KeyKind | undefined, raw: string): string {
  if (kind === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new AppError(400, "VALIDATION_ERROR", `Invalid date key: ${raw}`);
    }
  }
  return raw;
}

function parseComposite(config: TableConfig, parts: string[]): string[] {
  if (parts.length !== config.idKeys.length) {
    throw new AppError(400, "VALIDATION_ERROR", `Expected ${config.idKeys.length} key parts`);
  }

  return config.idKeys.map((key, index) => parseKey(key.kind, decodeURIComponent(parts[index] ?? "")));
}

function buildWhere(keys: { name: string }[]) {
  return keys.map((k, i) => `${k.name} = $${i + 1}`).join(" AND ");
}

export async function listRows(config: TableConfig, searchParams: URLSearchParams) {
  const filters: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const key of config.columns) {
    if (!searchParams.has(key)) continue;
    const value = searchParams.get(key);
    filters.push(`${key} = $${i}`);
    values.push(value);
    i += 1;
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const orderBy = config.columns.includes("created_at")
    ? "ORDER BY created_at DESC NULLS LAST"
    : "";
  const sql = `SELECT * FROM ${config.tableName} ${where} ${orderBy}`;
  const result = await query<QueryResultRow>(sql, values);
  return result.rows;
}

export async function createRow(config: TableConfig, payload: Record<string, unknown>) {
  const data = sanitizePayload(config, payload);

  for (const field of config.requiredOnCreate ?? []) {
    if (data[field] === undefined || data[field] === null || data[field] === "") {
      throw new AppError(400, "VALIDATION_ERROR", `${field} is required`);
    }
  }

  const fields = Object.keys(data);
  if (fields.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "No valid fields for create");
  }

  const params = fields.map((_, i) => `$${i + 1}`).join(", ");
  const values = fields.map((f) => data[f]);

  try {
    const sql = `INSERT INTO ${config.tableName} (${fields.join(", ")}) VALUES (${params}) RETURNING *`;
    const result = await query<QueryResultRow>(sql, values);
    return result.rows[0];
  } catch (error) {
    throw toDbError(error);
  }
}

export async function getRowById(config: TableConfig, keyParts: string[]) {
  const ids = parseComposite(config, keyParts);
  const where = buildWhere(config.idKeys);
  const sql = `SELECT * FROM ${config.tableName} WHERE ${where} LIMIT 1`;
  const result = await query<QueryResultRow>(sql, ids);
  if (result.rowCount === 0) {
    throw new AppError(404, "NOT_FOUND", `${config.resource} not found`);
  }
  return result.rows[0];
}

export async function updateRow(config: TableConfig, keyParts: string[], payload: Record<string, unknown>) {
  const ids = parseComposite(config, keyParts);
  const data = sanitizePayload(config, payload);

  for (const key of config.idKeys) {
    delete data[key.name];
  }

  const fields = Object.keys(data);
  if (fields.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "No valid fields for update");
  }

  const sets = fields.map((f, i) => `${f} = $${i + 1}`);
  if (config.columns.includes("updated_at") && !fields.includes("updated_at")) {
    sets.push("updated_at = now()");
  }
  const where = config.idKeys.map((k, i) => `${k.name} = $${fields.length + i + 1}`).join(" AND ");
  const values = [...fields.map((f) => data[f]), ...ids];

  try {
    const sql = `UPDATE ${config.tableName} SET ${sets.join(", ")} WHERE ${where} RETURNING *`;
    const result = await query<QueryResultRow>(sql, values);
    if (result.rowCount === 0) {
      throw new AppError(404, "NOT_FOUND", `${config.resource} not found`);
    }
    return result.rows[0];
  } catch (error) {
    throw toDbError(error);
  }
}

export async function deleteRow(config: TableConfig, keyParts: string[]) {
  const ids = parseComposite(config, keyParts);
  const where = buildWhere(config.idKeys);

  try {
    const sql = `DELETE FROM ${config.tableName} WHERE ${where} RETURNING *`;
    const result = await query<QueryResultRow>(sql, ids);
    if (result.rowCount === 0) {
      throw new AppError(404, "NOT_FOUND", `${config.resource} not found`);
    }
    return result.rows[0];
  } catch (error) {
    throw toDbError(error);
  }
}

function toDbError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (typeof error === "object" && error && "code" in error) {
    const pgCode = String((error as { code: unknown }).code);
    if (pgCode === "23505") {
      return new AppError(409, "CONFLICT", "Unique constraint violation");
    }
    if (pgCode === "23503") {
      return new AppError(400, "VALIDATION_ERROR", "Foreign key constraint violation");
    }
    if (pgCode === "23514") {
      return new AppError(400, "VALIDATION_ERROR", "Check constraint violation");
    }
  }
  const message = error instanceof Error ? error.message : "Database error";
  return new AppError(500, "INTERNAL_ERROR", message);
}
