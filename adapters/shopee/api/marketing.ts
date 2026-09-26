import type { ShopeeAdRow, ShopeeVoucher } from "../types.js";
import { signShop } from "../utils/signing.js";
import { execute } from "./client.js";

export function getVoucherList(accessToken: string, shopId: number, status = "all") {
  return execute<{ voucher_list?: ShopeeVoucher[] | null; more: boolean }>(
    signShop("/api/v2/voucher/get_voucher_list", accessToken, shopId, { status, page_no: 1, page_size: 50 }),
    "GET",
  );
}

// ponytail: get_total_balance is the ads account balance, not a per-campaign report — the Ads tab
// stays empty until this calls the performance-report endpoint (README "report endpoint WIP").
export function getAdsPerformance(accessToken: string, shopId: number, startDate: string, endDate: string) {
  return execute<{ report_list?: ShopeeAdRow[] }>(
    signShop("/api/v2/ads/get_total_balance", accessToken, shopId, { start_date: startDate, end_date: endDate }),
    "GET",
  );
}
