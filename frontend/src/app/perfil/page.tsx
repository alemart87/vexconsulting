"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch, getUser, saveUser as patchUser } from "@/lib/api";

export default function PerfilPage() {
  const user = typeof window !== "undefined" ? getUser() : null;
  const isSuperadmin = user?.role === "superadmin";
  const forced =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("pw") === "obligatorio";

  /* ---- Foto de perfil ---- */
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(user?.photo_url ?? null);
  const [photoMsg, setPhotoMsg] = useState("");

  const uploadPhoto = async (file: File) => {
    setPhotoMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch<{ photo_url: string }>("/api/v1/users/me/photo", {
        method: "POST",
        body: form,
      });
      setPhoto(res.photo_url);
      patchUser({ photo_url: res.photo_url });
      setPhotoMsg("✓ Foto actualizada — aparecerá en tus revisiones");
    } catch (e: any) {
      setPhotoMsg(`⚠ ${e.message}`);
    }
  };

  /* ---- Contraseña ---- */
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const changePassword = async () => {
    setPwMsg("");
    if (pwNew !== pwConfirm) {
      setPwMsg("⚠ Las contraseñas nuevas no coinciden");
      return;
    }
    setPwBusy(true);
    try {
      await apiFetch("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew }),
      });
      setPwMsg("✓ Contraseña actualizada");
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
      if (forced) setTimeout(() => (window.location.href = "/dashboard"), 900);
    } catch (e: any) {
      setPwMsg(`⚠ ${e.message}`);
    } finally {
      setPwBusy(false);
    }
  };

  /* ---- 2FA ---- */
  const [tfa, setTfa] = useState<{ enabled: boolean; available: boolean } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [tfaSecret, setTfaSecret] = useState<string | null>(null);
  const [tfaCode, setTfaCode] = useState("");
  const [tfaMsg, setTfaMsg] = useState("");

  useEffect(() => {
    apiFetch<any>("/api/v1/auth/2fa/status").then(setTfa).catch(() => {});
  }, []);

  const startSetup = async () => {
    setTfaMsg("");
    try {
      const res = await apiFetch<{ secret: string; otpauth_url: string }>(
        "/api/v1/auth/2fa/setup",
        { method: "POST" }
      );
      setTfaSecret(res.secret);
      const QRCode = (await import("qrcode")).default;
      setQrDataUrl(await QRCode.toDataURL(res.otpauth_url, { width: 220, margin: 1 }));
    } catch (e: any) {
      setTfaMsg(`⚠ ${e.message}`);
    }
  };

  const enable2fa = async () => {
    setTfaMsg("");
    try {
      await apiFetch("/api/v1/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ code: tfaCode }),
      });
      setTfa({ enabled: true, available: true });
      setQrDataUrl(null);
      setTfaSecret(null);
      setTfaCode("");
      setTfaMsg("✓ Doble factor ACTIVADO — se pedirá el código en cada ingreso");
    } catch (e: any) {
      setTfaMsg(`⚠ ${e.message}`);
    }
  };

  const disable2fa = async () => {
    setTfaMsg("");
    try {
      await apiFetch("/api/v1/auth/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ code: tfaCode }),
      });
      setTfa({ enabled: false, available: true });
      setTfaCode("");
      setTfaMsg("✓ Doble factor desactivado");
    } catch (e: any) {
      setTfaMsg(`⚠ ${e.message}`);
    }
  };

  return (
    <AppShell>
      <h1 className="font-display text-3xl uppercase text-brand-ink mb-1">Mi perfil</h1>
      <p className="text-sm text-brand-slate mb-6">
        Foto, contraseña y seguridad de tu cuenta.
      </p>

      {forced && (
        <div className="rounded-md bg-brand-orange/10 border border-brand-orange/50 px-4 py-3 text-sm mb-5 animate-pop">
          🔐 <b>Cambio de contraseña obligatorio.</b> Tu contraseña fue definida por un
          administrador: por seguridad, elegí una propia para continuar usando la
          plataforma.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 max-w-6xl">
        {/* Foto */}
        <div className="card p-6">
          <h2 className="label mb-4">Foto de perfil</h2>
          <div className="flex items-center gap-4">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt="Foto de perfil"
                className="h-20 w-20 rounded-full object-cover border-2 border-brand-border"
              />
            ) : (
              <div className="h-20 w-20 rounded-full bg-brand-primary text-white flex items-center justify-center font-bold text-2xl">
                {user?.full_name?.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <div className="text-sm font-semibold text-brand-ink">{user?.full_name}</div>
              <div className="text-xs text-brand-slate mb-2">{user?.email}</div>
              {!isSuperadmin && (
                <button
                  className="btn-secondary !py-1.5 text-xs"
                  onClick={() => fileRef.current?.click()}
                >
                  📷 Cambiar foto
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadPhoto(f);
              e.currentTarget.value = "";
            }}
          />
          <p className="text-[11px] text-brand-slate mt-3">
            PNG, JPG o WebP · máx. 2 MB. Aparece en el header y en el historial de
            revisiones del documento.
          </p>
          {photoMsg && <p className="text-xs mt-2 text-brand-graphite">{photoMsg}</p>}
        </div>

        {/* Contraseña */}
        <div className={`card p-6 ${forced ? "ring-2 ring-brand-orange" : ""}`}>
          <h2 className="label mb-4">Contraseña</h2>
          {isSuperadmin ? (
            <p className="text-sm text-brand-slate">
              El superadmin gestiona su contraseña desde la configuración del servidor
              (.env).
            </p>
          ) : (
            <div className="space-y-3">
              <input
                type="password"
                className="input"
                placeholder="Contraseña actual"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
              />
              <input
                type="password"
                className="input"
                placeholder="Nueva (mín. 10, letras y números)"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
              />
              <input
                type="password"
                className="input"
                placeholder="Repetir la nueva"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
              />
              <button
                className="btn-primary w-full"
                disabled={pwBusy || !pwCurrent || !pwNew}
                onClick={changePassword}
              >
                {pwBusy ? "Guardando…" : "Cambiar contraseña"}
              </button>
              {pwMsg && <p className="text-xs text-brand-graphite">{pwMsg}</p>}
            </div>
          )}
        </div>

        {/* 2FA */}
        <div className="card p-6">
          <h2 className="label mb-4">Doble autenticación (2FA)</h2>
          {isSuperadmin || tfa?.available === false ? (
            <p className="text-sm text-brand-slate">
              No disponible para la cuenta superadmin del servidor.
            </p>
          ) : tfa?.enabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <b className="text-brand-ink">Activo</b>
                <span className="text-brand-slate">— se pide código al ingresar</span>
              </div>
              <input
                className="input"
                placeholder="Código actual para desactivar"
                value={tfaCode}
                inputMode="numeric"
                maxLength={8}
                onChange={(e) => setTfaCode(e.target.value)}
              />
              <button
                className="btn-danger w-full !py-2"
                disabled={tfaCode.length < 6}
                onClick={disable2fa}
              >
                Desactivar 2FA
              </button>
            </div>
          ) : qrDataUrl ? (
            <div className="space-y-3">
              <p className="text-xs text-brand-slate">
                1. Escaneá el QR con Google Authenticator, 1Password o similar.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR 2FA" className="mx-auto rounded-lg border border-brand-border" />
              <p className="text-[10px] text-brand-slate break-all text-center">
                Clave manual: <code className="bg-brand-bg px-1 rounded">{tfaSecret}</code>
              </p>
              <p className="text-xs text-brand-slate">2. Ingresá el código de 6 dígitos:</p>
              <div className="flex gap-2">
                <input
                  className="input text-center tracking-[0.3em] font-bold"
                  placeholder="000000"
                  value={tfaCode}
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(e) => setTfaCode(e.target.value)}
                />
                <button
                  className="btn-primary whitespace-nowrap"
                  disabled={tfaCode.length < 6}
                  onClick={enable2fa}
                >
                  Activar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-brand-slate leading-relaxed">
                Sumá una segunda barrera: además de la contraseña, un código temporal de
                tu teléfono (Google Authenticator, 1Password, Authy).
              </p>
              <button className="btn-primary w-full" onClick={startSetup}>
                🔐 Activar con código QR
              </button>
            </div>
          )}
          {tfaMsg && <p className="text-xs text-brand-graphite mt-2">{tfaMsg}</p>}
        </div>
      </div>
    </AppShell>
  );
}
