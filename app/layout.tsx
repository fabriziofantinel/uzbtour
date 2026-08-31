import type { Metadata, Viewport } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import "./globals.css";
import "./accessibility.css";
import ImpersonationBanner from "@/components/impersonation-banner";
import ServiceWorkerRegister from "@/components/service-worker-register";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "SMF Travel — ogni viaggio in un unico spazio",
  description: "La piattaforma per agenzie, gruppi e viaggiatori.",
  manifest: "/api/pwa/manifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SMF Travel"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#153f43"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body className={`${manrope.variable} ${playfair.variable}`}>
        <ServiceWorkerRegister/>
        <ImpersonationBanner/>
        {children}
      </body>
    </html>
  );
}
