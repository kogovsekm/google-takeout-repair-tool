import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";

import { processTakeoutFolder, postProcessFolder } from "./processor.js";
import type {
  PostProcessRequest,
  ProcessRequest,
  ProgressUpdate,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

/**
 * @description Creates the main desktop window and loads either dev server or built renderer assets.
 * @returns Nothing.
 */
const createWindow = (): void => {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const defaultWidth = Math.min(1160, Math.max(980, workArea.width - 120));
  const defaultHeight = Math.min(940, Math.max(760, workArea.height - 120));

  mainWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 920,
    minHeight: 700,
    backgroundColor: "#0a1118",
    title: "Google Takeout Repair Tool",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
};

/**
 * @description Sends processing progress updates to the renderer process.
 * @param payload Progress payload to publish.
 * @returns Nothing.
 */
const sendProgress = (payload: ProgressUpdate): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("takeout:progress", payload);
  }
};

const sendOrganiseProgress = (payload: ProgressUpdate): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("takeout:organise-progress", payload);
  }
};

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle(
    "takeout:select-folder",
    async (_event, title?: string, defaultPath?: string) => {
      if (!mainWindow) {
        return null;
      }

      const response = await dialog.showOpenDialog(mainWindow, {
        title: title ?? "Select Folder",
        ...(defaultPath ? { defaultPath } : {}),
        properties: ["openDirectory"],
      });

      if (response.canceled || response.filePaths.length === 0) {
        return null;
      }

      return response.filePaths[0] ?? null;
    },
  );

  ipcMain.handle(
    "takeout:process-folder",
    async (_event, request: ProcessRequest) => {
      const summary = await processTakeoutFolder(request, sendProgress);
      return summary;
    },
  );

  ipcMain.handle(
    "takeout:post-process",
    async (_event, request: PostProcessRequest) => {
      const summary = await postProcessFolder(request, sendOrganiseProgress);
      return summary;
    },
  );

  ipcMain.handle("takeout:open-folder", async (_event, folderPath: string) => {
    await shell.openPath(folderPath);
  });

  ipcMain.handle(
    "takeout:save-report",
    async (_event, defaultFileName: string, report: unknown) => {
      if (!mainWindow) {
        return false;
      }

      const response = await dialog.showSaveDialog(mainWindow, {
        title: "Save processing report",
        defaultPath: defaultFileName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (response.canceled || !response.filePath) {
        return false;
      }

      await fs.writeFile(
        response.filePath,
        JSON.stringify(report, null, 2),
        "utf8",
      );
      return true;
    },
  );

  app.on("activate", () => {
    const noWindows = BrowserWindow.getAllWindows().length === 0;
    if (noWindows) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
