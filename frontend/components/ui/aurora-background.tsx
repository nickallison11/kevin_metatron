"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface AuroraBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  showRadialGradient?: boolean;
}

export const AuroraBackground = ({
  className,
  children,
  showRadialGradient = true,
  ...props
}: AuroraBackgroundProps) => {
  return (
    <div
      className={cn(
        "relative flex min-h-full w-full flex-col items-center justify-center overflow-hidden bg-transparent text-[var(--text)]",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 overflow-hidden",
          showRadialGradient &&
            "[mask-image:radial-gradient(ellipse_at_50%_0%,black_18%,transparent_70%)]",
        )}
      >
        <div
          className="animate-aurora absolute -inset-[12px] opacity-[0.28] blur-[14px] will-change-transform [background-size:300%_200%] [background-position:50%_50%]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(100deg,#6c5ce7_10%,#9d8df5_14%,#7b6ae8_18%,#b39ffb_22%,#6c5ce7_28%)",
          }}
        />
      </div>
      <div className="relative z-[1] w-full">{children}</div>
    </div>
  );
};
