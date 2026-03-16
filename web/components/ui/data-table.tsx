import type React from "react";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  headerClassName?: string;
  cellClassName?: string;
  render?: (row: T, index: number) => React.ReactNode;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  emptyMessage?: string;
  className?: string;
};

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "Sin datos",
  className,
}: DataTableProps<T>) {
  return (
    <div
      className={cx(
        "relative overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-[0_1px_2px_rgba(2,6,23,0.06)]",
        className,
      )}
    >
      <table className="min-w-full border-separate border-spacing-0 text-[11px] sm:text-[12px]">
        <thead className="sticky top-0 z-10 bg-gradient-to-r from-[var(--color-primary-500)] to-[var(--color-primary-600)]">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={cx(
                  "px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap text-white/95 sm:px-3 sm:py-2.5 first:rounded-tl-lg last:rounded-tr-lg",
                  c.headerClassName,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)] bg-white">
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-xs font-medium text-[#64748B] sm:px-4 sm:py-8"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr
              key={getRowKey(row, index)}
              className="transition-colors duration-150 even:bg-[#f8fbff] hover:bg-[#eef6ff]"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cx(
                    "px-2.5 py-2 align-middle text-[11px] leading-4 text-[#1E293B] sm:px-3 sm:py-2.5 sm:text-[12px] sm:leading-5",
                    c.cellClassName,
                  )}
                >
                  {c.render
                    ? c.render(row, index)
                    : (row as Record<string, unknown>)[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

