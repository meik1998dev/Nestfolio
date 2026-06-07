import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

/**
 * Authenticated app layout. Every route in the (app) group renders inside the
 * sidebar shell and requires a session (the proxy guards too; we re-check here).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <AppShell email={user.email ?? ""}>{children}</AppShell>;
}
