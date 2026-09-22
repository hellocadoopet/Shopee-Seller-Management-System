import { NextRequest, NextResponse } from "next/server";
import { computeAuthToken, isLockEnabled } from "@/lib/appAuth";

// Paths reachable without logging in:
//  - /login + /api/login/logout  → the gate itself
//  - shopee callback/webhook      → Shopee's servers/redirects must reach these
const PUBLIC = ["/login", "/api/login", "/api/logout", "/api/shopee/callback", "/api/shopee/webhook"];

export async function middleware(req: NextRequest) {
  // No password configured → no lock (keeps local dev easy)
  if (!isLockEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("app_auth")?.value;
  const expected = await computeAuthToken();
  if (cookie && cookie === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next.js static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
