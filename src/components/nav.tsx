"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavItem = { href: string; label: string };

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <button type="button" className="rounded-md px-2 py-1 text-cream md:hidden" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
        ☰
      </button>
      <nav className={`${open ? "flex" : "hidden"} absolute left-0 right-0 top-full z-30 flex-col gap-1 bg-brown p-3 md:static md:flex md:flex-row md:flex-wrap md:bg-transparent md:p-0`}>
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            onClick={() => setOpen(false)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${active(i.href) ? "bg-cream text-brown" : "text-cream/85 hover:bg-cream/10 hover:text-cream"}`}
          >
            {i.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
