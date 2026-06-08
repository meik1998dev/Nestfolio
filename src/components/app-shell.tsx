"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, Gem } from "lucide-react";
import { NAV_ITEMS } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * App chrome: a slim fixed sidebar (desktop) that collapses to a slide-over
 * (mobile). Server layout passes the user's email and the sign-out control.
 */
export function AppShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive(href)
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-svh">
      {/* Desktop sidebar */}
      <aside className="bg-card sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r md:flex">
        <Brand />
        {nav}
        <UserFooter email={email} />
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="bg-card absolute inset-y-0 left-0 flex w-60 flex-col border-r">
            <div className="flex items-center justify-between">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                className="mr-2"
                onClick={() => setMobileOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            {nav}
            <UserFooter email={email} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-4 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-4" />
          </Button>
          <span className="font-semibold">Nestfolio</span>
          <ThemeToggle className="ml-auto" />
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-16 items-center gap-2 px-5">
      <Gem className="text-primary size-5" />
      <span className="text-lg font-bold tracking-tight">Nestfolio</span>
    </div>
  );
}

function UserFooter({ email }: { email: string }) {
  return (
    <div className="mt-auto border-t p-3">
      <div className="flex items-center gap-1 pb-2">
        <p
          className="text-muted-foreground truncate px-2 text-xs"
          title={email}
        >
          {email}
        </p>
        <ThemeToggle className="ml-auto shrink-0" />
      </div>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="outline" size="sm" className="w-full">
          Sign out
        </Button>
      </form>
    </div>
  );
}
