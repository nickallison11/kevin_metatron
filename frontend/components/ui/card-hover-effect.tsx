"use client";

import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";

export function CardHoverEffect({
  children,
  className,
  layoutId = "metatron-card-hover",
}: {
  children: ReactNode;
  className?: string;
  /** Unique per page to avoid cross-route layout animations */
  layoutId?: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={cn("relative rounded-metatron", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <AnimatePresence>
        {hovered ? (
          <motion.span
            layoutId={layoutId}
            className="absolute inset-0 z-0 block rounded-metatron bg-metatron-accent/10 ring-1 ring-metatron-accent/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        ) : null}
      </AnimatePresence>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
