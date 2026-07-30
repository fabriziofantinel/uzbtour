import type { Metadata, Viewport } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import "./globals.css";
import "./tour.css";
import "./challenges.css";
import "leaflet/dist/leaflet.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "Via della Seta — Uzbekistan, 1–13 agosto 2026",
  description: "Il diario condiviso del nostro viaggio in Uzbekistan",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "UZB Tour"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b6462"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body className={`${manrope.variable} ${playfair.variable}`}>{children}</body>
    </html>
  );
}
