import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { listPortfolios } from "@/lib/portfolio/portfolios";
import {
  portfolioNavLinks,
  type PortfolioNavLink,
} from "@/lib/portfolio/nav-links";

/**
 * Authenticated app layout. Every route in the (app) group renders inside the
 * sidebar shell and requires a session (the proxy guards too; we re-check here).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCachedUser();

  if (!user) redirect("/login");

  // Sidebar quick links to each portfolio. Best-effort: a failed read must
  // never take down the whole shell — the nav just omits the links.
  let portfolioLinks: PortfolioNavLink[] = [];
  try {
    portfolioLinks = portfolioNavLinks(await listPortfolios());
  } catch {
    // degrade to the static nav
  }

  return (
    <AppShell email={user.email ?? ""} portfolioLinks={portfolioLinks}>
      {children}
    </AppShell>
  );
}
