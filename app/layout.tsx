import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RealEstateIQ",
  description: "AI-powered real estate deal analysis for first-time investors.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
