"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DataSource, KnowledgeStatus, OpportunityStatus, PageStatus, WorkspaceData } from "@/data/demo/types";

// Estado do PROTÓTIPO. Tudo aqui vive só no navegador (localStorage, chave abaixo): nenhuma escolha de workspace ou ação
// altera um tenant real, o banco ou qualquer serviço. Valores ausentes ou inválidos no armazenamento são ignorados.
const STORAGE_KEY = "skos.demo.v1";

export type Toast = { id: number; message: string };
export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; refs?: readonly { label: string; href: string }[] };
export type AgentRun = { id: string; when: string; output: string };
export type Prefs = { displayName: string; density: "comfortable" | "compact"; theme: "light" | "dark"; sidebarCollapsed: boolean; defaultWorkspaceId: string };

type Persisted = {
  workspaceId: string;
  opportunityStatus: Record<string, OpportunityStatus>;
  pageStatus: Record<string, PageStatus>;
  knowledgeStatus: Record<string, KnowledgeStatus>;
  addedSources: Record<string, DataSource[]>;
  agentRuns: Record<string, AgentRun[]>;
  chats: Record<string, ChatMessage[]>;
  prefs: Prefs;
};

const defaultPrefs = (workspaceId: string): Prefs => ({ displayName: "Usuário demo", density: "comfortable", theme: "light", sidebarCollapsed: false, defaultWorkspaceId: workspaceId });
const emptyState = (workspaceId: string): Persisted => ({
  workspaceId,
  opportunityStatus: {},
  pageStatus: {},
  knowledgeStatus: {},
  addedSources: {},
  agentRuns: {},
  chats: {},
  prefs: defaultPrefs(workspaceId),
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const record = <T,>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => ok(x))) as Record<string, T> : {};
const oneOf = <T extends string>(values: readonly T[]) => (x: unknown): x is T => typeof x === "string" && (values as readonly string[]).includes(x);
const list = <T,>(ok: (x: unknown) => x is T) => (x: unknown): x is T[] => Array.isArray(x) && x.every(ok);
const isSource = (x: unknown): x is DataSource => isObj(x) && typeof x.id === "string" && typeof x.name === "string" && typeof x.type === "string" && typeof x.freshness === "string" && typeof x.records === "number" && typeof x.description === "string" && oneOf(["ok", "stale", "error", "pending"] as const)(x.health);
const isRun = (x: unknown): x is AgentRun => isObj(x) && typeof x.id === "string" && typeof x.when === "string" && typeof x.output === "string";
const isMsg = (x: unknown): x is ChatMessage => isObj(x) && typeof x.id === "string" && typeof x.text === "string" && (x.role === "user" || x.role === "assistant");

/** Lê o armazenamento com validação campo a campo; qualquer problema cai no valor padrão. */
export function parseStored(raw: string | null, workspaceIds: readonly string[], fallbackId: string): Persisted {
  const base = emptyState(fallbackId);
  if (!raw) return base;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!isObj(data)) return base;
  const known = (id: unknown): id is string => typeof id === "string" && workspaceIds.includes(id);
  const prefs = isObj(data.prefs) ? data.prefs : {};
  const defaultWorkspaceId = known(prefs.defaultWorkspaceId) ? prefs.defaultWorkspaceId : fallbackId;
  return {
    workspaceId: known(data.workspaceId) ? data.workspaceId : defaultWorkspaceId,
    opportunityStatus: record(data.opportunityStatus, oneOf(["candidate", "in_review", "ready", "blocked", "dismissed"] as const)),
    pageStatus: record(data.pageStatus, oneOf(["draft", "in_review", "blocked", "ready"] as const)),
    knowledgeStatus: record(data.knowledgeStatus, oneOf(["verified", "needs_review", "expired"] as const)),
    addedSources: record(data.addedSources, list(isSource)),
    agentRuns: record(data.agentRuns, list(isRun)),
    chats: record(data.chats, list(isMsg)),
    prefs: {
      displayName: typeof prefs.displayName === "string" && prefs.displayName.trim() ? prefs.displayName.slice(0, 60) : base.prefs.displayName,
      density: prefs.density === "compact" ? "compact" : "comfortable",
      theme: prefs.theme === "dark" ? "dark" : "light",
      sidebarCollapsed: prefs.sidebarCollapsed === true,
      defaultWorkspaceId,
    },
  };
}

type AppState = {
  hydrated: boolean;
  /** Workspaces já com as alterações locais aplicadas. */
  workspaces: readonly WorkspaceData[];
  current: WorkspaceData;
  selectWorkspace: (id: string) => void;
  setOpportunityStatus: (id: string, status: OpportunityStatus) => void;
  setPageStatus: (id: string, status: PageStatus) => void;
  setKnowledgeStatus: (id: string, status: KnowledgeStatus) => void;
  addSource: (workspaceId: string, source: DataSource) => void;
  agentRuns: (workspaceId: string, agentId: string) => readonly AgentRun[];
  addAgentRun: (workspaceId: string, agentId: string, run: AgentRun) => void;
  chat: readonly ChatMessage[];
  addMessages: (workspaceId: string, messages: readonly ChatMessage[]) => void;
  clearChat: (workspaceId: string) => void;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  resetDemo: () => void;
  toasts: readonly Toast[];
  notify: (message: string) => void;
  dismissToast: (id: number) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ base, initialId, children }: { base: readonly WorkspaceData[]; initialId: string; children: ReactNode }) {
  const ids = useMemo(() => base.map((w) => w.workspace.id), [base]);
  const [saved, setSaved] = useState<Persisted>(() => emptyState(initialId));
  const [hydrated, setHydrated] = useState(false);
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Carrega o estado salvo depois da hidratação (evita divergência entre servidor e cliente).
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null; // armazenamento bloqueado: segue com o padrão
    }
    // O localStorage não existe no servidor: o estado salvo só pode ser lido depois da hidratação.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(parseStored(raw, ids, initialId));
    setHydrated(true);
  }, [ids, initialId]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // sem armazenamento: o estado vale só nesta sessão
    }
  }, [saved, hydrated]);

  useEffect(() => {
    document.documentElement.dataset.density = saved.prefs.density;
  }, [saved.prefs.density]);

  useEffect(() => {
    // O tema vem da preferência local; o script do layout já o aplicou antes da pintura para não piscar.
    document.documentElement.classList.toggle("dark", saved.prefs.theme === "dark");
    document.documentElement.style.colorScheme = saved.prefs.theme;
  }, [saved.prefs.theme]);

  const dismissToast = useCallback((id: number) => {
    const t = toastTimers.current.get(id);
    if (t) clearTimeout(t);
    toastTimers.current.delete(id);
    setToasts((x) => x.filter((m) => m.id !== id));
  }, []);
  const notify = useCallback(
    (message: string) => {
      const id = Date.now() + Math.random();
      setToasts((x) => [...x.slice(-2), { id, message }]);
      toastTimers.current.set(id, setTimeout(() => dismissToast(id), 4500));
    },
    [dismissToast],
  );

  const workspaces = useMemo<readonly WorkspaceData[]>(
    () =>
      base.map((w) => ({
        ...w,
        opportunities: w.opportunities.map((o) => ({ ...o, status: saved.opportunityStatus[o.id] ?? o.status })),
        pages: w.pages.map((p) => ({ ...p, status: saved.pageStatus[p.id] ?? p.status })),
        knowledge: w.knowledge.map((k) => ({ ...k, status: saved.knowledgeStatus[k.id] ?? k.status })),
        sources: [...w.sources, ...(saved.addedSources[w.workspace.id] ?? [])],
      })),
    [base, saved],
  );

  const value = useMemo<AppState>(() => {
    const current = workspaces.find((w) => w.workspace.id === saved.workspaceId) ?? workspaces[0]!;
    const patch = (fn: (s: Persisted) => Persisted) => setSaved(fn);
    return {
      hydrated,
      workspaces,
      current,
      selectWorkspace: (id) => patch((s) => (ids.includes(id) ? { ...s, workspaceId: id } : s)),
      setOpportunityStatus: (id, status) => patch((s) => ({ ...s, opportunityStatus: { ...s.opportunityStatus, [id]: status } })),
      setPageStatus: (id, status) => patch((s) => ({ ...s, pageStatus: { ...s.pageStatus, [id]: status } })),
      setKnowledgeStatus: (id, status) => patch((s) => ({ ...s, knowledgeStatus: { ...s.knowledgeStatus, [id]: status } })),
      addSource: (wsId, source) => patch((s) => ({ ...s, addedSources: { ...s.addedSources, [wsId]: [...(s.addedSources[wsId] ?? []), source] } })),
      agentRuns: (wsId, agentId) => saved.agentRuns[`${wsId}:${agentId}`] ?? [],
      addAgentRun: (wsId, agentId, run) => patch((s) => ({ ...s, agentRuns: { ...s.agentRuns, [`${wsId}:${agentId}`]: [run, ...(s.agentRuns[`${wsId}:${agentId}`] ?? [])].slice(0, 10) } })),
      chat: saved.chats[current.workspace.id] ?? [],
      addMessages: (wsId, messages) => patch((s) => ({ ...s, chats: { ...s.chats, [wsId]: [...(s.chats[wsId] ?? []), ...messages].slice(-60) } })),
      clearChat: (wsId) => patch((s) => ({ ...s, chats: { ...s.chats, [wsId]: [] } })),
      prefs: saved.prefs,
      setPrefs: (p) => patch((s) => ({ ...s, prefs: { ...s.prefs, ...p } })),
      resetDemo: () => patch((s) => ({ ...emptyState(initialId), prefs: { ...s.prefs } })),
      toasts,
      notify,
      dismissToast,
      paletteOpen,
      setPaletteOpen,
      navOpen,
      setNavOpen,
    };
  }, [hydrated, workspaces, saved, ids, initialId, toasts, notify, dismissToast, paletteOpen, navOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState precisa estar dentro de AppStateProvider");
  return v;
}
