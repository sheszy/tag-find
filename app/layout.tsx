import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tag & Find",
  description: "A thoughtful lost-and-found companion for item owners and finders.",
  applicationName: "Tag & Find",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/tag-find-icon.svg",
    apple: "/tag-find-icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tag & Find",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
