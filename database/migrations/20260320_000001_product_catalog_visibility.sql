DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'product_visibility'
      AND n.nspname = 'billing'
  ) THEN
    CREATE TYPE billing.product_visibility AS ENUM ('PUBLIC', 'PRIVATE');
  END IF;

END $$;

ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS visibility billing.product_visibility NOT NULL DEFAULT 'PRIVATE';
