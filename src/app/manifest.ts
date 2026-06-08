import type { MetadataRoute } from "next";

// PWA web app manifest — drives "Add to Home Screen" / installable app on
// Android and desktop Chrome. The scalable SVG covers every density; it is
// declared as both `any` and `maskable` so Android can mask it cleanly.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nestfolio",
    short_name: "Nestfolio",
    description:
      "Personal wealth command center — net worth, portfolios, and PnL.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#059669",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  };
}
