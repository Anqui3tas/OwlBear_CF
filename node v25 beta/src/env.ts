declare const __APP_VERSION__: string;
declare const __BROKER_URL__: string;
declare const __MAINTENANCE__: string;

export const appVersion = __APP_VERSION__;
export const brokerUrl = __BROKER_URL__;
export const maintenanceMode = __MAINTENANCE__ === "true";
