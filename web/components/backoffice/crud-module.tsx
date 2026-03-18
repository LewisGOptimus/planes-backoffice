"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { formatDateOnly, looksLikeDateField } from "@/lib/client/date-format";
import { formatMoney, looksLikeMoneyField } from "@/lib/client/currency-format";
import toast from "react-hot-toast";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { AppModal } from "@/components/ui/modal";

type FieldType = "text" | "number" | "date" | "select";

type Field = {
  key: string;
  label: string;
  type?: FieldType;
  options?: Array<{ value: string; label: string }>;
  getOptions?: (form: Record<string, string>) => Array<{ value: string; label: string }>;
  onChange?: (nextValue: string, nextForm: Record<string, string>) => Record<string, string> | void;
};

type Column = {
  key: string;
  label: string;
  badge?: boolean;
  options?: Array<{ value: string; label: string }>;
};

type Row = Record<string, unknown> & { id?: string };

type Props = {
  title: string;
  resource: string;
  fields: Field[];
  columns: Column[];
  initial: Record<string, string>;
  hideModuleHeader?: boolean;
  onCreateRef?: (openCreate: () => void) => void;
};

function formatCell(value: unknown, badge?: boolean, key?: string, options?: Array<{ value: string; label: string }>) {
  const mapped = options?.find((option) => option.value === String(value ?? ""))?.label;
  const text = key && looksLikeDateField(key)
    ? formatDateOnly(value)
    : key && looksLikeMoneyField(key)
      ? formatMoney(value)
      : mapped ?? String(value ?? "-");
  if (!badge) return text;
  return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{text}</span>;
}

export function CrudModule({
  title,
  resource,
  fields,
  columns,
  initial,
  hideModuleHeader = false,
  onCreateRef,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const initialRef = useRef(initial);

  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);

  const orderedRows = useMemo(() => [...rows], [rows]);
  const selectOptionsByKey = useMemo(
    () =>
      fields.reduce<Record<string, Array<{ value: string; label: string }>>>((acc, field) => {
        if (field.type === "select" && field.options) acc[field.key] = field.options;
        return acc;
      }, {}),
    [fields],
  );

  const tableColumns: DataTableColumn<Row>[] = [
      {
        key: "__index",
        header: "#",
        headerClassName: "text-white bg-[var(--color-primary)]",
        cellClassName: "text-slate-700 w-[40px]",
        render: (_row, index) => index + 1,
      },
      ...columns.map<DataTableColumn<Row>>((c) => ({
        key: c.key,
        header: c.label,
        headerClassName: "text-white bg-[var(--color-primary)]",
        cellClassName: "text-slate-700",
        render: (row) => formatCell(row[c.key], c.badge, c.key, c.options ?? selectOptionsByKey[c.key]),
      })),
      {
        key: "__actions",
        header: "Acciones",
        headerClassName: "text-white bg-[var(--color-primary)]",
        cellClassName: "",
        render: (row) => (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => openEdit(row)}
              className="ui-btn ui-btn-primary ui-btn-sm"
            >
              Editar
            </button>
            <button
              onClick={() => remove(row)}
              className="ui-btn ui-btn-danger ui-btn-sm"
            >
              Eliminar
            </button>
          </div>
        ),
      },
    ];

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetchJson<Row[]>(`/api/v1/${resource}`);
    setLoading(false);
    if (isSuccess(res)) setRows(res.data);
  }, [resource]);

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(initialRef.current);
    setModalOpen(true);
  }, []);

  useEffect(() => {
    if (onCreateRef) onCreateRef(openCreate);
  }, [onCreateRef, openCreate]);

  const openEdit = (row: Row) => {
    setEditingId(String(row.id));
    const next: Record<string, string> = {};
    for (const f of fields) next[f.key] = String(row[f.key] ?? "");
    setForm(next);
    setModalOpen(true);
  };

  const parsePayload = (raw: Record<string, string>) => {
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const value = raw[f.key];
      if (value === "") continue;
      if (f.type === "number") payload[f.key] = Number(value);
      else if (value === "true") payload[f.key] = true;
      else if (value === "false") payload[f.key] = false;
      else payload[f.key] = value;
    }
    return payload;
  };

  const save = async () => {
    try {
      const endpoint = editingId ? `/api/v1/${resource}/${editingId}` : `/api/v1/${resource}`;
      const method = editingId ? "PATCH" : "POST";
      const res = await fetchJson<Row>(endpoint, { method, body: parsePayload(form) });
      if (isSuccess(res)) {
        const m = editingId ? "Registro actualizado." : "Registro creado.";
        setMessage(m);
        toast.success(m);
        setModalOpen(false);
        await refresh();
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al guardar.");
    }
  };

  const remove = async (row: Row) => {
    try {
      if (!row.id) return;
      const res = await fetchJson<Row>(`/api/v1/${resource}/${row.id}`, { method: "DELETE" });
      if (isSuccess(res)) {
        setMessage("Registro eliminado.");
        toast.success("Registro eliminado.");
        await refresh();
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al eliminar.");
    }
  };

  return (
    <section className="main-card main-stack w-full shadow-none">
      {!hideModuleHeader ? (
        <div className="main-section-header">
          <h2 className="main-section-title">{title}</h2>
          <button onClick={openCreate} className="ui-btn ui-btn-primary ui-btn-sm">Nuevo</button>
        </div>
      ) : null}
      <DataTable
        columns={tableColumns}
        rows={orderedRows}
        getRowKey={(row, index) => `${String(row.id ?? "")}-${index}`}
        className="max-h-[620px] overflow-auto rounded border border-slate-200"
      />
      <p className="text-xs text-slate-600">{loading ? "Cargando..." : message}</p>

      <AppModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        maxWidthClassName="max-w-3xl"
        title={editingId ? `Editar ${title}` : `Nuevo ${title}`}
        description="Completa los campos y guarda los cambios para actualizar el registro."
        footer={(
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button onClick={() => setModalOpen(false)} className="ui-btn ui-btn-outline">Cancelar</button>
            <button onClick={save} className="ui-btn ui-btn-primary">Guardar</button>
          </div>
        )}
      >
        <div className="grid gap-2 md:grid-cols-2">
          {fields.map((f) => (
            <label key={f.key} className="text-xs text-slate-700">
              {f.label}
              {f.type === "select" ? (
                <select
                  value={form[f.key] ?? ""}
                  onChange={(e) =>
                    setForm((p) => {
                      const base = { ...p, [f.key]: e.target.value };
                      return f.onChange?.(e.target.value, base) ?? base;
                    })
                  }
                  className="mt-1 ui-input"
                >
                  <option value="">Seleccionar...</option>
                  {(f.getOptions ? f.getOptions(form) : (f.options ?? [])).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={form[f.key] ?? ""}
                  onChange={(e) =>
                    setForm((p) => {
                      const base = { ...p, [f.key]: e.target.value };
                      return f.onChange?.(e.target.value, base) ?? base;
                    })
                  }
                  className="mt-1 ui-input"
                />
              )}
            </label>
          ))}
        </div>
      </AppModal>
      
    </section>
  );
}

