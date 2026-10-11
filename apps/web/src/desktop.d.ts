export type DesktopCapabilities = {
  platform: string;
  poppler: boolean;
  calibre: boolean;
  gio: boolean;
  secureStorage: boolean;
};

export type DesktopMaintenanceResult = {
  status: "success" | "cancelled" | "busy" | "error";
  message?: string;
};

declare global {
  interface Window {
    folioDesktop?: {
      language: "es" | "en";
      capabilities: DesktopCapabilities;
      setLanguage(language: "es" | "en"): Promise<string>;
      refreshCapabilities(): Promise<DesktopCapabilities>;
      maintenance(command: "backup" | "verify" | "restore"): Promise<DesktopMaintenanceResult>;
    };
  }
}
