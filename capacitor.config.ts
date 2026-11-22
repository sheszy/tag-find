import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.LOCATELLY_URL;
let server: CapacitorConfig["server"];

if (appUrl) {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new Error("LOCATELLY_URL must be an absolute HTTPS URL, or an HTTP URL for local network testing.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("LOCATELLY_URL must use HTTPS, or HTTP for local network testing.");
  }
  if (url.username || url.password) {
    throw new Error("LOCATELLY_URL must not contain credentials.");
  }
  if (url.protocol === "http:") {
    const isPrivateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!isPrivateIpv4 && !isLocal) || process.env.LOCATELLY_ALLOW_HTTP !== "1") {
      throw new Error("HTTP is allowed only for localhost or a private LAN URL when LOCATELLY_ALLOW_HTTP=1.");
    }
    }
  server = {
    url: url.toString().replace(/\/$/, ""),
    cleartext: url.protocol === "http:",
    allowNavigation: [url.hostname],
  };
}

const config: CapacitorConfig = {
  appId: "com.locatelly.app",
  appName: "Locatelly",
  webDir: "public",
  ...(server ? { server } : {}),
};

export default config;
