"use client";

import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
} from "framer-motion";
import type { ReactNode } from "react";
import { useState } from "react";

export function FloatingNavbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { scrollYProgress } = useScroll();
  const [visible, setVisible] = useState(true);

  useMotionValueEvent(scrollYProgress, "change", (current) => {
    if (typeof current !== "number") return;
    const prev = scrollYProgress.getPrevious() ?? 0;
    const direction = current - prev;

    if (scrollYProgress.get() < 0.02) {
      setVisible(true);
    } else if (direction < 0) {
      setVisible(true);
    } else if (direction > 0) {
      setVisible(false);
    }
  });

  return (
    <AnimatePresence mode="wait">
      <motion.header
        initial={{ opacity: 1, y: 0 }}
        animate={{
          y: visible ? 0 : -120,
          opacity: visible ? 1 : 0,
        }}
        transition={{ duration: 0.22 }}
        className={cn(
          "fixed left-0 right-0 top-0 z-[5000] flex justify-center px-4 pt-4",
          className,
        )}
      >
        <div className="nav-metatron flex w-full max-w-[1200px] items-center justify-between rounded-metatron border border-[var(--border)] bg-[rgba(10,10,15,0.9)] shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-[12px]">
          {children}
        </div>
      </motion.header>
    </AnimatePresence>
  );
}
