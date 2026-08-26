import type { Metadata, Viewport } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import "./globals.css";
import ImpersonationBanner from "@/components/impersonation-banner";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "SMF Travel — ogni viaggio in un unico spazio",
  description: "La piattaforma per agenzie, famiglie e viaggiatori.",
  manifest: "/manifest.webmanifest",
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
  themeColor: "#0b6462"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body className={`${manrope.variable} ${playfair.variable}`}>
        <ImpersonationBanner/>
        {children}
      </body>
    </html>
  );
}
