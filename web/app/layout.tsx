import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { AppStateProvider } from "@/lib/client/app-state";
import { AppFrame } from "@/components/app-frame";
import { ToastProvider } from "@/components/toast-provider";

const body = Montserrat({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "POC Planes",
  description: "Prueba de concepto visual e interactiva para planes y suscripciones",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${body.variable} antialiased`}>
        <AppStateProvider>
          <ToastProvider />
          <AppFrame>{children}</AppFrame>
        </AppStateProvider>
      </body>
    </html>
  );
}
