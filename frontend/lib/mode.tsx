"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type LayoutMode = "normal" | "advanced";

type ModeContextValue = {
  mode: LayoutMode;
  toggleMode: () => void;
};

const ModeContext = createContext<ModeContextValue | null>(null);

/**
 * Independent of the light/dark theme toggle — this controls layout density
 * (Normal: today's spacious cards/sidebar. Advanced: instrument-panel grid,
 * icon-rail nav, tabular data). Both modes share the same colour tokens and
 * fonts; only structure/density differs.
 */
export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LayoutMode>("normal");

  useEffect(() => {
    const stored = localStorage.getItem("metatron_mode");
    if (stored === "normal" || stored === "advanced") {
      setMode(stored);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "advanced") {
      root.setAttribute("data-mode", "advanced");
    } else {
      root.removeAttribute("data-mode");
    }
  }, [mode]);

  function toggleMode() {
    setMode((m) => {
      const next: LayoutMode = m === "normal" ? "advanced" : "normal";
      localStorage.setItem("metatron_mode", next);
      return next;
    });
  }

  return (
    <ModeContext.Provider value={{ mode, toggleMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) {
    return { mode: "normal", toggleMode: () => {} };
  }
  return ctx;
}
