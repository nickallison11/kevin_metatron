import { NextResponse, type NextRequest } from "next/server";
import { COUNTRY_COOKIE } from "@/lib/countryCookie";

// Before launch (NEXT_PUBLIC_PRELAUNCH=true, set only on Vercel production) the
// public pages show /coming-soon. Login, legal pages and the dashboards stay
// reachable; the backend refuses new accounts separately (REGISTRATION_OPEN).
const PRELAUNCH = process.env.NEXT_PUBLIC_PRELAUNCH === "true";
const PRELAUNCH_GATED = [
  "/auth/signup",
  "/messaging-signup",
  "/pricing",
  "/startups",
  "/ratings",
  "/reviewer-login",
];

function isGated(pathname: string) {
  return (
    pathname === "/" ||
    PRELAUNCH_GATED.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

export function middleware(request: NextRequest) {
  const res =
    PRELAUNCH && isGated(request.nextUrl.pathname)
      ? NextResponse.redirect(new URL("/coming-soon", request.url))
      : NextResponse.next();
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");

  // Remember the visitor's country (from Vercel's geo header) so the pricing
  // pages can default to their currency. Outside production, `?country=XX`
  // overrides it for testing other regions.
  const override =
    process.env.VERCEL_ENV !== "production"
      ? request.nextUrl.searchParams.get("country")?.toUpperCase()
      : undefined;
  const country = override ?? request.headers.get("x-vercel-ip-country")?.toUpperCase();
  if (
    country &&
    /^[A-Z]{2}$/.test(country) &&
    request.cookies.get(COUNTRY_COOKIE)?.value !== country
  ) {
    res.cookies.set(COUNTRY_COOKIE, country, {
      path: "/",
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24,
    });
  }
  return res;
}

export const config = {
  matcher: "/:path*",
};
