const appUrl = process.env.LOCATELLY_URL || process.env.TAG_FIND_URL;
if (!appUrl) throw new Error("Set LOCATELLY_URL to the deployed HTTPS site before building.");
const url = new URL(appUrl);
if (url.protocol !== "https:" || url.username || url.password) {
  throw new Error("Desktop installers require a public HTTPS LOCATELLY_URL without credentials.");
}

module.exports = {
  appId: "com.locatelly.app",
  productName: "Locatelly",
  directories: { output: "release" },
  files: ["electron/**/*", "package.json"],
  extraMetadata: { locatellyUrl: url.toString().replace(/\/$/, "") },
  win: { target: ["nsis"] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  mac: { category: "public.app-category.utilities", target: ["dmg"] },
};
