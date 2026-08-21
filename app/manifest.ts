import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SMF Travel",
    short_name: "SMF Travel",
    description: "Programmi, documenti, ricordi e attività per ogni viaggio.",
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
