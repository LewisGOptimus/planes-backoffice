"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchJson, isSuccess } from "@/lib/client/api";

type HealthState = {
  api: "checking" | "ok" | "down";
  db: "checking" | "ok" | "down";
  seedEnabled: boolean;
};

type HistoryItem = {
  id: string;
  title: string;
  endpoint: string;
  ok: boolean;
  timestamp: string;
};

type AppStateValue = {
  health: HealthState;
  history: HistoryItem[];
  addHistory: (item: Omit<HistoryItem, "id" | "timestamp">) => void;
  refreshHealth: () => Promise<void>;
};

const STORAGE_KEY = "planes_poc_history";
const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<HealthState>({ api: "checking", db: "checking", seedEnabled: false });
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as HistoryItem[];
      return parsed.slice(0, 30);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 30)));
  }, [history]);

  const refreshHealth = async () => {
    const [apiResult, dbResult, metaResult] = await Promise.all([
      fetchJson<{ ok: boolean }>("/api/health"),
      fetchJson<{ ok: boolean }>("/api/health/db"),
      fetchJson<{ seedEnabled: boolean }>("/api/v1/meta/health"),
    ]);

    setHealth({
      api: isSuccess(apiResult) ? "ok" : "down",
      db: isSuccess(dbResult) ? "ok" : "down",
      seedEnabled: isSuccess(metaResult) ? Boolean(metaResult.data.seedEnabled) : false,
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        await fetchJson<{ ok: boolean }>("/api/backoffice/bootstrap", { method: "POST" });
        await refreshHealth();
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const addHistory = (item: Omit<HistoryItem, "id" | "timestamp">) => {
    setHistory((prev) => [
      {
        ...item,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const value = useMemo(
    () => ({
      health,
      history,
      addHistory,
      refreshHealth,
    }),
    [health, history],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return ctx;
}
