import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  metadataBase: new URL("https://stickier.app"),
  title: "Stickier — Your Life as a Sticker Sheet",
  description: "Turn the little things that make you, you into a one-of-one sticker sheet.",
  openGraph: {
    title: "Stickier — Your Life as a Sticker Sheet",
    description: "Turn photos into a one-of-one sticker sheet.",
    type: "website",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
