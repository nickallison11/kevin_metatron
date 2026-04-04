import type { ReactNode } from "react";
import ConnectorShell from "@/components/ConnectorShell";

export default function ConnectorLayout({ children }: { children: ReactNode }) {
  return <ConnectorShell>{children}</ConnectorShell>;
}
