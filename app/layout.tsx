import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  metadataBase: new URL("https://saltysticker.com"),
  title: "Salty Sticker™ — Your Life as a Sticker Sheet",
  description: "Turn the little things that make you, you into a one-of-one sticker sheet.",
  openGraph: {
    title: "Salty Sticker™ — Your Life as a Sticker Sheet",
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
        {/* Before paint, mark v2 sessions so the SSR'd v1 hero stays hidden
            until hydration swaps in the v2 landing (no wrong-variant flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var p=new URLSearchParams(location.search).get('landing');var v=(p==='v1'||p==='v2')?p:sessionStorage.getItem('stickier-landing-variant');if(v==='v2')document.documentElement.classList.add('landing-v2-boot')}catch(e){}",
          }}
        />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
