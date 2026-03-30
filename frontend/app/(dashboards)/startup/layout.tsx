import type { ReactNode } from "react";
import KevinChat from "@/components/KevinChat";
import StartupShell from "@/components/StartupShell";

export default function StartupLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <StartupShell>{children}</StartupShell>
      <KevinChat />
    </>
  );
}
