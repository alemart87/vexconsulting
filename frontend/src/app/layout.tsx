import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VEX Consulting",
  description: "Plataforma de investigación de mercado · Voicenter S.A.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
