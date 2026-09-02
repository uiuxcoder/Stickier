import type { ReactNode } from "react";
import Link from "next/link";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="grain" />
      <nav>
        <Link className="logo" href="/">
          SALTY STICKER<sup>™</sup>
        </Link>
        <span>SALTY STICKER CLUB</span>
        <div className="nav-end">
          <Link className="nav-cta" href="/">
            CREATE MY STICKERS
          </Link>
        </div>
      </nav>
      {children}
    </main>
  );
}
