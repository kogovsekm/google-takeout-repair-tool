export type ProcessOptions = {
  writeMetadata: boolean;
  createYearMonthSubfolders: boolean;
  createYearSubfoldersOnly: boolean;
};

export type ProcessRequest = {
  inputPath: string;
  outputPath: string;
  options: ProcessOptions;
};

export type ProgressUpdate = {
  processed: number;
  total: number;
  currentFile: string | null;
  level: "info" | "warn" | "error";
  message: string;
};

export type ProblemFile = {
  filePath: string;
  message: string;
};

export type FolderTreeNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  children: Array<FolderTreeNode>;
};

export type FileOutcomeTag =
  | "metadata merged"
  | "mirrored metadata"
  | "metadata skipped"
  | "synced file time"
  | "restored MOV"
  | "copied only"
  | "warning";

export type FileOutcome = {
  filePath: string;
  tags: Array<FileOutcomeTag>;
  message: string | null;
};

export type ProcessReport = {
  processedCount: number;
  outputPath: string;
  metadataMergedFiles: Array<string>;
  metadataMirroredFiles: Array<string>;
  syncedFileTimeFiles: Array<string>;
  restoredMovFiles: Array<string>;
  skippedMetadataFiles: Array<string>;
  problemFiles: Array<ProblemFile>;
  fileOutcomes: Array<FileOutcome>;
  folderTree: Array<FolderTreeNode>;
};

export type ProcessSummary = {
  processed: number;
  total: number;
  jsonRemoved: number;
  warnings: Array<string>;
  durationMs: number;
  report: ProcessReport;
};

export type PostProcessOptions = {
  flattenMonthsToYears: boolean;
  flattenYearsToRoot: boolean;
  removeEmptyFolders: boolean;
};

export type PostProcessRequest = {
  targetPath: string;
  options: PostProcessOptions;
};

export type PostProcessReport = {
  targetPath: string;
  movedFilesCount: number;
  removedFoldersCount: number;
  problemFiles: Array<ProblemFile>;
};

export type PostProcessSummary = {
  warnings: Array<string>;
  durationMs: number;
  report: PostProcessReport;
};

export type TakeoutApi = {
  selectFolder: (
    title?: string,
    defaultPath?: string,
  ) => Promise<string | null>;
  processFolder: (request: ProcessRequest) => Promise<ProcessSummary>;
  abortProcess: () => Promise<boolean>;
  openFolder: (folderPath: string) => Promise<void>;
  saveReport: (
    defaultFileName: string,
    report: ProcessSummary,
  ) => Promise<boolean>;
  onProgress: (listener: (payload: ProgressUpdate) => void) => () => void;
  postProcessFolder: (
    request: PostProcessRequest,
  ) => Promise<PostProcessSummary>;
  onOrganiseProgress: (
    listener: (payload: ProgressUpdate) => void,
  ) => () => void;
};
