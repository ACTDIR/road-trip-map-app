import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Road Trip Map",
  description: "Interactive road trip map with photo pins, routing, notes, and live location.",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
