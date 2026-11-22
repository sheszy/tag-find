import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Locatelly",
  description: "A thoughtful lost-and-found companion for item owners and finders.",
  applicationName: "Locatelly",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/Locatelly.svg",
    apple: "/Locatelly.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Locatelly",
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
