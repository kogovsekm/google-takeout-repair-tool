import { contextBridge, ipcRenderer } from "electron";

import type {
  FinalizeTempOrganiseRequest,
  FinalizeTempOrganiseResult,
  PostProcessRequest,
  PostProcessSummary,
  ProcessRequest,
  ProcessSummary,
  ProgressUpdate,
} from "./types.js";

type ProgressListener = (payload: ProgressUpdate) => void;

const api = {
  /**
   * @description Opens a native folder picker and returns selected path.
   * @param title Optional dialog title.
   * @param defaultPath Optional starting path shown by the picker.
   * @returns Selected folder path or null if canceled.
   */
  selectFolder: async (
    title?: string,
    defaultPath?: string,
  ): Promise<string | null> => {
    const selected = await ipcRenderer.invoke(
      "takeout:select-folder",
      title,
      defaultPath,
    );
    if (typeof selected === "string") {
      return selected;
    }

    return null;
  },
  /**
   * @description Starts processing for the selected folder with requested options.
   * @param request Process request payload.
   * @returns Processing summary from main process.
   */
  processFolder: async (request: ProcessRequest): Promise<ProcessSummary> => {
    const summary = await ipcRenderer.invoke("takeout:process-folder", request);
    return summary as ProcessSummary;
  },
  /**
   * @description Requests cancellation of an active repair run.
   * @returns True when an in-flight repair run was signaled to abort.
   */
  abortProcess: async (): Promise<boolean> => {
    const aborted = await ipcRenderer.invoke("takeout:abort-process");
    return aborted === true;
  },
  /**
   * @description Opens a folder in the operating system file manager.
   * @param folderPath Destination folder path.
   * @returns Promise that resolves after the request is handed to the OS.
   */
  openFolder: async (folderPath: string): Promise<void> => {
    await ipcRenderer.invoke("takeout:open-folder", folderPath);
  },
  /**
   * @description Saves the process summary as a JSON file using a native save dialog.
   * @param defaultFileName Suggested output filename.
   * @param report Summary payload to persist.
   * @returns True when the report was saved.
   */
  saveReport: async (
    defaultFileName: string,
    report: ProcessSummary,
  ): Promise<boolean> => {
    const saved = await ipcRenderer.invoke(
      "takeout:save-report",
      defaultFileName,
      report,
    );
    return saved === true;
  },
  /**
   * @description Subscribes to progress events and returns an unsubscribe function.
   * @param listener Callback invoked for each progress event.
   * @returns Cleanup function to remove listener.
   */
  onProgress: (listener: ProgressListener): (() => void) => {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: ProgressUpdate,
    ): void => {
      listener(payload);
    };

    ipcRenderer.on("takeout:progress", wrappedListener);

    return () => {
      ipcRenderer.removeListener("takeout:progress", wrappedListener);
    };
  },
  /**
   * @description Starts folder reorganisation through the Electron bridge.
   * @param request Post-process request payload.
   * @returns Post-process summary from main process.
   */
  postProcessFolder: async (
    request: PostProcessRequest,
  ): Promise<PostProcessSummary> => {
    const summary = await ipcRenderer.invoke("takeout:post-process", request);
    return summary as PostProcessSummary;
  },
  finalizeTempOrganise: async (
    request: FinalizeTempOrganiseRequest,
  ): Promise<FinalizeTempOrganiseResult> => {
    const result = await ipcRenderer.invoke(
      "takeout:finalize-temp-organise",
      request,
    );
    return result as FinalizeTempOrganiseResult;
  },
  /**
   * @description Subscribes to organise-progress events and returns an unsubscribe function.
   * @param listener Callback invoked for each organise progress event.
   * @returns Cleanup function to remove listener.
   */
  onOrganiseProgress: (listener: ProgressListener): (() => void) => {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: ProgressUpdate,
    ): void => {
      listener(payload);
    };

    ipcRenderer.on("takeout:organise-progress", wrappedListener);

    return () => {
      ipcRenderer.removeListener("takeout:organise-progress", wrappedListener);
    };
  },
  /**
   * @description Validates that input and output paths do not overlap or have other safety issues.
   * @param inputPath Repair input path to validate.
   * @param outputPath Repair output path to validate.
   * @returns Validation result with any errors found.
   */
  validatePaths: async (
    inputPath: string,
    outputPath: string,
  ): Promise<{
    valid: boolean;
    errors: Array<{ type: string; message: string }>;
  }> => {
    const result = await ipcRenderer.invoke(
      "takeout:validate-paths",
      inputPath,
      outputPath,
    );
    return result as {
      valid: boolean;
      errors: Array<{ type: string; message: string }>;
    };
  },
};

contextBridge.exposeInMainWorld("takeoutApi", api);
