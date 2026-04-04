"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function BorderBeam({
  children,
  className,
  duration = 5,
}: {
  children: ReactNode;
  className?: string;
  /** Spin period in seconds */
  duration?: number;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg p-px",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[-140%] animate-spin opacity-80"
        style={{
          animationDuration: `${duration}s`,
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(196,181,253,0.95) 55deg, rgba(108,92,231,0.9) 110deg, transparent 160deg)",
        }}
      />
      <div className="relative z-[1] w-full rounded-[11px]">{children}</div>
    </div>
  );
}
