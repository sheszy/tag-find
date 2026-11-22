const mode = process.argv[2];
const value = process.env.LOCATELLY_URL || process.env.TAG_FIND_URL;
if (!value) {
  throw new Error("Set LOCATELLY_URL to the deployed HTTPS site or your PC's private-network URL for Android testing.");
}

let url;
try {
  url = new URL(value);
} catch {
  throw new Error("LOCATELLY_URL must be an absolute URL.");
}
if (url.username || url.password) throw new Error("LOCATELLY_URL must not contain credentials.");
if (mode === "desktop" && url.protocol !== "https:") {
  throw new Error("Desktop installers require a public HTTPS LOCATELLY_URL.");
}
if (mode === "mobile" && url.protocol !== "https:") {
  const isPrivateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "http:" || (process.env.LOCATELLY_ALLOW_HTTP || process.env.TAG_FIND_ALLOW_HTTP) !== "1" || (!isPrivateIpv4 && !isLocal)) {
    throw new Error("Use HTTPS, or explicitly enable HTTP only for Android testing on localhost/private Wi-Fi.");
  }
}
