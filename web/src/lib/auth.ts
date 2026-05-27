import { BRAND_ENVIRONMENTS, type BrandEnvironmentId } from "./brand-environments";

export const AUTH_COOKIE = "carp_auth";

export interface AuthSession {
  brandId: BrandEnvironmentId;
  user: string;
  area: AuthArea;
  allAccess?: boolean;
  mustChangePassword?: boolean;
}

export type AuthArea = "personal" | "administracion";

export const AUTH_AREAS: Record<AuthArea, { id: AuthArea; name: string }> = {
  personal: { id: "personal", name: "Personal" },
  administracion: { id: "administracion", name: "Administracion" },
};

const ENV_PREFIX: Record<BrandEnvironmentId, string> = {
  casa: "CASA_AUTH",
  pirone: "PIRONE_AUTH",
};

const DEFAULT_USERS: Record<BrandEnvironmentId, { user: string; password: string }> = {
  casa: { user: "casa", password: "casa2026" },
  pirone: { user: "pirone", password: "pirone2026" },
};

export function credentialsFor(brandId: BrandEnvironmentId) {
  const prefix = ENV_PREFIX[brandId];
  return {
    user: process.env[`${prefix}_USER`] || DEFAULT_USERS[brandId].user,
    password: process.env[`${prefix}_PASSWORD`] || DEFAULT_USERS[brandId].password,
  };
}

export function sessionSecret() {
  return process.env.AUTH_SESSION_SECRET || "dev-local-carpinteria";
}

export function sessionToken(session: AuthSession) {
  const payload = encodeURIComponent(
    JSON.stringify({
      brandId: session.brandId,
      user: session.user,
      area: session.area,
      allAccess: !!session.allAccess,
      mustChangePassword: !!session.mustChangePassword,
    }),
  );
  return `${payload}.${sessionSecret()}`;
}

export function readSessionToken(token: string | undefined): AuthSession | null {
  if (!token) return null;
  const [payload, secret] = token.split(".");
  if (!payload || secret !== sessionSecret()) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(payload));
    if (
      parsed?.brandId in BRAND_ENVIRONMENTS &&
      typeof parsed?.user === "string" &&
      parsed?.area in AUTH_AREAS
    ) {
      return {
        brandId: parsed.brandId,
        user: parsed.user,
        area: parsed.area,
        allAccess: !!parsed.allAccess,
        mustChangePassword: !!parsed.mustChangePassword,
      };
    }
  } catch {
    return null;
  }
  return null;
}
