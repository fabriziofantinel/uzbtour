import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Via della Seta · Uzbekistan 2026",
    short_name: "UZB Tour",
    description: "Programma, ricordi, spese e giochi del viaggio in Uzbekistan.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f3eb",
    theme_color: "#0b6462",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ]
  };
}
