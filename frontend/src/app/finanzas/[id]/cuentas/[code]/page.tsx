"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AccountTypeBadge, BackLink, EmptyState, FilterBar, Money, StatTile, td, tdNum, th, thNum } from "@/components/finanzas/ui";
import { apiFetch } from "@/lib/api";
import { gs, gsCompact, int, type FinAccount, type FinEntry } from "@/lib/finanzas";

interface Group {
  cc_code: number;
  cc_desc: string;
  debit: number;
  credit: number;
  net: number;
  people: number;
  rows: FinEntry[];
}

interface Detail {
  account: FinAccount;
  totals: { rows: number; people: number; cost_centers: number; debit: number; credit: number };
  groups: Group[];
}

export default function AccountDetailPage() {
  const params = useParams<{ id: string; code: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [allOpen, setAllOpen] = useState(false);

  useEffect(() => {
    const qs = applied ? `?q=${encodeURIComponent(applied)}` : "";
    apiFetch<Detail>(`/api/v1/finanzas/sessions/${params.id}/accounts/${params.code}${qs}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params.id, params.code, applied]);

  if (error) return <EmptyState title="Cuenta no disponible" body={error} />;
  if (!data) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;

  const a = data.account;
  const isGasto = a.type === "gasto";
  const base = `/finanzas/${params.id}`;
  const isOpen = (code: number) => allOpen || !!open[code];

  return (
    <div>
      <BackLink href={`${base}/cuentas`} label="Todas las cuentas" />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-[11px] text-brand-slate">
            Cuenta {a.code} · <AccountTypeBadge type={a.type} /> · {a.concept_label}
            {a.position ? ` · ${a.position}` : ""}
          </div>
          <h1 className="font-display text-2xl uppercase text-brand-ink leading-tight">
            {a.desc.replace(/^VOI\s*-\s*/i, "")}
          </h1>
        </div>
        <Link href={`${base}/notas?ref_type=cuenta&ref_id=${a.code}&ref_label=${encodeURIComponent(a.desc)}`} className="btn-secondary !py-2 text-xs">
          + Nota sobre esta cuenta
        </Link>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5 mb-4">
        <StatTile label={isGasto ? "Total gasto" : "Total neto"} value={gsCompact(a.net)} full={gs(a.net)} />
        <StatTile label="Debe" value={gsCompact(data.totals.debit)} full={gs(data.totals.debit)} />
        <StatTile label="Haber" value={gsCompact(data.totals.credit)} full={gs(data.totals.credit)} />
        <StatTile label="Colaboradores" value={int(data.totals.people)} hint={`${int(data.totals.rows)} líneas`} />
        <StatTile label="Centros de costo" value={int(data.totals.cost_centers)} />
      </div>

      <FilterBar>
        <form
          className="flex gap-2 flex-1 min-w-[260px]"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(q.trim());
          }}
        >
          <input className="input" placeholder="Filtrar por colaborador o Funcod…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-secondary !py-2 text-xs whitespace-nowrap">Filtrar</button>
          {applied && (
            <button type="button" className="btn-ghost text-xs" onClick={() => { setQ(""); setApplied(""); }}>
              Limpiar
            </button>
          )}
        </form>
        <button className="btn-ghost text-xs" onClick={() => setAllOpen((v) => !v)}>
          {allOpen ? "Plegar todos" : "Desplegar todos"}
        </button>
      </FilterBar>

      <div className="space-y-2">
        {data.groups.map((g) => (
          <div key={g.cc_code} className="card">
            <button
              className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-brand-bg-soft"
              onClick={() => setOpen((o) => ({ ...o, [g.cc_code]: !isOpen(g.cc_code) }))}
            >
              <span className="text-brand-slate text-xs w-4">{isOpen(g.cc_code) ? "▾" : "▸"}</span>
              <span className="font-semibold text-brand-ink flex-1 min-w-[200px]">
                {g.cc_desc} <span className="text-[11px] text-brand-slate font-normal">({g.cc_code})</span>
              </span>
              <span className="text-xs text-brand-slate">{int(g.people)} colab. · {int(g.rows.length)} líneas</span>
              <span className="font-semibold text-brand-ink tabular-nums"><Money n={g.net} /></span>
              <Link href={`${base}/centros/${g.cc_code}`} className="text-[11px] text-brand-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                ver centro →
              </Link>
            </button>
            {isOpen(g.cc_code) && (
              <div className="overflow-x-auto scrollbar-thin border-t border-brand-border">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr>
                      <th className={th}>Colaborador</th>
                      <th className={th}>Funcod</th>
                      <th className={th}>Archivo</th>
                      <th className={th}>Fecha</th>
                      <th className={thNum}>Debe</th>
                      <th className={thNum}>Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-brand-bg-soft">
                        <td className={td}>
                          <Link href={`${base}/colaboradores/${r.funcod}`} className="text-brand-ink hover:text-brand-primary">
                            {r.employee_name}
                          </Link>
                        </td>
                        <td className={`${td} tabular-nums text-brand-slate`}>{r.funcod}</td>
                        <td className={td}><span className="badge-neutral">{r.file_label}</span></td>
                        <td className={td}>{r.entry_date ?? "—"}</td>
                        <td className={tdNum}>{r.debit ? <Money n={r.debit} /> : <span className="text-brand-mist">—</span>}</td>
                        <td className={tdNum}>{r.credit ? <Money n={r.credit} /> : <span className="text-brand-mist">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-brand-bg-soft">
                      <td className={`${td} font-semibold`} colSpan={4}>Subtotal {g.cc_desc}</td>
                      <td className={`${tdNum} font-semibold`}><Money n={g.debit} /></td>
                      <td className={`${tdNum} font-semibold`}><Money n={g.credit} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        ))}
        {data.groups.length === 0 && <EmptyState title="Sin movimientos" body="Ningún movimiento coincide con el filtro." />}
      </div>
    </div>
  );
}
