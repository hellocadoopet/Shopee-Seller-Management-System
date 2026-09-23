/**
 * Quick smoke test for Shopee signing — calls a public endpoint with your
 * partner credentials. If you get back an ip_list, signing works.
 *
 * Run: npm run smoke
 */
import { getShopeeIpRanges } from "../lib/shopee";
import { config } from "../lib/config";

if (!config.shopee.partnerId || !config.shopee.partnerKey) {
  console.error("Set SHOPEE_PARTNER_ID and SHOPEE_PARTNER_KEY in .env.local first.");
  process.exit(1);
}

console.log(`Using SHOPEE_ENV=${config.shopee.env}`);
console.log(`Partner ID: ${config.shopee.partnerId}`);
console.log(`Partner Key length: ${config.shopee.partnerKey.length} chars`);

getShopeeIpRanges()
  .then((res) => {
    console.log("✓ Success — signing works.");
    console.log("  Sample IPs:", res.ip_list?.slice(0, 3));
    process.exit(0);
  })
  .catch((err) => {
    console.error("✗ Failed:", err.message ?? err);
    process.exit(1);
  });
