"use client";

/** Tipos, formateadores y paleta del módulo VEXFINANZAS. */

export interface FinSessionTotals {
  files: number;
  rows: number;
  collaborators: number;
  cost_centers: number;
  accounts: number;
  clients: number;
  cost: number;
  liabilities: number;
  deductions: number;
  net_pay: number;
  ips: number;
  aguinaldo_liability: number;
  avg_cost_per_person: number;
  multi_cc_people: number;
  balance_diff: number;
}

export interface FinFile {
  id: string;
  session_id: string;
  original_filename: string;
  kind: string;
  label: string;
  size_bytes: number;
  row_count: number;
  entry_number?: number | null;
  entry_date?: string | null;
  total_debit: number;
  total_credit: number;
  balance_diff: number;
  collaborator_count: number;
  validation?: { warnings?: string[]; dirty_funcods?: number; skipped_rows?: number } | null;
  uploaded_by_name?: string | null;
  created_at: string;
}

export interface FinSession {
  id: string;
  name: string;
  period?: string | null;
  period_label: string;
  description?: string | null;
  status: "draft" | "queued" | "running" | "done" | "failed";
  stage_note?: string | null;
  last_error?: string | null;
  owner_id: string;
  owner_name?: string | null;
  file_count: number;
  note_count: number;
  totals?: FinSessionTotals | null;
  warnings_count: number;
  created_at: string;
  updated_at: string;
  executed_at?: string | null;
  files?: FinFile[];
}

export interface FinCategory {
  label: string;
  people: number;
  cost: number;
  avg_cost: number;
  share: number;
}

export interface FinCostCenter {
  code: number;
  desc: string;
  aliases: string[];
  client: string;
  people: number;
  mensualeros: number;
  jornaleros: number;
  sin_clasificar: number;
  egresos: number;
  rows: number;
  files: number;
  cost: number;
  share: number;
  avg_cost: number;
  concepts: Record<string, number>;
}

export interface FinAccount {
  code: number;
  desc: string;
  type: "gasto" | "pasivo" | "activo" | "otro";
  concept: string;
  concept_label: string;
  area: string;
  position?: string | null;
  rows: number;
  people: number;
  cost_centers: number;
  files: number;
  debit: number;
  credit: number;
  net: number;
}

export interface FinWarning {
  level: "info" | "warn" | "error";
  code: string;
  text: string;
}

export interface FinSummary {
  period?: string | null;
  period_label: string;
  totals: FinSessionTotals;
  categories: Record<"mensualero" | "jornalero" | "sin_clasificar" | "egresos", FinCategory>;
  concepts: { concept: string; label: string; cost: number; share: number }[];
  positions: { position: string; people: number; cost: number; avg_cost: number }[];
  cost_centers: FinCostCenter[];
  clients: { client: string; cost_centers: number; people: number; cost: number; share: number }[];
  accounts: FinAccount[];
  files: {
    id: string; label: string; kind: string; filename: string; entry_number?: number | null;
    entry_date?: string | null; rows: number; people: number; debit: number; credit: number;
    diff: number; dirty_funcods: number;
  }[];
  warnings: FinWarning[];
}

export interface FinCollaborator {
  funcod: string;
  name: string;
  category: "mensualero" | "jornalero" | "sin_clasificar";
  is_egreso: boolean;
  position?: string | null;
  cc_main_code?: number | null;
  cc_main_desc?: string | null;
  cc_count: number;
  cc_codes: number[];
  file_labels: string[];
  entry_count: number;
  total_cost: number;
  total_liabilities: number;
  total_deductions: number;
  net_pay: number;
  breakdown: Record<string, number>;
  funcod_dirty: boolean;
}

export interface FinEntry {
  id: number;
  file_id: string;
  file_label: string;
  row_index: number;
  entry_number?: number | null;
  entry_date?: string | null;
  account_code: number;
  account_desc: string;
  account_type: string;
  concept: string;
  concept_label: string;
  area: string;
  position?: string | null;
  cc_code: number;
  cc_desc: string;
  debit: number;
  credit: number;
  orden?: number | null;
  funcod: string;
  employee_name: string;
}

export interface FinNote {
  id: string;
  session_id: string;
  title: string;
  body_md?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  ref_label?: string | null;
  created_by: string;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

/* ---------- Formato ---------- */

const nf = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });

/** Guaraníes enteros con separador de miles: «Gs. 5.808.805.365». */
export function gs(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `Gs. ${nf.format(Math.round(n))}`;
}

/** Versión compacta para tarjetas: «Gs. 5.809 M» / «Gs. 218,6 M» / «Gs. 950 mil». */
export function gsCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000_000) return `${sign}Gs. ${(abs / 1_000_000).toLocaleString("es-PY", { maximumFractionDigits: 0 })} M`;
  if (abs >= 10_000_000) return `${sign}Gs. ${(abs / 1_000_000).toLocaleString("es-PY", { maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000_000) return `${sign}Gs. ${(abs / 1_000_000).toLocaleString("es-PY", { maximumFractionDigits: 2 })} M`;
  if (abs >= 10_000) return `${sign}Gs. ${(abs / 1_000).toLocaleString("es-PY", { maximumFractionDigits: 0 })} mil`;
  return `${sign}Gs. ${nf.format(abs)}`;
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return nf.format(n);
}

export function pct(share: number | null | undefined, digits = 1): string {
  if (share === null || share === undefined) return "—";
  return `${(share * 100).toLocaleString("es-PY", { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
}

export const CATEGORY_LABEL: Record<string, string> = {
  mensualero: "Mensualero",
  jornalero: "Jornalero",
  sin_clasificar: "Sin clasificar",
};

export const KIND_LABEL: Record<string, string> = {
  mensualeros: "Nómina mensualeros",
  operaciones: "Nómina operaciones",
  egresos: "Egresos",
  complemento: "Complemento",
  otro: "Otro",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  queued: "En cola",
  running: "Ejecutando",
  done: "Analizada",
  failed: "Con error",
};

/* ---------- Paleta de gráficos (validada con el validador de dataviz, modo claro) ----------
 * Categóricos en orden fijo: mensualeros (cian oscuro), jornaleros (púrpura), tercero (naranja).
 * Nunca se ciclan: una serie es siempre el mismo color. Los textos van en tinta, nunca en color de serie. */
export const CHART = {
  mensualero: "#0093A0",
  jornalero: "#7A3A9C",
  third: "#D9531E",
  single: "#0093A0",
  grid: "#E5E7EB",
  ink: "#0F1116",
  slate: "#5B6275",
};
