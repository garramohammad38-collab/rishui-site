// Web stand-ins for the native Capacitor plugins (the phone apps use the real ones)
export const Capacitor = { getPlatform: () => "web", isNativePlatform: () => false };
export const App = { addListener: async () => ({ remove() {} }), getLaunchUrl: async () => ({}) };
export const Browser = { open: async ({ url }) => { window.open(url, "_blank", "noopener"); } };
export const Device = {
  getId: async () => ({ identifier: null }),
  getInfo: async () => ({ platform: "web", model: (navigator.userAgent.match(/\(([^;)]+)/) || [])[1] || "browser" }),
};
export const Purchases = {};
export const LocalNotifications = { getPending: async () => ({ notifications: [] }), cancel: async () => {}, schedule: async () => {}, checkPermissions: async () => ({ display: "denied" }), requestPermissions: async () => ({ display: "denied" }) };

export const PushNotifications = { addListener: async () => ({ remove() {} }), register: async () => {}, checkPermissions: async () => ({ receive: 'denied' }), requestPermissions: async () => ({ receive: 'denied' }) };
