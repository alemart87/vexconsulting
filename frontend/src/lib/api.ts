"use client";

const TOKEN_KEY = "vex_token";
const REFRESH_KEY = "vex_refresh";
const USER_KEY = "vex_user";

export interface CurrentUserInfo {
  id: string;
  email: string;
  role: string; // superadmin | consultor_lider | consultor | visualizador
  full_name: string;
  photo_url?: string | null;
}

export function setSession(token: string, refreshToken: string, user: CurrentUserInfo) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): CurrentUserInfo | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function saveUser(partial: Partial<CurrentUserInfo>): void {
  if (typeof window === "undefined") return;
  const cur = getUser() ?? ({} as CurrentUserInfo);
  localStorage.setItem(USER_KEY, JSON.stringify({ ...cur, ...partial }));
}

export const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  consultor_lider: "Consultor líder",
  consultor: "Consultor",
  visualizador: "Visualizador",
};

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!(opts.body instanceof FormData) && opts.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    clearSession();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Sesión expirada");
  }
  if (!res.ok) {
    let detail = "Error";
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body);
    } catch {}
    // Cambio de contraseña obligatorio: el backend bloquea todo hasta cumplirlo
    if (res.status === 403 && detail === "password_change_required" && typeof window !== "undefined") {
      if (!window.location.pathname.startsWith("/perfil")) {
        window.location.href = "/perfil?pw=obligatorio";
      }
      throw new Error("Debés cambiar tu contraseña para continuar");
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Descarga autenticada: fetch con el token → blob → link temporal.
 * (Navegar directo a la URL pierde el header Authorization → 401.) */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let detail = "Error al descargar";
    try {
      detail = (await res.json()).detail || detail;
    } catch {}
    throw new Error(detail);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Fechas de la API: el backend guarda UTC; si el ISO llega sin zona horaria
 * hay que tratarlo como UTC (parsearlo «a secas» lo corre a hora local). */
export function parseApiDate(iso: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = parseApiDate(iso);
  return d.toLocaleString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
