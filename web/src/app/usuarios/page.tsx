"use client";

import { useEffect, useState } from "react";

import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";
import { AUTH_AREAS, type AuthArea } from "@/lib/auth";
import { BRAND_ENVIRONMENTS, type BrandEnvironmentId } from "@/lib/brand-environments";

interface AppUser {
  id: string;
  username: string;
  brandId: BrandEnvironmentId;
  area: AuthArea;
  active: boolean;
  failed_attempts: number;
  locked: boolean;
  must_change_password: boolean;
  created_at?: string;
}

const AREA_OPTIONS = [AUTH_AREAS.personal, AUTH_AREAS.administracion];
const BRAND_OPTIONS = [BRAND_ENVIRONMENTS.casa, BRAND_ENVIRONMENTS.pirone];

export default function UsersPage() {
  const { brand } = useBrandEnvironment();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    username: "",
    password: "",
    brandId: "casa" as BrandEnvironmentId,
    area: "personal" as AuthArea,
  });

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/users");
      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error || "No se pudieron cargar usuarios");
        return;
      }
      setUsers(data.users || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error || "No se pudo crear el usuario");
        return;
      }
      setDraft((d) => ({ ...d, username: "", password: "" }));
      await loadUsers();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: AppUser) {
    await fetch(`/api/auth/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !user.active }),
    });
    await loadUsers();
  }

  async function changePassword(user: AppUser) {
    const password = window.prompt(`Nueva contraseña para ${user.username}`);
    if (!password) return;
    await fetch(`/api/auth/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    await loadUsers();
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <div className="text-xs uppercase font-semibold text-primary">
          {brand.name}
        </div>
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          Creá accesos por empresa y área. Más adelante usamos esta área para permisos finos.
        </p>
      </header>

      <form onSubmit={createUser} className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">
          Nuevo usuario
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Empresa</label>
            <select
              value={draft.brandId}
              onChange={(e) => setDraft((d) => ({ ...d, brandId: e.target.value as BrandEnvironmentId }))}
              className="w-full rounded border bg-background px-2 py-2 text-sm"
            >
              {BRAND_OPTIONS.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Area</label>
            <select
              value={draft.area}
              onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value as AuthArea }))}
              className="w-full rounded border bg-background px-2 py-2 text-sm"
            >
              {AREA_OPTIONS.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Usuario</label>
            <input
              value={draft.username}
              onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
              className="w-full rounded border bg-background px-2 py-2 text-sm"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Contraseña</label>
            <input
              type="password"
              value={draft.password}
              onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
              className="w-full rounded border bg-background px-2 py-2 text-sm"
              required
            />
          </div>
        </div>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Crear usuario"}
        </button>
      </form>

      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="border-b px-4 py-3 text-sm font-semibold">
          Usuarios creados
        </div>
        {loading ? (
          <div className="p-4 text-sm text-muted-foreground">Cargando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-4 py-2">Usuario</th>
                <th className="px-4 py-2">Empresa</th>
                <th className="px-4 py-2">Area</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{u.username}</td>
                  <td className="px-4 py-2">{BRAND_ENVIRONMENTS[u.brandId]?.name || u.brandId}</td>
                  <td className="px-4 py-2">{AUTH_AREAS[u.area]?.name || u.area}</td>
                  <td className="px-4 py-2">
                    <span className={u.active && !u.locked ? "text-primary" : "text-muted-foreground"}>
                      {u.locked ? "Bloqueado por intentos" : u.active ? "Activo" : "Bloqueado"}
                    </span>
                    {u.failed_attempts > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {u.failed_attempts}/5 intentos
                      </div>
                    )}
                    {u.must_change_password && (
                      <div className="text-xs text-amber-700">
                        Debe cambiar clave
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button className="text-primary underline" onClick={() => changePassword(u)}>
                      Cambiar clave
                    </button>
                    <button className="text-primary underline" onClick={() => toggleActive(u)}>
                      {u.active ? "Bloquear" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    Todavia no hay usuarios en Mongo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
