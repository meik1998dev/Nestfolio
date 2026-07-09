import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nestfolio",
    short_name: "Nestfolio",
    description:
      "Personal wealth command center — net worth, portfolios, and PnL.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1110",
    theme_color: "#0b1110",
    icons: [
      {
        src: "/icons/nestfolio-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/nestfolio-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/nestfolio-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
