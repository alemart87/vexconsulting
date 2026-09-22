"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AccountTypeBadge, BackLink, CategoryBadge, EmptyState, Money, StatTile, TableWrap, td, tdNum, th, thNum } from "@/components/finanzas/ui";
import { apiFetch } from "@/lib/api";
import { gs, gsCompact, int, type FinCollaborator, type FinCostCenter } from "@/lib/finanzas";

interface Person extends FinCollaborator {
  cost_in_cc: number;
  net_pay_in_cc: number;
  rows_in_cc: number;
  breakdown_in_cc: Record<string, number>;
}

interface Detail {
  center: FinCostCenter;
  people: Person[];
  accounts: { code: number; desc: string; type: string; concept: string; concept_label: string; rows: number; people: number; debit: number; credit: number; net: number }[];
}

export default function CostCenterDetailPage() {
  const params = useParams<{ id: string; code: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"personas" | "cuentas">("personas");

  useEffect(() => {
    apiFetch<Detail>(`/api/v1/finanzas/sessions/${params.id}/cost-centers/${params.code}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params.id, params.code]);

  if (error) return <EmptyState title="Centro no disponible" body={error} />;
  if (!data) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;

  const c = data.center;
  const base = `/finanzas/${params.id}`;

  return (
    <div>
      <BackLink href={`${base}/centros`} label="Todos los centros de costo" />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-[11px] text-brand-slate">
            Centro {c.code} · {c.client}
            {c.aliases.length > 0 && ` · también aparece como «${c.aliases.join("», «")}»`}
          </div>
          <h1 className="font-display text-2xl uppercase text-brand-ink leading-tight">{c.desc}</h1>
        </div>
        <Link href={`${base}/notas?ref_type=centro&ref_id=${c.code}&ref_label=${encodeURIComponent(c.desc)}`} className="btn-secondary !py-2 text-xs">
          + Nota sobre este centro
        </Link>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-6 mb-4">
        <StatTile label="Gasto del mes" value={gsCompact(c.cost)} full={gs(c.cost)} hint={`${(c.share * 100).toFixed(1).replace(".", ",")} % del total`} />
        <StatTile label="Personas" value={int(c.people)} hint={`${int(c.rows)} líneas · ${c.files} archivos`} />
        <StatTile label="Mensualeros" value={int(c.mensualeros)} accent="#0093A0" />
        <StatTile label="Jornaleros" value={int(c.jornaleros)} accent="#7A3A9C" />
        <StatTile label="Egresos" value={int(c.egresos)} accent="#D9531E" />
        <StatTile label="Costo promedio" value={gsCompact(c.avg_cost)} full={gs(c.avg_cost)} hint="Por persona en este centro" />
      </div>

      <div className="flex items-center gap-1 border-b border-brand-border mb-4">
        {(["personas", "cuentas"] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? "px-3 py-2 text-sm font-semibold text-brand-ink border-b-2 border-brand-primary -mb-px" : "px-3 py-2 text-sm text-brand-slate hover:text-brand-ink"}
            onClick={() => setTab(t)}
          >
            {t === "personas" ? `Colaboradores (${data.people.length})` : `Cuentas (${data.accounts.length})`}
          </button>
        ))}
      </div>

      {tab === "personas" ? (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Colaborador</th>
              <th className={th}>Funcod</th>
              <th className={th}>Tipo</th>
              <th className={th}>Puesto</th>
              <th className={thNum}>Gasto en este centro</th>
              <th className={thNum}>Neto a pagar</th>
              <th className={th}>Otros centros</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.funcod} className="hover:bg-brand-bg-soft">
                <td className={td}>
                  <Link href={`${base}/colaboradores/${p.funcod}`} className="font-semibold text-brand-ink hover:text-brand-primary">{p.name}</Link>
                </td>
                <td className={`${td} tabular-nums text-brand-slate`}>{p.funcod}</td>
                <td className={td}><CategoryBadge category={p.category} egreso={p.is_egreso} /></td>
                <td className={td}>{p.position ?? "—"}</td>
                <td className={tdNum}><Money n={p.cost_in_cc} /></td>
                <td className={tdNum}><Money n={p.net_pay_in_cc} /></td>
                <td className={`${td} text-[11px] text-brand-slate`}>
                  {p.cc_count > 1 ? `+${p.cc_count - 1} centro${p.cc_count > 2 ? "s" : ""} (total ${gsCompact(p.total_cost)})` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Cuenta</th>
              <th className={th}>Concepto</th>
              <th className={thNum}>Líneas</th>
              <th className={thNum}>Colab.</th>
              <th className={thNum}>Debe</th>
              <th className={thNum}>Haber</th>
              <th className={thNum}>Neto</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <tr key={a.code} className="hover:bg-brand-bg-soft">
                <td className={td}>
                  <Link href={`${base}/cuentas/${a.code}`} className="font-semibold text-brand-ink hover:text-brand-primary">
                    {a.desc.replace(/^VOI\s*-\s*/i, "")}
                  </Link>
                  <div className="text-[11px] text-brand-slate">{a.code} · <AccountTypeBadge type={a.type} /></div>
                </td>
                <td className={td}>{a.concept_label}</td>
                <td className={tdNum}>{int(a.rows)}</td>
                <td className={tdNum}>{int(a.people)}</td>
                <td className={tdNum}>{a.debit ? <Money n={a.debit} /> : <span className="text-brand-mist">—</span>}</td>
                <td className={tdNum}>{a.credit ? <Money n={a.credit} /> : <span className="text-brand-mist">—</span>}</td>
                <td className={`${tdNum} font-semibold`}><Money n={a.net} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
