"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  async function signInWithGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Nestfolio</h1>
        <p className="text-sm text-gray-500">
          Sign in to your wealth command center.
        </p>
      </div>
      <Button onClick={signInWithGoogle} size="lg">
        Continue with Google
      </Button>
    </main>
  );
}
