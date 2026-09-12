import { NextRequest, NextResponse } from "next/server";
import { assertConfig } from "@/lib/config";
import { exchangeCodeForToken, getShopInfo } from "@/lib/shopee";
import { supabase } from "@/lib/supabase";
import { saveTokens } from "@/lib/tokens";

/**
 * Shopee redirects here after the seller authorizes the app.
 * Query params: code, shop_id, state.
 *
 * Runs fully on the server — no browser bouncing, no CORS, no mixed content.
 */
export async function GET(req: NextRequest) {
  assertConfig();

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const shopIdStr = searchParams.get("shop_id");
  const state = searchParams.get("state");

  if (!code || !shopIdStr || !state) {
    return renderError("Missing code, shop_id, or state from Shopee redirect.", req.url);
  }
  const shopeeShopId = Number(shopIdStr);

  // Verify the state matches the cookie we set at /authorize (CSRF guard)
  const cookieState = req.cookies.get("shopee_oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    return renderError("Invalid or expired state token. Please click Connect again.", req.url);
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForToken(code, shopeeShopId);

    // Get shop name (best effort)
    let shopName: string | null = null;
    try {
      const info = await getShopInfo(tokens.access_token, shopeeShopId);
      shopName = info.shop_name;
    } catch {
      // Non-fatal — we can fill in later
    }

    // Upsert shop row
    const { data: shop, error } = await supabase
      .from("shops")
      .upsert(
        {
          shopee_shop_id: shopeeShopId,
          shop_name: shopName,
          connected_at: new Date().toISOString(),
          disconnected_at: null,
        },
        { onConflict: "shopee_shop_id" },
      )
      .select("id")
      .single();
    if (error || !shop) return renderError(`DB error: ${error?.message ?? "no shop returned"}`, req.url);

    // Save tokens
    await saveTokens(shop.id, tokens.access_token, tokens.refresh_token, tokens.expire_in);

    // Set current_shop_id cookie + go to dashboard
    const res = NextResponse.redirect(new URL("/dashboard", req.url));
    res.cookies.set("current_shop_id", shop.id, {
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
    res.cookies.delete("shopee_oauth_state");
    return res;
  } catch (e) {
    return renderError(`Shopee error: ${String(e)}`, req.url);
  }
}

function renderError(message: string, baseUrl: string) {
  const url = new URL("/connect", baseUrl);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}
