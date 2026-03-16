"use client";

import { useCallback, useEffect, useState } from "react";
import { CrudModule } from "@/components/backoffice/crud-module";
import { fetchJson, isSuccess } from "@/lib/client/api";
import toast from "react-hot-toast";
import { PageHeaderCard } from "@/components/ui/page-header-card";

type Lookups = {
  suscripciones: Array<{ value: string; label: string }>;
  productos: Array<{ value: string; label: string }>;
};

export default function ProrrateosPage() {
  const [lookups, setLookups] = useState<Lookups>({ suscripciones: [], productos: [] });
  const [openCreate, setOpenCreate] = useState<(() => void) | null>(null);
  const handleCreateRef = useCallback((fn: () => void) => {
    setOpenCreate(() => fn);
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetchJson<Lookups>("/api/backoffice/lookups");
        if (isSuccess(res)) {
          setLookups({
            suscripciones: res.data.suscripciones,
            productos: res.data.productos,
          });
        }
      } catch {
        toast.error("Error de red al cargar suscripciones y productos.");
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="main-stack">
      <PageHeaderCard title="Prorrateos" description="Gestiona los ajustes de cobro prorrateado.">
        <button
          onClick={() => openCreate?.()}
          className="ui-btn ui-btn-primary ui-btn-sm"
          disabled={!openCreate}
        >
          Nuevo
        </button>
      </PageHeaderCard>

      <CrudModule
        title="Prorrateos"
        resource="prorrateos"
        hideModuleHeader
        onCreateRef={handleCreateRef}
        fields={[
          { key: "suscripcion_id", label: "Suscripcion", type: "select", options: lookups.suscripciones },
          { key: "producto_id", label: "Producto", type: "select", options: lookups.productos },
          { key: "desde", label: "Desde", type: "date" },
          { key: "hasta", label: "Hasta", type: "date" },
          { key: "valor_original", label: "Valor original", type: "number" },
          { key: "valor_prorrateado", label: "Valor prorrateado", type: "number" },
        ]}
        columns={[
          { key: "suscripcion_id", label: "Suscripcion" },
          { key: "producto_id", label: "Producto" },
          { key: "desde", label: "Desde" },
          { key: "hasta", label: "Hasta" },
          { key: "valor_original", label: "Original" },
          { key: "valor_prorrateado", label: "Prorrateado" },
        ]}
        initial={{ suscripcion_id: "", producto_id: "", desde: "", hasta: "", valor_original: "0", valor_prorrateado: "0" }}
      />
    </main>
  );
}
