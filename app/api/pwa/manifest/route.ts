import { NextResponse } from "next/server";
import { getTravelerPwaBranding } from "@/lib/platform/pwa-branding";

export const dynamic = "force-dynamic";

export async function GET() {
  const branding = await getTravelerPwaBranding();
  const name = branding?.agencyName || "SMF Travel";
  const color = branding?.primaryColor || "#247a6b";
  const logoSource = branding?.logoUrl ? Buffer.from(branding.logoUrl, "utf8").toString("base64url") : "";
  const icon = (size: 192 | 512) =>
    logoSource ? `/api/pwa/icon?size=${size}&source=${encodeURIComponent(logoSource)}` : `/icons/icon-${size}.png`;
  return NextResponse.json(
    {
      id: branding ? `/viaggio?agenzia=${encodeURIComponent(branding.agencyId)}` : "/viaggio",
      name,
      short_name: name,
      description: `Programma, documenti, spese e attività del viaggio con ${name}, disponibili anche offline.`,
      lang: "it",
      start_url: "/viaggio",
      scope: "/",
      display: "standalone",
      display_override: ["window-controls-overlay", "standalone"],
      orientation: "portrait",
      theme_color: color,
      background_color: "#faf7f0",
      categories: ["travel", "lifestyle"],
      icons: [
        { src: icon(192), sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: icon(512), sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
      shortcuts: [
        {
          name: "Programma di oggi",
          short_name: "Oggi",
          url: "/viaggio?tab=programma&day=oggi",
          icons: [{ src: "/icons/shortcut-programme.png", sizes: "96x96", type: "image/png" }],
        },
        {
          name: "Spese e cassa",
          short_name: "Spese",
          url: "/viaggio?tab=spese",
          icons: [{ src: "/icons/shortcut-expenses.png", sizes: "96x96", type: "image/png" }],
        },
        {
          name: "Voucher e documenti",
          short_name: "Documenti",
          url: "/viaggio?tab=documenti",
          icons: [{ src: "/icons/shortcut-documents.png", sizes: "96x96", type: "image/png" }],
        },
      ],
    },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
}
