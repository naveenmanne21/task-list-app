import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Task List",
  description: "A small task list with CSV import",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
