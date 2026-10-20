import { NextResponse, type NextRequest } from "next/server";
import { COUNTRY_COOKIE } from "@/lib/countryCookie";

export function middleware(request: NextRequest) {
  const res = NextResponse.next();
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
