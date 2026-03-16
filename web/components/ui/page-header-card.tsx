import type React from "react";

type PageHeaderCardProps = {
  title: string;
  description?: string;
  /** Contenido opcional adicional (botones, filtros, etc.) */
  children?: React.ReactNode;
};

export function PageHeaderCard({ title, description, children }: PageHeaderCardProps) {
  return (
    <section className="relative overflow-hidden rounded-[18px] border border-[#DCE8F7] bg-[linear-gradient(135deg,#FDFEFF_0%,#F5F9FF_65%,#EEF5FF_100%)] p-4 sm:p-5">
      <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-[#007bff]/10 blur-3xl" />
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="relative z-10 min-w-0">
          <h2 className="text-lg leading-tight font-semibold text-[var(--color-primary)] sm:text-xl">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-600/95">{description}</p> : null}
        </div>
        {children ? (
          <div className="relative z-10 flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">{children}</div>
        ) : null}
      </div>
    </section>
  );
}

