import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.TAG_FIND_URL;
let server: CapacitorConfig["server"];

if (appUrl) {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new Error("TAG_FIND_URL must be an absolute HTTPS URL, or an HTTP URL for local Android testing.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("TAG_FIND_URL must use HTTPS, or HTTP for local Android testing.");
  }
  if (url.username || url.password) {
    throw new Error("TAG_FIND_URL must not contain credentials.");
  }
  server = {
    url: url.toString().replace(/\/$/, ""),
    cleartext: url.protocol === "http:",
    allowNavigation: [url.hostname],
  };
}

const config: CapacitorConfig = {
  appId: "com.tagandfind.app",
  appName: "Locatelly",
  webDir: "public",
  ...(server ? { server } : {}),
};

export default config;
