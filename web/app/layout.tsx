import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Extreme Weather Tracker",
  description:
    "A live world map of extreme weather events — storms, floods, wildfires, extreme heat and cold — to observe patterns, transitions and intensity across the globe.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
