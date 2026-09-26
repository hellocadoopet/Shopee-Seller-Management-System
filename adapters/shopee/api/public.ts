import { signPublic } from "../utils/signing.js";
import { execute } from "./client.js";

/** Needs only partner credentials — used by `npm run smoke` to check signing. */
export function getShopeeIpRanges() {
  return execute<{ ip_list: string[] }>(signPublic("/api/v2/public/get_shopee_ip_ranges"), "GET");
}
