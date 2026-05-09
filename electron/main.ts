import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";

import {
  finalizeTempOrganise,
  processTakeoutFolder,
  postProcessFolder,
  validateProcessPaths,
} from "./processor.js";
import type {
  FinalizeTempOrganiseRequest,
  PostProcessRequest,
  ProcessOptions,
  ProcessRequest,
  ProgressUpdate,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let activeRepairAbortController: AbortController | null = null;
const trustedPaths = new Set<string>();

/**
 * @description Validates that a value is a string with reasonable length.
 * @param value Value to check.
 * @param maxLength Maximum string length allowed.
 * @returns True when value is a valid non-empty string.
 */
const isValidPath = (value: unknown, maxLength: number = 4096): boolean => {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
};

/**
 * @description Validates ProcessRequest payload structure.
 * @param request Request to validate.
 * @returns True when request has valid structure.
 */
const isValidProcessRequest = (request: unknown): request is ProcessRequest => {
  if (typeof request !== "object" || request === null) {
    return false;
  }

  const obj = request as Record<string, unknown>;
  const hasValidInputPath = isValidPath(obj.inputPath);
  const hasValidOutputPath = isValidPath(obj.outputPath);
  const hasValidOptions = isValidProcessOptions(obj.options);

  return hasValidInputPath && hasValidOutputPath && hasValidOptions;
};

/**
 * @description Validates ProcessOptions structure.
 * @param options Options to validate.
 * @returns True when options have valid structure.
 */
const isValidProcessOptions = (options: unknown): options is ProcessOptions => {
  if (typeof options !== "object" || options === null) {
    return false;
  }

  const obj = options as Record<string, unknown>;
  return (
    typeof obj.writeMetadata === "boolean" &&
    typeof obj.createYearMonthSubfolders === "boolean" &&
    typeof obj.createYearSubfoldersOnly === "boolean" &&
    typeof obj.ignoreZeroCoordinates === "boolean"
  );
};

/**
 * @description Validates PostProcessRequest payload structure.
 * @param request Request to validate.
 * @returns True when request has valid structure.
 */
const isValidPostProcessRequest = (
  request: unknown,
): request is PostProcessRequest => {
  if (typeof request !== "object" || request === null) {
    return false;
  }

  const obj = request as Record<string, unknown>;
  const hasValidTargetPath = isValidPath(obj.targetPath);
  const hasValidOptions =
    typeof obj.options === "object" &&
    obj.options !== null &&
    typeof (obj.options as Record<string, unknown>).flattenMonthsToYears ===
      "boolean" &&
    typeof (obj.options as Record<string, unknown>).flattenYearsToRoot ===
      "boolean" &&
    typeof (obj.options as Record<string, unknown>).removeEmptyFolders ===
      "boolean";

  return hasValidTargetPath && hasValidOptions;
};

const isValidFinalizeTempOrganiseRequest = (
  request: unknown,
): request is FinalizeTempOrganiseRequest => {
  if (typeof request !== "object" || request === null) {
    return false;
  }

  const obj = request as Record<string, unknown>;
  return isValidPath(obj.targetPath) && isValidPath(obj.tempFolderPath);
};

/**
 * @description Sets up Content Security Policy for the window.
 * @param webContents Window web contents to configure.
 * @returns Nothing.
 */
const setupCSP = (webContents: Electron.WebContents): void => {
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const cspHeader = isDev
    ? "default-src 'self' http://localhost:* ws://localhost:*; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; style-src 'self' 'unsafe-inline' http://localhost:*;"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:;";

  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [cspHeader],
      },
    });
  });
};

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

  if (mainWindow && mainWindow.webContents) {
    setupCSP(mainWindow.webContents);
  }

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
    async (_event, title?: unknown, defaultPath?: unknown) => {
      if (!mainWindow) {
        return null;
      }

      const titleStr = typeof title === "string" ? title : "Select Folder";
      const defaultPathStr =
        typeof defaultPath === "string" ? defaultPath : undefined;

      const response = await dialog.showOpenDialog(mainWindow, {
        title: titleStr,
        ...(defaultPathStr ? { defaultPath: defaultPathStr } : {}),
        properties: ["openDirectory"],
      });

      if (response.canceled || response.filePaths.length === 0) {
        return null;
      }

      const selectedPath = response.filePaths[0];
      if (selectedPath) {
        trustedPaths.add(selectedPath);
      }

      return selectedPath ?? null;
    },
  );

  ipcMain.handle("takeout:process-folder", async (_event, request: unknown) => {
    if (!isValidProcessRequest(request)) {
      throw new Error("Invalid process request payload structure.");
    }

    if (activeRepairAbortController) {
      throw new Error(
        "A repair run is already active. Please wait or abort the current run.",
      );
    }

    const abortController = new AbortController();
    activeRepairAbortController = abortController;

    try {
      const summary = await processTakeoutFolder(
        request,
        sendProgress,
        abortController.signal,
      );
      return summary;
    } finally {
      activeRepairAbortController = null;
    }
  });

  ipcMain.handle("takeout:abort-process", async () => {
    if (!activeRepairAbortController) {
      return false;
    }

    activeRepairAbortController.abort();
    return true;
  });

  ipcMain.handle(
    "takeout:validate-paths",
    async (
      _event,
      inputPath: unknown,
      outputPath: unknown,
    ): Promise<{
      valid: boolean;
      errors: Array<{ type: string; message: string }>;
    }> => {
      if (!isValidPath(inputPath) || !isValidPath(outputPath)) {
        return {
          valid: false,
          errors: [
            { type: "invalid", message: "One or both paths are invalid." },
          ],
        };
      }

      const result = await validateProcessPaths(
        inputPath as string,
        outputPath as string,
      );
      return {
        valid: result.valid,
        errors: result.errors.map((e) => ({
          type: e.type,
          message: e.message,
        })),
      };
    },
  );

  ipcMain.handle("takeout:post-process", async (_event, request: unknown) => {
    if (!isValidPostProcessRequest(request)) {
      throw new Error("Invalid post-process request payload structure.");
    }

    const summary = await postProcessFolder(request, sendOrganiseProgress);
    return summary;
  });

  ipcMain.handle(
    "takeout:finalize-temp-organise",
    async (_event, request: unknown) => {
      if (!isValidFinalizeTempOrganiseRequest(request)) {
        throw new Error(
          "Invalid finalize temp organise request payload structure.",
        );
      }

      const result = await finalizeTempOrganise(
        request.targetPath,
        request.tempFolderPath,
      );
      return result;
    },
  );

  ipcMain.handle("takeout:open-folder", async (_event, folderPath: unknown) => {
    if (!isValidPath(folderPath)) {
      throw new Error("Invalid folder path provided.");
    }

    await shell.openPath(folderPath as string);
  });

  ipcMain.handle(
    "takeout:save-report",
    async (_event, defaultFileName: unknown, report: unknown) => {
      if (!mainWindow) {
        return false;
      }

      if (typeof defaultFileName !== "string" || defaultFileName.length === 0) {
        throw new Error("Invalid default filename provided.");
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
