"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { FinanceSessionContext } from "@/components/finanzas/FinanceSessionContext";
import { StatusBadge } from "@/components/finanzas/ui";
import { apiFetch, formatDate, getUser } from "@/lib/api";
import type { FinSession } from "@/lib/finanzas";

const TABS = [
  { href: "", label: "Archivos", needsDone: false },
  { href: "/resumen", label: "Resumen gerencial", needsDone: true },
  { href: "/cuentas", label: "Cuentas", needsDone: true },
  { href: "/centros", label: "Centros de costo", needsDone: true },
  { href: "/colaboradores", label: "Colaboradores", needsDone: true },
  { href: "/notas", label: "Notas", needsDone: false },
];

export default function FinanceSessionLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const user = typeof window !== "undefined" ? getUser() : null;
  const isSuperadmin = user?.role === "superadmin";
  const [session, setSession] = useState<FinSession | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    apiFetch<FinSession>(`/api/v1/finanzas/sessions/${params.id}`)
      .then((s) => {
        setSession(s);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [params.id]);

  useEffect(reload, [reload]);

  // Mientras corre, refrescar el estado cada 1,5 s
  useEffect(() => {
    if (!session || (session.status !== "queued" && session.status !== "running")) return;
    const t = setInterval(reload, 1500);
    return () => clearInterval(t);
  }, [session, reload]);

  const base = `/finanzas/${params.id}`;
  const isActive = (href: string) =>
    href === "" ? pathname === base : pathname?.startsWith(`${base}${href}`);
  const done = session?.status === "done";

  const startEdit = () => {
    if (!session) return;
    setName(session.name);
    setPeriod(session.period || "");
    setEditing(true);
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/finanzas/sessions/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), period: period || undefined }),
      });
      setEditing(false);
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!session) return;
    if (
      !confirm(
        `¿Eliminar la sesión «${session.name}» con sus ${session.file_count} archivos, el análisis y las notas? Esta acción no se puede deshacer.`
      )
    )
      return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/finanzas/sessions/${params.id}`, { method: "DELETE" });
      router.push("/finanzas");
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <AppShell fluid>
      <FinanceSessionContext.Provider value={{ session, reload, isSuperadmin }}>
        <div className="mb-4">
          <Link href="/finanzas" className="text-xs text-brand-slate hover:text-brand-primary">
            ← VEXFINANZAS · Análisis de centros de costos
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
            <div className="min-w-0">
              {editing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input !w-72"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    minLength={2}
                    autoFocus
                  />
                  <input
                    className="input !w-44"
                    type="month"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  />
                  <button className="btn-primary !py-2" onClick={saveEdit} disabled={busy || name.trim().length < 2}>
                    Guardar
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => setEditing(false)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-3xl uppercase text-brand-ink leading-none">
                    {session?.name ?? "…"}
                  </h1>
                  {session && <StatusBadge status={session.status} />}
                  {session && (
                    <button className="btn-ghost text-xs" onClick={startEdit} title="Renombrar o cambiar el mes">
                      ✎ Editar
                    </button>
                  )}
                </div>
              )}
              <div className="text-xs text-brand-slate mt-1">
                {session?.period_label}
                {session?.executed_at ? ` · ejecutada ${formatDate(session.executed_at)}` : ""}
                {isSuperadmin && session?.owner_name ? ` · gerente: ${session.owner_name}` : ""}
              </div>
            </div>
            {session && (
              <button className="btn-ghost text-xs text-brand-primary" onClick={remove} disabled={busy}>
                🗑 Eliminar sesión
              </button>
            )}
          </div>
          {error && (
            <div className="mt-2 rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <nav className="flex items-center gap-1 border-b border-brand-border mb-5 overflow-x-auto scrollbar-thin">
          {TABS.map((t) => {
            const disabled = t.needsDone && !done;
            const cls = isActive(t.href)
              ? "px-3 py-2 text-sm font-semibold text-brand-ink border-b-2 border-brand-primary -mb-px whitespace-nowrap"
              : disabled
                ? "px-3 py-2 text-sm text-brand-mist whitespace-nowrap cursor-not-allowed"
                : "px-3 py-2 text-sm text-brand-slate hover:text-brand-ink whitespace-nowrap";
            return disabled ? (
              <span key={t.href} className={cls} title="Disponible al ejecutar el análisis">
                {t.label}
              </span>
            ) : (
              <Link key={t.href} href={`${base}${t.href}`} className={cls}>
                {t.label}
              </Link>
            );
          })}
        </nav>

        {children}
      </FinanceSessionContext.Provider>
    </AppShell>
  );
}
