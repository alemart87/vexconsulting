"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CategoryBadge, EmptyState, FilterBar, Money, TableWrap, td, tdNum, th, thNum } from "@/components/finanzas/ui";
import { apiFetch } from "@/lib/api";
import { int, type FinCollaborator, type FinCostCenter, type FinSummary } from "@/lib/finanzas";

interface Page {
  total: number;
  page: number;
  size: number;
  sum_cost: number;
  sum_net_pay: number;
  items: FinCollaborator[];
}

const SIZE = 50;

export default function CollaboratorsPage() {
  const params = useParams<{ id: string }>();
  const [centers, setCenters] = useState<FinCostCenter[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [cc, setCc] = useState("");
  const [category, setCategory] = useState("");
  const [egreso, setEgreso] = useState("");
  const [position, setPosition] = useState("");
  const [sort, setSort] = useState("cost");
  const [order, setOrder] = useState("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    apiFetch<FinCostCenter[]>(`/api/v1/finanzas/sessions/${params.id}/cost-centers`).then(setCenters).catch(() => {});
    apiFetch<{ summary: FinSummary }>(`/api/v1/finanzas/sessions/${params.id}/summary`)
      .then((r) => setPositions(r.summary.positions.map((p) => p.position)))
      .catch(() => {});
  }, [params.id]);

  // Debounce de la búsqueda
  useEffect(() => {
    const t = setTimeout(() => {
      setQApplied(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (qApplied) p.set("q", qApplied);
    if (cc) p.set("cc", cc);
    if (category) p.set("category", category);
    if (egreso) p.set("egreso", egreso);
    if (position) p.set("position", position);
    p.set("sort", sort);
    p.set("order", order);
    p.set("page", String(page));
    p.set("size", String(SIZE));
    return p.toString();
  }, [qApplied, cc, category, egreso, position, sort, order, page]);

  useEffect(() => {
    setLoading(true);
    apiFetch<Page>(`/api/v1/finanzas/sessions/${params.id}/collaborators?${query}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id, query]);

  const toggleSort = (k: string) => {
    if (sort === k) setOrder((o) => (o === "desc" ? "asc" : "desc"));
    else {
      setSort(k);
      setOrder(k === "name" || k === "cc" || k === "funcod" ? "asc" : "desc");
    }
    setPage(1);
  };
  const arrow = (k: string) => (sort === k ? (order === "desc" ? " ↓" : " ↑") : "");
  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  if (error) return <EmptyState title="Sin colaboradores" body={error} />;

  const pages = data ? Math.max(1, Math.ceil(data.total / SIZE)) : 1;
  const base = `/finanzas/${params.id}`;

  return (
    <div>
      <FilterBar>
        <div className="flex-1 min-w-[240px]">
          <label className="label">Buscar colaborador</label>
          <input className="input" placeholder="Nombre, apellido o Funcod…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Centro de costo</label>
          <select className="input !w-auto max-w-[240px]" value={cc} onChange={(e) => resetPage(setCc)(e.target.value)}>
            <option value="">Todos</option>
            {centers.map((c) => (
              <option key={c.code} value={c.code}>{c.desc} ({c.people})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Tipo</label>
          <select className="input !w-auto" value={category} onChange={(e) => resetPage(setCategory)(e.target.value)}>
            <option value="">Todos</option>
            <option value="mensualero">Mensualeros</option>
            <option value="jornalero">Jornaleros</option>
            <option value="sin_clasificar">Sin clasificar</option>
          </select>
        </div>
        <div>
          <label className="label">Puesto</label>
          <select className="input !w-auto" value={position} onChange={(e) => resetPage(setPosition)(e.target.value)}>
            <option value="">Todos</option>
            {positions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Egresos</label>
          <select className="input !w-auto" value={egreso} onChange={(e) => resetPage(setEgreso)(e.target.value)}>
            <option value="">Indistinto</option>
            <option value="true">Solo egresos</option>
            <option value="false">Sin egresos</option>
          </select>
        </div>
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-brand-slate mb-2">
        <span>
          {data ? `${int(data.total)} colaboradores` : "…"}
          {data && data.total > 0 && (
            <>
              {" "}· gasto <b className="text-brand-ink"><Money n={data.sum_cost} /></b> · neto a pagar{" "}
              <b className="text-brand-ink"><Money n={data.sum_net_pay} /></b>
            </>
          )}
        </span>
        <span className="inline-flex items-center gap-2">
          <button className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
          página {page} de {pages}
          <button className="btn-ghost text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
        </span>
      </div>

      <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${th} cursor-pointer`} onClick={() => toggleSort("name")}>Colaborador{arrow("name")}</th>
              <th className={`${th} cursor-pointer`} onClick={() => toggleSort("funcod")}>Funcod{arrow("funcod")}</th>
              <th className={th}>Tipo</th>
              <th className={th}>Puesto</th>
              <th className={`${th} cursor-pointer`} onClick={() => toggleSort("cc")}>Centro principal{arrow("cc")}</th>
              <th className={th}>Archivos</th>
              <th className={`${thNum} cursor-pointer`} onClick={() => toggleSort("cost")}>Gasto total{arrow("cost")}</th>
              <th className={`${thNum} cursor-pointer`} onClick={() => toggleSort("net_pay")}>Neto a pagar{arrow("net_pay")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((c) => (
              <tr key={c.funcod} className="hover:bg-brand-bg-soft">
                <td className={td}>
                  <Link href={`${base}/colaboradores/${c.funcod}`} className="font-semibold text-brand-ink hover:text-brand-primary">{c.name}</Link>
                </td>
                <td className={`${td} tabular-nums text-brand-slate`}>
                  {c.funcod}
                  {c.funcod_dirty && <span className="ml-1 badge bg-brand-orange/15 text-[#8A5200]" title="El código venía con caracteres extra y se limpió">limpiado</span>}
                </td>
                <td className={td}><CategoryBadge category={c.category} egreso={c.is_egreso} /></td>
                <td className={td}>{c.position ?? "—"}</td>
                <td className={td}>
                  {c.cc_main_desc ?? "—"}
                  {c.cc_count > 1 && <div className="text-[11px] text-brand-slate">+{c.cc_count - 1} más</div>}
                </td>
                <td className={`${td} text-[11px] text-brand-slate`}>{c.file_labels.join(", ")}</td>
                <td className={tdNum}><Money n={c.total_cost} /></td>
                <td className={tdNum}><Money n={c.net_pay} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {data && data.items.length === 0 && <EmptyState title="Sin resultados" body="Ningún colaborador coincide con la búsqueda." />}
      </div>
    </div>
  );
}
