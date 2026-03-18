"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAppState } from "@/lib/client/app-state";

function Dot({ state }: { state: "checking" | "ok" | "down" }) {
  const color =
    state === "ok"
      ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
      : state === "down"
        ? "bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.14)]"
        : "bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.14)]";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

type SidebarItem = { href: string; label: string; icon: string; badge?: number };

const SIDEBAR_SECTIONS: { title: string; items: SidebarItem[] }[] = [
  {
    title: "Admin tools",
    items: [
      { href: "/backoffice", label: "BACKOFFICE", icon: "dashboard" },
      { href: "/trazabilidad-empresas", label: "Trazabilidad Empresas", icon: "file" },
    ],
  },
  {
    title: "Administracion",
    items: [
      { href: "/usuarios", label: "Usuarios", icon: "mail" },
      { href: "/empresas", label: "Empresas", icon: "bell" },
    ],
  },
  {
    title: "Catalogo",
    items: [
      { href: "/productos", label: "Productos", icon: "box" },
      { href: "/planes", label: "Planes", icon: "megaphone" },
      { href: "/entitlements", label: "Entitlements", icon: "chat" },
    ],
  },
  {
    title: "Operacion",
    items: [
      { href: "/operaciones", label: "Operaciones", icon: "gear" },
      { href: "/suscripciones", label: "Suscripciones", icon: "calendar" },
      { href: "/contratos", label: "Contratos", icon: "file" },
      { href: "/facturas", label: "Facturas", icon: "wallet" },
      { href: "/prorrateos", label: "Prorrateos", icon: "file" },
    ],
  },
];

function NavIcon({ icon }: { icon: string }) {
  const cls = "h-4 w-4 shrink-0";
  switch (icon) {
    case "dashboard":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      );
    case "box":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      );
    case "megaphone":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      );
    case "calendar":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case "wallet":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      );
    case "file":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "gear":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 2.31.826 1.37 1.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 2.31-1.37 1.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-2.31-.826-1.37-1.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-2.31 1.37-1.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "mail":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case "bell":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      );
    case "chat":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      );
    default:
      return null;
  }
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { health } = useAppState();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsUserMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileSidebarOpen]);

  const navItemClass = (active: boolean) =>
    `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
      active
        ? "bg-[linear-gradient(130deg,#007bff_0%,#1b66db_100%)] text-white shadow-[0_8px_20px_rgba(0,123,255,0.24)]"
        : "text-[#475569] hover:bg-white hover:text-[#1E293B] hover:shadow-[0_6px_18px_rgba(15,23,42,0.07)]"
    }`;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#F5F7FB]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_-10%,rgba(0,123,255,0.12),rgba(245,247,251,0)_68%)]" />
      <div className="pointer-events-none absolute -left-28 top-20 h-72 w-72 rounded-full bg-[#007bff]/[0.08] blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-40 h-80 w-80 rounded-full bg-[#60A5FA]/[0.12] blur-3xl" />

      <header className="sticky top-0 z-40 border-b border-[#E2E8F0]/90 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] w-full items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3 md:gap-4">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E8F0] bg-white text-[#1E293B] shadow-[0_4px_14px_rgba(15,23,42,0.06)] transition-colors hover:bg-[#F1F5F9] md:hidden"
              onClick={() => setIsMobileSidebarOpen((open) => !open)}
              aria-label="Abrir menú"
            >
              <span className="sr-only">Toggle sidebar</span>
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
              </svg>
            </button>
            <Link href="/backoffice" className="flex items-center gap-3">
              <Image
                src="/nubeLogo.png"
                alt="Zoe Nube"
                width={100}
                height={40}
                className="h-9 w-auto sm:h-10"
                priority
              />
              <div className="hidden sm:block">
                <span className="block text-base font-bold tracking-tight text-[#007bff]">BACKOFFICE</span>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                  Zoe Nube
                </span>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-1.5 text-xs font-medium text-[#1E3A8A] sm:flex">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#475569]">Monitoreo</span>
              <span className="inline-flex items-center gap-1.5"><Dot state={health.api} />API</span>
              <span className="inline-flex items-center gap-1.5"><Dot state={health.db} />DB</span>
            </div>

            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-1.5 shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition-colors hover:border-[#BFDBFE] hover:bg-[#F8FBFF] sm:px-3"
                aria-expanded={isUserMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsUserMenuOpen((open) => !open)}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2563EB]/10 ring-1 ring-[#93C5FD]/40">
                  <span className="text-xs font-semibold text-[#2563EB]">U</span>
                </div>
                <div className="hidden text-left sm:block">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">Operador</p>
                  <p className="text-sm font-semibold text-[#1E293B]">Admin</p>
                </div>
                <svg
                  className={`h-4 w-4 text-slate-500 transition-transform ${isUserMenuOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

              {isUserMenuOpen ? (
                <div
                  className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-48 rounded-2xl border border-[#E2E8F0] bg-white p-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.12)]"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[#1E293B] transition-colors hover:bg-[#F1F5F9]"
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    Configuración
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[#1E293B] transition-colors hover:bg-[#F1F5F9]"
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    Cerrar sesión
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-col md:flex-row">
        {isMobileSidebarOpen && (
          <div className="fixed inset-0 z-30 bg-slate-900/45 backdrop-blur-[1px] md:hidden" onClick={() => setIsMobileSidebarOpen(false)}>
            <aside
              className="fixed inset-y-0 left-0 w-72 border-r border-[#D9E5F6] bg-[linear-gradient(180deg,#F8FBFF_0%,#F3F7FC_45%,#F7F9FE_100%)] pt-[72px] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex h-full flex-col">
                <nav className="flex-1 overflow-y-auto px-4 py-5">
                  {SIDEBAR_SECTIONS.map((section) => (
                    <div key={section.title} className="pt-4 first:pt-0">
                      <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-[#64748B]">
                        {section.title}
                      </p>
                      <div className="space-y-1">
                        {section.items.map((item) => {
                          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={navItemClass(active)}
                              onClick={() => setIsMobileSidebarOpen(false)}
                            >
                              <NavIcon icon={item.icon} />
                              <span className="flex-1">{item.label}</span>
                              {item.badge != null && item.badge > 0 ? (
                                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-inherit">
                                  {item.badge}
                                </span>
                              ) : null}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </nav>

              </div>
            </aside>
          </div>
        )}

        <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:w-[17rem] md:border-r md:border-[#D9E5F6] md:bg-[linear-gradient(180deg,#F8FBFF_0%,#F3F7FC_45%,#F7F9FE_100%)] md:pt-[72px] md:block">
          <div className="flex h-full flex-col">
            <nav className="flex-1 overflow-y-auto px-4 py-5">
              {SIDEBAR_SECTIONS.map((section) => (
                <div key={section.title} className="pt-4 first:pt-0">
                  <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-[#64748B]">
                    {section.title}
                  </p>
                  <div className="space-y-1">
                    {section.items.map((item) => {
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <Link key={item.href} href={item.href} className={navItemClass(active)}>
                          <NavIcon icon={item.icon} />
                          <span className="flex-1">{item.label}</span>
                          {item.badge != null && item.badge > 0 ? (
                            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-inherit">
                              {item.badge}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

          </div>
        </aside>

        <main className="min-w-0 flex-1 pt-4 md:pl-[17rem] md:pt-6">
          <div className="mx-auto w-full px-4 pb-8 md:px-6 xl:px-8">
            <div className="main-shell shadow-none">
              <div className="main-shell-content">{children}</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
