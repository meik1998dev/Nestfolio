"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Client wrapper so the root server layout can stay a server component. */
export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
