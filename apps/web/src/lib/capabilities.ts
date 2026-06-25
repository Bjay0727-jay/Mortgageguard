"use client";

import type { Capability } from "@mortgageguard/shared";
import { hasCapability } from "@mortgageguard/shared";
import { useAuth } from "./auth";

export function useCapabilities() {
  const { user } = useAuth();
  const role = user?.role;

  return {
    role,
    can: (capability: Capability) => hasCapability(role, capability),
  };
}
