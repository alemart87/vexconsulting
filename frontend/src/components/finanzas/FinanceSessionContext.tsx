"use client";

import { createContext, useContext } from "react";
import type { FinSession } from "@/lib/finanzas";

export interface FinanceSessionValue {
  session: FinSession | null;
  reload: () => void;
  isSuperadmin: boolean;
}

export const FinanceSessionContext = createContext<FinanceSessionValue>({
  session: null,
  reload: () => {},
  isSuperadmin: false,
});

export function useFinanceSession(): FinanceSessionValue {
  return useContext(FinanceSessionContext);
}
