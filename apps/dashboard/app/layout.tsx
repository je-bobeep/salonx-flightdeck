import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "salonx-flightdeck",
  description: "Personal PM ops tooling for SalonX",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
