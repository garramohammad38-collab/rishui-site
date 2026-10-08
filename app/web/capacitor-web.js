// Web stand-ins for the native Capacitor plugins (the phone apps use the real ones)
export const Capacitor = { getPlatform: () => "web" };
export const App = { addListener: async () => ({ remove() {} }) };
export const Browser = { open: async ({ url }) => { window.open(url, "_blank", "noopener"); } };
export const Device = {
  getId: async () => ({ identifier: null }),
  getInfo: async () => ({ platform: "web", model: (navigator.userAgent.match(/\(([^;)]+)/) || [])[1] || "browser" }),
};
export const Purchases = {};
