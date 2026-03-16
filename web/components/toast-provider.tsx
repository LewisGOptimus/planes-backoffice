"use client";

import { Toaster } from "react-hot-toast";

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3000,
        style: {
          border: "1px solid #cbd5e1",
          padding: "10px 12px",
          color: "#0f172a",
          background: "#ffffff",
          fontSize: "12px",
        },
      }}
    />
  );
}
