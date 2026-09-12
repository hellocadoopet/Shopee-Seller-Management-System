import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { assertConfig } from "@/lib/config";
import { buildAuthUrl } from "@/lib/shopee";

/**
 * Start the OAuth flow. We generate a random `state` token, keep it in a
 * short-lived httpOnly cookie, and also embed it in the redirect URL so it
 * round-trips back from Shopee. The callback checks the two match (CSRF guard).
 *
 * Shopee redirects back to /api/shopee/callback?code=...&shop_id=...&state=...
 */
export async function GET() {
  assertConfig();

  const state = crypto.randomBytes(16).toString("hex");

  const url = new URL(buildAuthUrl());
  const redirect = new URL(url.searchParams.get("redirect") ?? "");
  redirect.searchParams.set("state", state);
  url.searchParams.set("redirect", redirect.toString());

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("shopee_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes is plenty to complete the login
    path: "/",
  });
  return res;
}
