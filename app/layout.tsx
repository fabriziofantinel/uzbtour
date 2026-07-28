import type { Metadata } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import "./globals.css";
import "./tour.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "Via della Seta — Uzbekistan, 2–12 agosto 2026",
  description: "Il diario condiviso del nostro viaggio in Uzbekistan"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body className={`${manrope.variable} ${playfair.variable}`}>{children}</body>
    </html>
  );
}
