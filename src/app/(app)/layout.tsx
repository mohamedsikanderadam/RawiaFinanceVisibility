import Image from "next/image";
import Link from "next/link";
import { Nav, type NavItem } from "@/components/nav";
import { can, pageSession, type Permission } from "@/lib/server/auth";
import { logoutAction } from "../actions";

const ITEMS: (NavItem & { p: Permission })[] = [
  { href: "/", label: "Dashboard", p: "view_finance" },
  { href: "/upload", label: "Upload sales", p: "import" },
  { href: "/reserve", label: "Reserve & ledger", p: "view_finance" },
  { href: "/reports", label: "Reports", p: "view_finance" },
  { href: "/mappings", label: "Item mapping", p: "view" },
  { href: "/costing", label: "Costing", p: "view_finance" },
  { href: "/settings", label: "Settings", p: "view_finance" },
  { href: "/audit", label: "Audit trail", p: "view_finance" },
  { href: "/users", label: "Users", p: "users" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await pageSession("view");
  const items = ITEMS.filter((i) => can(s.role, i.p));
  return (
    <div className="min-h-screen">
      <header className="relative bg-brown text-cream">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/rawia-logo-cream.svg" alt="RAWIA" width={96} height={33} className="h-8 w-auto" priority />
            <span className="hidden text-xs font-semibold uppercase tracking-widest text-cream/70 sm:inline">Finance</span>
          </Link>
          <div className="flex flex-1 items-center justify-end md:justify-start">
            <Nav items={items} />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="hidden text-cream/80 lg:inline">
              {s.name} · <span className="uppercase">{s.role}</span>
            </span>
            <form action={logoutAction}>
              <button className="rounded-md border border-cream/30 px-2 py-1 font-semibold hover:bg-cream/10">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-ink-soft">
        RAWIA CAFE · AED · Asia/Dubai. Replenishment reserve is consumption-based money to replace stock used; it is not a purchase order or an inventory balance.
      </footer>
    </div>
  );
}
