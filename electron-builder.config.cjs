const appUrl = process.env.TAG_FIND_URL;
if (!appUrl) throw new Error("Set TAG_FIND_URL to the deployed HTTPS site before building.");
const url = new URL(appUrl);
if (url.protocol !== "https:" || url.username || url.password) {
  throw new Error("Desktop installers require a public HTTPS TAG_FIND_URL without credentials.");
}

module.exports = {
  appId: "com.tagandfind.app",
  productName: "Locatelly",
  directories: { output: "release" },
  files: ["electron/**/*", "package.json"],
  extraMetadata: { tagFindUrl: url.toString().replace(/\/$/, "") },
  win: { target: ["nsis"] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  mac: { category: "public.app-category.utilities", target: ["dmg"] },
};
