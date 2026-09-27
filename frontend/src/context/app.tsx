// Server metadata plus the active campaign and session, shared app-wide.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { usePref } from "../lib/hooks";
import type { Campaign, Meta } from "../types";
import { useToast } from "./ui";

interface AppState {
  meta: Meta | null;
  campaigns: Campaign[];
  refreshCampaigns: () => Promise<void>;
  campaignId: string;
  setCampaignId: (id: string) => void;
  /** The last session opened; rolls and "add to encounter" go here. */
  sessionId: string;
  setSessionId: (id: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = usePref("campaign", "");
  const [sessionId, setSessionId] = usePref("session", "");

  const refreshCampaigns = useCallback(async () => {
    const list = await api.list("campaigns").catch(() => [] as Campaign[]);
    setCampaigns(list);
    setCampaignId((current) => {
      if (current && list.some((c) => c.id === current)) return current;
      return list[0]?.id ?? "";
    });
  }, [setCampaignId]);

  useEffect(() => {
    api.meta().then(setMeta, (e: Error) => toast(`Can't reach the Pocket DM server: ${e.message}`, "error", 10000));
    void refreshCampaigns();
  }, [refreshCampaigns, toast]);

  return (
    <AppContext.Provider value={{ meta, campaigns, refreshCampaigns, campaignId, setCampaignId, sessionId, setSessionId }}>
      {children}
    </AppContext.Provider>
  );
}
