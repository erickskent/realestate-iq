import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RealEstateIQ",
  description:
    "Analyze rental properties with RealEstateIQ. Calculate cash flow, cap rates, investment returns, and risks with AI-powered insights to make smarter real estate decisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
