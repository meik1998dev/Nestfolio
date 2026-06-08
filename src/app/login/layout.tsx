import type { Metadata } from "next";

// The login page itself is a Client Component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Nestfolio account.",
};

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
