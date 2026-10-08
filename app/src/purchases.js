import { Capacitor } from "@capacitor/core";
import { Purchases } from "@revenuecat/purchases-capacitor";

// product ids: rishui_<track>_monthly and rishui_<track>_until_exam
const productRe = /^rishui_([a-z]+)_(monthly|until_exam)$/;
const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"
export const storeAvailable = platform === "ios" || platform === "android";

let ready = false;
let packages = {};

export async function initPurchases(userId) {
  if (!storeAvailable || ready) return;
  const apiKey = platform === "ios" ? window.__env.VITE_RC_IOS_KEY : window.__env.VITE_RC_ANDROID_KEY;
  if (!apiKey) return;
  await Purchases.configure({ apiKey, appUserID: userId });
  ready = true;
  try {
    const { current } = await Purchases.getOfferings();
    for (const p of current?.availablePackages ?? []) {
      // Google Play ids can look like "rishui_monthly:monthly"
      const m = (p.product?.identifier ?? "").split(":")[0].match(productRe);
      if (m) packages[`${m[1]}:${m[2] === "monthly" ? "month" : "exam"}`] = p;
    }
  } catch { /* store unreachable: prices just won't show */ }
}

// localized store price, e.g. "₪59.90"
export const priceOf = (track, plan) => packages[`${track}:${plan}`]?.product?.priceString ?? null;

// returns "ok" | "cancelled" | "failed" | "unavailable"
export async function buy(track, plan) {
  const pkg = packages[`${track}:${plan}`];
  if (!ready || !pkg) return "unavailable";
  try {
    await Purchases.purchasePackage({ aPackage: pkg });
    return "ok";
  } catch (e) {
    return e?.userCancelled || e?.code === "1" ? "cancelled" : "failed";
  }
}

export async function restore() {
  if (!ready) return false;
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return Object.keys(customerInfo?.entitlements?.active ?? {}).length > 0 ||
      (customerInfo?.nonSubscriptionTransactions ?? []).length > 0;
  } catch { return false; }
}

export async function logoutPurchases() {
  if (!ready) return;
  try { await Purchases.logOut(); } catch { /* anonymous already */ }
  ready = false; packages = {};
}
