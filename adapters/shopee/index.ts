import type { PlatformAdapter } from "../types.js";
import { missingShopeeConfig } from "./config.js";
import { connect } from "./connect.js";
import { catalog } from "./catalog.js";
import { orders } from "./orders.js";
import { chat } from "./chat.js";
import { ads, promotions } from "./marketing.js";
import { webhook } from "./webhook.js";

export const shopee: PlatformAdapter = {
  id: "shopee",
  label: "Shopee",
  missingConfig: missingShopeeConfig,
  connect,
  catalog,
  orders,
  chat,
  promotions,
  ads,
  webhook,
};
