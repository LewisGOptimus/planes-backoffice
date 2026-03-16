"use client";

import { useCallback, useState } from "react";
import { CrudModule } from "@/components/backoffice/crud-module";
import { PageHeaderCard } from "@/components/ui/page-header-card";

const USER_FIELDS = [
  { key: "email", label: "Email" },
  { key: "nombre", label: "Nombre" },
  {
    key: "activo",
    label: "Activo",
    type: "select" as const,
    options: [
      { value: "true", label: "Activo" },
      { value: "false", label: "Inactivo" },
    ],
  },
];

const USER_COLUMNS = [
  { key: "email", label: "Email" },
  { key: "nombre", label: "Nombre" },
  { key: "activo", label: "Estado", badge: true },
];

const USER_INITIAL = { email: "", nombre: "", activo: "true" };

export default function UsuariosPage() {
  const [openCreate, setOpenCreate] = useState<(() => void) | null>(null);
  const handleCreateRef = useCallback((fn: () => void) => {
    setOpenCreate(() => fn);
  }, []);

  return (
    <div className="main-stack">
      <PageHeaderCard
        title="Usuarios"
        description="Usuarios de la aplicación."
      >
        <button
          onClick={() => openCreate?.()}
          className="ui-btn ui-btn-primary ui-btn-sm"
          disabled={!openCreate}
        >
          Nuevo
        </button>
      </PageHeaderCard>

      <CrudModule
        title="Usuarios"
        resource="usuarios"
        hideModuleHeader
        onCreateRef={handleCreateRef}
        fields={USER_FIELDS}
        columns={USER_COLUMNS}
        initial={USER_INITIAL}
      />
    </div>
  );
}

