"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CurrentUserInfo, ROLE_LABELS, clearSession, getToken, getUser } from "@/lib/api";
import Brand from "./Brand";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
  return (
    <Link href={href} className={active ? "nav-link-active" : "nav-link"}>
      {label}
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUserInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    const u = getUser();
    setUser(u);
    if (u?.role === "visualizador") router.replace("/view");
  }, [router]);

  const onLogout = () => {
    clearSession();
    router.push("/login");
  };

  if (!user) return null;

  const isSuperadmin = user.role === "superadmin";
  const isLider = user.role === "consultor_lider" || isSuperadmin;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-white border-b border-brand-border shadow-soft">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-4">
          <Brand />
          <nav className="hidden md:flex items-center gap-1">
            <NavLink href="/dashboard" label="Proyectos" />
            {isLider && <NavLink href="/admin/users" label="Usuarios" />}
            {isSuperadmin && <NavLink href="/admin/audit" label="Auditoría" />}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <div className="text-sm font-semibold text-brand-ink leading-tight">
                {user.full_name}
              </div>
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">
                {ROLE_LABELS[user.role] ?? user.role}
              </div>
            </div>
            <div className="h-9 w-9 rounded-full bg-brand-primary text-white flex items-center justify-center font-bold text-sm">
              {user.full_name?.slice(0, 1).toUpperCase()}
            </div>
            <button onClick={onLogout} className="btn-ghost text-xs">
              Salir
            </button>
            <button
              className="md:hidden btn-ghost"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menú"
            >
              ☰
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="md:hidden border-t border-brand-border px-4 py-2 flex flex-col gap-1 animate-fade">
            <NavLink href="/dashboard" label="Proyectos" />
            {isLider && <NavLink href="/admin/users" label="Usuarios" />}
            {isSuperadmin && <NavLink href="/admin/audit" label="Auditoría" />}
          </nav>
        )}
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">{children}</main>

      <footer className="border-t border-brand-border bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-brand-slate flex justify-between">
          <span>© {new Date().getFullYear()} Voicenter S.A.</span>
          <span>VEX Consulting · Investigación de mercado</span>
        </div>
      </footer>
    </div>
  );
}
