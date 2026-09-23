import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RAWIA Financial Controller", template: "%s · RAWIA Finance" },
  description: "Daily sales, replenishment reserve and financial control for RAWIA CAFE.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
