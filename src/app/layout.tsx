import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { logoutAction } from "./(auth)/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Task List",
  description: "A small task list with CSV import",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              Task List
            </Link>
            {user && (
              <nav className="header-nav">
                <Link href="/tasks">Tasks</Link>
                <Link href="/import">Import</Link>
                <span className="muted">{user.email}</span>
                <form action={logoutAction}>
                  <button type="submit" className="link-button">
                    Sign out
                  </button>
                </form>
              </nav>
            )}
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
