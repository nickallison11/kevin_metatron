"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export const Meteors = ({
  number,
  className,
}: {
  number?: number;
  className?: string;
}) => {
  const meteorCount = number ?? 20;
  const meteors = new Array(meteorCount).fill(true);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]"
    >
      {meteors.map((_, idx) => {
        const position = idx * (800 / meteorCount) - 400;

        return (
          <span
            key={`meteor-${idx}`}
            className={cn(
              "animate-meteor-effect absolute h-0.5 w-0.5 rotate-[45deg] rounded-full bg-metatron-accent shadow-[0_0_0_1px_rgba(108,92,231,0.25)]",
              "before:absolute before:top-1/2 before:h-px before:w-[50px] before:-translate-y-1/2 before:bg-gradient-to-r before:from-metatron-accent before:to-transparent before:content-['']",
              className,
            )}
            style={{
              top: "-40px",
              left: `${position}px`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${Math.floor(Math.random() * 5 + 5)}s`,
            }}
          />
        );
      })}
    </motion.div>
  );
};
