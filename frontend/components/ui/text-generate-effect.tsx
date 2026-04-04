"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

/**
 * Variant-based stagger (avoids useAnimate + useEffect), which can interact
 * badly with some Next/Turbopack compile paths.
 */
export const TextGenerateEffect = ({
  words,
  className,
  filter = true,
}: {
  words: string;
  className?: string;
  filter?: boolean;
}) => {
  const wordsArray = words.split(" ");

  const container = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.12,
      },
    },
  };

  const item = {
    hidden: {
      opacity: 0,
      ...(filter ? { filter: "blur(10px)" as const } : {}),
    },
    visible: {
      opacity: 1,
      filter: filter ? ("blur(0px)" as const) : "none",
    },
  };

  return (
    <div className={cn("font-bold", className)}>
      <motion.div
        className="inline"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        {wordsArray.map((word, idx) => (
          <motion.span
            key={`${word}-${idx}`}
            variants={item}
            className="text-[var(--text)]"
          >
            {word}{" "}
          </motion.span>
        ))}
      </motion.div>
    </div>
  );
};
