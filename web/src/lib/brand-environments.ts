export const BRAND_ENVIRONMENTS = {
  casa: {
    id: "casa",
    name: "La Casa del Carpintero",
    shortName: "Casa",
    tone: "Verde",
  },
  pirone: {
    id: "pirone",
    name: "Fabrica de Molduras y Carpinteria Juan Pirone",
    shortName: "Pirone",
    tone: "Azul",
  },
} as const;

export type BrandEnvironmentId = keyof typeof BRAND_ENVIRONMENTS;

export const DEFAULT_BRAND_ENVIRONMENT: BrandEnvironmentId = "casa";

export function isBrandEnvironmentId(value: string): value is BrandEnvironmentId {
  return value in BRAND_ENVIRONMENTS;
}
