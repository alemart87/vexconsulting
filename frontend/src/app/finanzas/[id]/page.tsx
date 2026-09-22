"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useFinanceSession } from "@/components/finanzas/FinanceSessionContext";
import { Money, TableWrap, td, tdNum, th, thNum } from "@/components/finanzas/ui";
import { apiFetch, formatDate } from "@/lib/api";
import { KIND_LABEL, balanceStatus, int } from "@/lib/finanzas";

export default function FilesPage() {
  const params = useParams<{ id: string }>();
  const { session, reload } = useFinanceSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [running, setRunning] = useState(false);

  const busy = session?.status === "queued" || session?.status === "running";

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.xls[xm]$/i.test(f.name));
    if (list.length === 0) {
      setErrors(["Solo se aceptan archivos Excel (.xlsx)"]);
      return;
    }
    setErrors([]);
    for (const f of list) {
      setUploading((u) => [...u, f.name]);
      try {
        const form = new FormData();
        form.append("file", f);
        await apiFetch(`/api/v1/finanzas/sessions/${params.id}/files`, { method: "POST", body: form });
      } catch (e: any) {
        setErrors((errs) => [...errs, `${f.name}: ${e.message}`]);
      } finally {
        setUploading((u) => u.filter((n) => n !== f.name));
      }
    }
    reload();
  };

  const remove = async (fileId: string, label: string) => {
    if (!confirm(`¿Quitar «${label}» de la sesión?`)) return;
    try {
      await apiFetch(`/api/v1/finanzas/sessions/${params.id}/files/${fileId}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      setErrors([e.message]);
    }
  };

  const run = async () => {
    setRunning(true);
    setErrors([]);
    try {
      await apiFetch(`/api/v1/finanzas/sessions/${params.id}/run`, { method: "POST" });
      reload();
    } catch (e: any) {
      setErrors([e.message]);
    } finally {
      setRunning(false);
    }
  };

  if (!session) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;
  const files = session.files ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4 min-w-0">
        {/* Zona de carga */}
        <div
          className={`card p-6 border-2 border-dashed text-center transition-colors ${
            dragOver ? "border-brand-primary bg-brand-primary-light" : "border-brand-border"
          } ${busy ? "opacity-50 pointer-events-none" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            upload(e.dataTransfer.files);
          }}
        >
          <p className="font-display text-xl uppercase text-brand-ink">Archivos «A cruzar»</p>
          <p className="text-sm text-brand-slate mt-1 max-w-xl mx-auto">
            Arrastrá acá los Excel de asientos del mes (mensualeros, operaciones, egresos y
            complementos) o elegilos desde tu equipo. Cada archivo se valida al subirlo: debe
            tener la hoja «Horas» con las 14 columnas del export contable.
          </p>
          <button className="btn-secondary mt-4" onClick={() => inputRef.current?.click()}>
            Elegir archivos…
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) upload(e.target.files);
              e.currentTarget.value = "";
            }}
          />
          {uploading.length > 0 && (
            <p className="text-xs text-brand-cyan mt-3">
              Subiendo y validando: {uploading.join(", ")}…
            </p>
          )}
        </div>

        {errors.length > 0 && (
          <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-4 py-3 space-y-1">
            {errors.map((e, i) => (
              <div key={i}>⚠ {e}</div>
            ))}
          </div>
        )}

        {/* Lista */}
        {files.length === 0 ? (
          <div className="card p-6 text-center text-sm text-brand-slate">Sin archivos todavía.</div>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Archivo</th>
                <th className={th}>Tipo</th>
                <th className={thNum}>Asiento</th>
                <th className={th}>Fecha</th>
                <th className={thNum}>Filas</th>
                <th className={thNum}>Colab.</th>
                <th className={thNum}>Debe</th>
                <th className={thNum}>Balance</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="hover:bg-brand-bg-soft">
                  <td className={td}>
                    <div className="font-semibold text-brand-ink">{f.label}</div>
                    <div className="text-[11px] text-brand-slate break-all">{f.original_filename}</div>
                    {f.validation?.warnings?.map((w, i) => (
                      <div key={i} className="text-[11px] text-[#8A5200] mt-0.5">
                        ⚠ {w}
                      </div>
                    ))}
                  </td>
                  <td className={td}>
                    <span className="badge-neutral">{KIND_LABEL[f.kind] ?? f.kind}</span>
                  </td>
                  <td className={tdNum}>{f.entry_number ?? "—"}</td>
                  <td className={td}>{f.entry_date ?? "—"}</td>
                  <td className={tdNum}>{int(f.row_count)}</td>
                  <td className={tdNum}>{int(f.collaborator_count)}</td>
                  <td className={tdNum}>
                    <Money n={f.total_debit} compact />
                  </td>
                  <td className={`${td} text-right`}>
                    {(() => {
                      const b = balanceStatus(f.balance_diff);
                      return (
                        <span className={`text-xs font-semibold ${b.ok ? "text-emerald-700" : "text-[#8A5200]"}`}>
                          {b.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className={td}>
                    <button
                      className="btn-ghost text-xs text-brand-primary"
                      onClick={() => remove(f.id, f.label)}
                      disabled={busy}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      {/* Panel de ejecución */}
      <aside className="space-y-3">
        <div className="card p-5">
          <div className="label">Ejecutar</div>
          <p className="text-sm text-brand-slate leading-relaxed">
            Al ejecutar, el sistema lee los {files.length} archivo{files.length === 1 ? "" : "s"},
            cruza a los colaboradores por <b>Funcod</b>, clasifica cuentas y centros y guarda
            el resumen gerencial.
          </p>
          <button
            className="btn-primary w-full mt-4"
            onClick={run}
            disabled={running || busy || files.length === 0}
            data-tour="ejecutar"
          >
            {busy ? "⏳ Ejecutando…" : running ? "Enviando…" : "▶ Ejecutar VeXFinanzas"}
          </button>
          {busy && (
            <div className="mt-3 text-xs text-brand-cyan">
              <div className="shimmer-bar h-1.5 rounded mb-2" />
              {session.stage_note || "En cola…"}
            </div>
          )}
          {session.status === "failed" && (
            <div className="mt-3 rounded-md bg-brand-primary-light text-brand-primary-dark text-xs px-3 py-2">
              ⚠ {session.last_error || "La ejecución falló"}
            </div>
          )}
          {session.status === "draft" && session.stage_note && files.length > 0 && (
            <div className="mt-3 rounded-md bg-brand-orange/10 text-[#8A5200] text-xs px-3 py-2">
              {session.stage_note}
            </div>
          )}
          {session.status === "done" && (
            <div className="mt-3 text-xs text-emerald-700 space-y-2">
              <div>✓ Analizada {formatDate(session.executed_at)}</div>
              <Link href={`/finanzas/${params.id}/resumen`} className="btn-secondary w-full !py-2 text-xs">
                Ver resumen gerencial →
              </Link>
            </div>
          )}
        </div>

        {session.totals && (
          <div className="card p-5 text-sm">
            <div className="label">Último resultado</div>
            <dl className="grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-brand-slate">Líneas</dt>
              <dd className="text-right tabular-nums">{int(session.totals.rows)}</dd>
              <dt className="text-brand-slate">Colaboradores</dt>
              <dd className="text-right tabular-nums">{int(session.totals.collaborators)}</dd>
              <dt className="text-brand-slate">Centros de costo</dt>
              <dd className="text-right tabular-nums">{int(session.totals.cost_centers)}</dd>
              <dt className="text-brand-slate">Cuentas</dt>
              <dd className="text-right tabular-nums">{int(session.totals.accounts)}</dd>
              <dt className="text-brand-slate">Gasto total</dt>
              <dd className="text-right">
                <Money n={session.totals.cost} compact />
              </dd>
            </dl>
          </div>
        )}

        <div className="card p-5 text-xs text-brand-slate leading-relaxed">
          <div className="label">Cómo cruza</div>
          <ul className="list-disc pl-4 space-y-1">
            <li>La clave es <b>Funcod</b>; el nombre es solo etiqueta.</li>
            <li>Funcod con guiones u otros caracteres se limpia a dígitos y se marca.</li>
            <li>Cuentas 5xxxxx = gasto; 2xxxxx = pasivo; 1xxxxx = descuento al personal.</li>
            <li>Operadores = jornaleros; el resto de remuneraciones = mensualeros.</li>
            <li>Un colaborador en varios centros se prorratea por línea.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
