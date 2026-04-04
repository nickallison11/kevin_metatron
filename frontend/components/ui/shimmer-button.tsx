"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Common = {
  className?: string;
  children: ReactNode;
};

type ShimmerButtonAsButton = Common &
  ComponentPropsWithoutRef<"button"> & { href?: undefined };

type ShimmerButtonAsLink = Common &
  Pick<ComponentPropsWithoutRef<typeof Link>, "href" | "prefetch" | "replace"> &
  Omit<ComponentPropsWithoutRef<typeof Link>, "className" | "children">;

const shell =
  "relative inline-flex items-center justify-center overflow-hidden rounded-lg px-7 py-3 text-sm font-semibold text-white transition-shadow disabled:pointer-events-none disabled:opacity-60";

const surface =
  "bg-metatron-accent hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)]";

const sheen =
  "pointer-events-none absolute inset-0 w-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent";

export function ShimmerButton(props: ShimmerButtonAsButton | ShimmerButtonAsLink) {
  if ("href" in props && props.href) {
    const { href, prefetch, replace, className, children, ...rest } =
      props as ShimmerButtonAsLink;
    return (
      <Link
        href={href}
        prefetch={prefetch}
        replace={replace}
        className={cn(shell, surface, className)}
        {...rest}
      >
        <span className={sheen} aria-hidden />
        <span className="relative z-10">{children}</span>
      </Link>
    );
  }

  const { className, children, type = "button", ...rest } =
    props as ShimmerButtonAsButton;

  return (
    <button
      type={type}
      className={cn(shell, surface, className)}
      {...rest}
    >
      <span className={sheen} aria-hidden />
      <span className="relative z-10">{children}</span>
    </button>
  );
}
