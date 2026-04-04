import type { ReactNode } from "react";
import StartupShell from "@/components/StartupShell";

export default function StartupLayout({ children }: { children: ReactNode }) {
  return <StartupShell>{children}</StartupShell>;
}
