import type { AdsCapability, PromotionsCapability } from "../types.js";
import { getAdsPerformance, getVoucherList } from "./api/index.js";
import { toAdReport, toVoucher } from "./utils/mappers.js";

export const promotions: PromotionsCapability = {
  async listVouchers({ accessToken, externalId }) {
    const r = await getVoucherList(accessToken, Number(externalId), "all");
    return (r.voucher_list ?? []).map(toVoucher); // Shopee sends null when there are none
  },
};

export const ads: AdsCapability = {
  async report({ accessToken, externalId }, { start, end }) {
    const r = await getAdsPerformance(accessToken, Number(externalId), start, end);
    return (r.report_list ?? []).map(toAdReport);
  },
};
