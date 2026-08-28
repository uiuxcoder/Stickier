import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stickier — Your Life as a Sticker Sheet",
  description: "Turn the little things that make you, you into a one-of-one sticker sheet.",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
