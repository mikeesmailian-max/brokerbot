import type { Metadata } from "next";
import "./globals.css";

// Every page is behind the sign-in gate, so nothing may be stored by a shared cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Freight Command",
  description: "Your freight broker command center",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
