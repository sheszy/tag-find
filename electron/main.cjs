const { app, BrowserWindow, dialog, shell } = require("electron");
const metadata = require("../package.json");

function getAppUrl() {
  const configuredUrl = process.env.TAG_FIND_URL || metadata.tagFindUrl;
  const appUrl = configuredUrl || (app.isPackaged ? "" : "http://localhost:3000");
  if (!appUrl) throw new Error("Rebuild this app with TAG_FIND_URL set to your deployed HTTPS site.");

  const url = new URL(appUrl);
  const isLocalDevelopment = !app.isPackaged
    && url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalDevelopment) {
    throw new Error("The desktop app requires an HTTPS site URL (HTTP is allowed only for local development).");
  }
  if (url.username || url.password) throw new Error("The site URL must not contain credentials.");
  return url;
}

async function createWindow() {
  let appUrl;
  try {
    appUrl = getAppUrl();
  } catch (error) {
    dialog.showErrorBox("Locatelly could not start", error.message);
    app.quit();
    return;
  }

  const window = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 360,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  await window.loadURL(appUrl.toString());
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
