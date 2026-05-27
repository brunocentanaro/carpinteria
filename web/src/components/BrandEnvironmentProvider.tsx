"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  BRAND_ENVIRONMENTS,
  DEFAULT_BRAND_ENVIRONMENT,
  type BrandEnvironmentId,
  isBrandEnvironmentId,
} from "@/lib/brand-environments";

interface BrandEnvironmentContextValue {
  brandId: BrandEnvironmentId;
  brand: (typeof BRAND_ENVIRONMENTS)[BrandEnvironmentId];
  setBrandId: (id: BrandEnvironmentId) => void;
}

const BrandEnvironmentContext =
  createContext<BrandEnvironmentContextValue | null>(null);

export function BrandEnvironmentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [brandId, setBrandIdState] = useState<BrandEnvironmentId>(
    DEFAULT_BRAND_ENVIRONMENT,
  );

  useEffect(() => {
    const saved = window.localStorage.getItem("brand-environment");
    if (saved && isBrandEnvironmentId(saved)) {
      setBrandIdState(saved);
      document.documentElement.dataset.brand = saved;
    } else {
      document.documentElement.dataset.brand = DEFAULT_BRAND_ENVIRONMENT;
    }
  }, []);

  function setBrandId(next: BrandEnvironmentId) {
    setBrandIdState(next);
    window.localStorage.setItem("brand-environment", next);
    document.documentElement.dataset.brand = next;
  }

  const value = useMemo(
    () => ({
      brandId,
      brand: BRAND_ENVIRONMENTS[brandId],
      setBrandId,
    }),
    [brandId],
  );

  return (
    <BrandEnvironmentContext.Provider value={value}>
      {children}
    </BrandEnvironmentContext.Provider>
  );
}

export function useBrandEnvironment() {
  const ctx = useContext(BrandEnvironmentContext);
  if (!ctx) {
    throw new Error("useBrandEnvironment must be used inside BrandEnvironmentProvider");
  }
  return ctx;
}
