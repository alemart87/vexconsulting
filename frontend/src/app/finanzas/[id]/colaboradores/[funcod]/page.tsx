"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BackLink, CategoryBadge, EmptyState, Money, StatTile, TableWrap, td, tdNum, th, thNum } from "@/components/finanzas/ui";
import { apiFetch } from "@/lib/api";
import { gs, gsCompact, int, type FinCollaborator, type FinEntry } from "@/lib/finanzas";

interface Detail {
  collaborator: FinCollaborator;
  breakdown: { concept: string; label: string; amount: number }[];
  by_cost_center: { cc_code: number; cc_desc: string; cost: number; net_pay: number; rows: number }[];
  by_file: { file_id: string; file_label: string; entry_number?: number | null; entry_date?: string | null; cost: number; net_pay: number; rows: number }[];
  entries: FinEntry[];
}

export default function CollaboratorDetailPage() {
  const params = useParams<{ id: string; funcod: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<Detail>(`/api/v1/finanzas/sessions/${params.id}/collaborators/${params.funcod}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params.id, params.funcod]);

  if (error) return <EmptyState title="Colaborador no disponible" body={error} />;
  if (!data) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;

  const c = data.collaborator;
  const base = `/finanzas/${params.id}`;

  return (
    <div>
      <BackLink href={`${base}/colaboradores`} label="Todos los colaboradores" />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-[11px] text-brand-slate flex items-center gap-2">
            Funcod <span className="tabular-nums text-brand-ink">{c.funcod}</span>
            {c.funcod_dirty && <span className="badge bg-brand-orange/15 text-[#8A5200]">código limpiado</span>}
            <CategoryBadge category={c.category} egreso={c.is_egreso} />
          </div>
          <h1 className="font-display text-2xl uppercase text-brand-ink leading-tight">{c.name}</h1>
          <div className="text-xs text-brand-slate">
            {c.position ?? "Sin puesto identificado"} · centro principal{" "}
            {c.cc_main_code ? (
              <Link href={`${base}/centros/${c.cc_main_code}`} className="text-brand-primary hover:underline">{c.cc_main_desc}</Link>
            ) : "—"}
            {c.cc_count > 1 && ` · imputado en ${c.cc_count} centros`}
          </div>
        </div>
        <Link href={`${base}/notas?ref_type=colaborador&ref_id=${c.funcod}&ref_label=${encodeURIComponent(c.name)}`} className="btn-secondary !py-2 text-xs">
          + Nota sobre este colaborador
        </Link>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5 mb-5">
        <StatTile label="Costo total empresa" value={gsCompact(c.total_cost)} full={gs(c.total_cost)} hint="Gasto imputado (cuentas 5)" />
        <StatTile label="Neto a pagar" value={gsCompact(c.net_pay)} full={gs(c.net_pay)} hint="Sueldos y jornales a pagar" />
        <StatTile label="Pasivos generados" value={gsCompact(c.total_liabilities)} full={gs(c.total_liabilities)} hint="IPS, aguinaldo, embargos, neto" />
        <StatTile label="Descuentos" value={gsCompact(c.total_deductions)} full={gs(c.total_deductions)} hint="Anticipos y descuentos" />
        <StatTile label="Líneas de asiento" value={int(c.entry_count)} hint={`${c.file_labels.length} archivo${c.file_labels.length === 1 ? "" : "s"}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-5">
        <div className="card p-4">
          <div className="label">Composición del costo</div>
          <table className="w-full text-sm">
            <tbody>
              {data.breakdown.map((b) => (
                <tr key={b.concept}>
                  <td className="py-1 text-brand-graphite">{b.label}</td>
                  <td className="py-1 text-right tabular-nums"><Money n={b.amount} /></td>
                </tr>
              ))}
              <tr className="border-t border-brand-border font-semibold">
                <td className="py-1">Total</td>
                <td className="py-1 text-right tabular-nums"><Money n={c.total_cost} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card p-4">
          <div className="label">Por centro de costo</div>
          <table className="w-full text-sm">
            <tbody>
              {data.by_cost_center.map((x) => (
                <tr key={x.cc_code}>
                  <td className="py-1">
                    <Link href={`${base}/centros/${x.cc_code}`} className="text-brand-graphite hover:text-brand-primary">{x.cc_desc}</Link>
                    <div className="text-[11px] text-brand-slate">{x.cc_code} · {x.rows} líneas</div>
                  </td>
                  <td className="py-1 text-right tabular-nums align-top"><Money n={x.cost} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card p-4">
          <div className="label">Por archivo</div>
          <table className="w-full text-sm">
            <tbody>
              {data.by_file.map((f) => (
                <tr key={f.file_id}>
                  <td className="py-1">
                    <span className="badge-neutral">{f.file_label}</span>
                    <div className="text-[11px] text-brand-slate">asiento {f.entry_number ?? "—"} · {f.entry_date ?? "—"}</div>
                  </td>
                  <td className="py-1 text-right tabular-nums align-top">
                    <Money n={f.cost} />
                    <div className="text-[11px] text-brand-slate">neto {gsCompact(f.net_pay)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="label">Todos los movimientos ({data.entries.length})</h2>
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>Archivo</th>
            <th className={th}>Cuenta</th>
            <th className={th}>Centro de costo</th>
            <th className={thNum}>Debe</th>
            <th className={thNum}>Haber</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr key={e.id} className="hover:bg-brand-bg-soft">
              <td className={td}><span className="badge-neutral">{e.file_label}</span></td>
              <td className={td}>
                <Link href={`${base}/cuentas/${e.account_code}`} className="text-brand-ink hover:text-brand-primary">{e.account_desc.replace(/^VOI\s*-\s*/i, "")}</Link>
                <div className="text-[11px] text-brand-slate">{e.account_code} · {e.concept_label}</div>
              </td>
              <td className={td}>
                <Link href={`${base}/centros/${e.cc_code}`} className="text-brand-graphite hover:text-brand-primary">{e.cc_desc}</Link>
                <div className="text-[11px] text-brand-slate">{e.cc_code}</div>
              </td>
              <td className={tdNum}>{e.debit ? <Money n={e.debit} /> : <span className="text-brand-mist">—</span>}</td>
              <td className={tdNum}>{e.credit ? <Money n={e.credit} /> : <span className="text-brand-mist">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
