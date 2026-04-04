"use client";

import { cn } from "@/lib/utils";

export function AnimatedGridPattern({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-0 opacity-[0.28]",
          "[background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)]",
          "[background-size:52px_52px]",
          "animate-grid-drift",
        )}
      />
    </div>
  );
}
