"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, FilterBar, Money, ShareBar, TableWrap, td, tdNum, th, thNum } from "@/components/finanzas/ui";
import { useFinanceSession } from "@/components/finanzas/FinanceSessionContext";
import { apiFetch, downloadFile } from "@/lib/api";
import { CHART, int, pct, type FinCostCenter } from "@/lib/finanzas";

type SortKey = "cost" | "people" | "desc" | "avg_cost" | "client";

export default function CostCentersPage() {
  const params = useParams<{ id: string }>();
  const { session } = useFinanceSession();
  const [centers, setCenters] = useState<FinCostCenter[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [client, setClient] = useState("");
  const [sort, setSort] = useState<SortKey>("cost");
  const [desc, setDesc] = useState(true);
  const [downloading, setDownloading] = useState<number | null>(null);

  const download = async (c: FinCostCenter) => {
    setDownloading(c.code);
    try {
      await downloadFile(
        `/api/v1/finanzas/sessions/${params.id}/cost-centers/${c.code}/export`,
        `${c.code}_${c.desc.replace(/[^\w-]+/g, "-")}.xlsx`
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDownloading(null);
    }
  };

  useEffect(() => {
    apiFetch<FinCostCenter[]>(`/api/v1/finanzas/sessions/${params.id}/cost-centers`)
      .then(setCenters)
      .catch((e) => setError(e.message));
  }, [params.id]);

  const clients = useMemo(() => [...new Set((centers ?? []).map((c) => c.client))].sort(), [centers]);

  const rows = useMemo(() => {
    const list = (centers ?? []).filter((c) => {
      if (client && c.client !== client) return false;
      if (q) {
        const s = q.toLowerCase();
        return c.desc.toLowerCase().includes(s) || String(c.code).includes(s) || c.aliases.some((a) => a.toLowerCase().includes(s));
      }
      return true;
    });
    const dir = desc ? -1 : 1;
    return [...list].sort((a, b) => {
      const va = a[sort] as any;
      const vb = b[sort] as any;
      if (typeof va === "string") return dir * va.localeCompare(vb);
      return dir * (va - vb);
    });
  }, [centers, q, client, sort, desc]);

  const toggleSort = (k: SortKey) => {
    if (sort === k) setDesc((d) => !d);
    else {
      setSort(k);
      setDesc(k !== "desc" && k !== "client");
    }
  };
  const arrow = (k: SortKey) => (sort === k ? (desc ? " ↓" : " ↑") : "");

  if (error) return <EmptyState title="Sin centros" body={error} />;
  if (!centers) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;

  const sumCost = rows.reduce((s, c) => s + c.cost, 0);
  const sumPeople = rows.reduce((s, c) => s + c.people, 0);

  return (
    <div>
      <FilterBar>
        <div className="flex-1 min-w-[220px]">
          <label className="label">Buscar centro</label>
          <input className="input" placeholder="Código o descripción…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label">Cliente / negocio</label>
          <select className="input !w-auto" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="text-xs text-brand-slate pb-2.5" title="Una persona imputada a varios centros cuenta en cada uno: por eso las asignaciones superan a los colaboradores únicos">
          {rows.length} centros · {int(sumPeople)} asignaciones
          {!q && !client && session?.totals
            ? ` (${int(session.totals.collaborators)} colaboradores únicos, ${int(session.totals.multi_cc_people)} en más de un centro)`
            : ""}
          {" "}· <Money n={sumCost} compact />
        </div>
      </FilterBar>

      <TableWrap>
        <thead>
          <tr>
            <th className={`${th} cursor-pointer`} onClick={() => toggleSort("desc")}>Centro de costo{arrow("desc")}</th>
            <th className={`${th} cursor-pointer`} onClick={() => toggleSort("client")}>Cliente{arrow("client")}</th>
            <th className={`${thNum} cursor-pointer`} onClick={() => toggleSort("people")} title="Personas imputadas al centro (una persona puede estar en varios)">Personas{arrow("people")}</th>
            <th className={thNum}>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: CHART.mensualero }} />Mens.</span>
            </th>
            <th className={thNum}>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: CHART.jornalero }} />Jorn.</span>
            </th>
            <th className={thNum}>Egresos</th>
            <th className={`${thNum} cursor-pointer`} onClick={() => toggleSort("cost")}>Gasto{arrow("cost")}</th>
            <th className={`${thNum} cursor-pointer`} onClick={() => toggleSort("avg_cost")}>Prom./persona{arrow("avg_cost")}</th>
            <th className={`${th} w-32`}>Particip.</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.code} className="hover:bg-brand-bg-soft">
              <td className={td}>
                <Link href={`/finanzas/${params.id}/centros/${c.code}`} className="block">
                  <div className="font-semibold text-brand-ink">{c.desc}</div>
                  <div className="text-[11px] text-brand-slate">
                    {c.code}
                    {c.aliases.length > 0 && <span title="Otra descripción usada para el mismo código"> · alias: {c.aliases.join(", ")}</span>}
                  </div>
                </Link>
              </td>
              <td className={td}>{c.client}</td>
              <td className={tdNum}>{int(c.people)}</td>
              <td className={tdNum}>{int(c.mensualeros)}</td>
              <td className={tdNum}>{int(c.jornaleros)}</td>
              <td className={tdNum}>{c.egresos ? int(c.egresos) : <span className="text-brand-mist">—</span>}</td>
              <td className={tdNum}>
                <Link href={`/finanzas/${params.id}/centros/${c.code}`} className="font-semibold text-brand-ink"><Money n={c.cost} /></Link>
              </td>
              <td className={tdNum}><Money n={c.avg_cost} compact /></td>
              <td className={`${td} align-middle`}>
                <div className="text-[11px] text-brand-slate mb-1">{pct(c.share)}</div>
                <ShareBar share={c.share} />
              </td>
              <td className={`${td} align-middle`}>
                <button
                  className="btn-ghost text-xs whitespace-nowrap"
                  onClick={() => download(c)}
                  disabled={downloading === c.code}
                  title="Descargar Excel con el detalle completo del centro"
                >
                  {downloading === c.code ? "…" : "⬇ Excel"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {rows.length === 0 && <EmptyState title="Sin resultados" body="Ningún centro coincide con el filtro." />}
    </div>
  );
}
