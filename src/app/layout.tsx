import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Inter — a highly legible screen UI typeface. `cv11`/`ss01` give it the
// single-story 'a'/'g' and tabular figures that read cleanly in finance data.
const sans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Monospace for addresses, hashes, and tabular numerics.
const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Nestfolio",
    template: "%s · Nestfolio",
  },
  description:
    "Personal wealth command center — net worth, portfolios, and PnL.",
  // Installable-PWA hints. `manifest`, `icon`, and `apple-icon` <link> tags are
  // auto-injected by Next from manifest.ts / icon.tsx / apple-icon.tsx.
  applicationName: "Nestfolio",
  appleWebApp: {
    capable: true,
    title: "Nestfolio",
    statusBarStyle: "black-translucent",
  },
};

// Browser UI / mobile address-bar tint. Matches the app's emerald accent on
// dark, with a light fallback so the bar isn't jarring in light mode.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#059669" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
