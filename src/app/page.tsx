import { redirect } from "next/navigation";

/** Root sends straight to the app; the proxy redirects to /login if signed out. */
export default function Home() {
  redirect("/dashboard");
}
