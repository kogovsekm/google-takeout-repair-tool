export type ProcessOptions = {
  writeMetadata: boolean;
  createYearMonthSubfolders: boolean;
  createYearSubfoldersOnly: boolean;
  ignoreZeroCoordinates: boolean;
  matchVariantSidecars: boolean;
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

export type SidecarMatchStrategy = "exact" | "fuzzy" | "title" | "variant" | "none";

export type SidecarMatchSummary = {
  exact: number;
  fuzzy: number;
  title: number;
  variant: number;
  none: number;
};

export type FileOutcome = {
  filePath: string;
  tags: Array<FileOutcomeTag>;
  message: string | null;
  sidecarMatchStrategy?: SidecarMatchStrategy;
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
  sidecarMatchSummary: SidecarMatchSummary;
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

export type PathValidationError = {
  type: "overlap" | "nested" | "nonEmpty" | "invalid";
  message: string;
  inputPath?: string;
  outputPath?: string;
  overlappingPath?: string;
};

export type HalvesSplitReport = {
  h1FileCount: number;
  h2FileCount: number;
  h1SizeBytes: number;
  h2SizeBytes: number;
};

export type PostProcessOptions = {
  flattenMonthsToYears: boolean;
  flattenAllToRoot: boolean;
  removeEmptyFolders: boolean;
  createTempFolderForReview?: boolean;
  flattenIntoHalves?: boolean;
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
  tempFolderPath?: string;
  halvesReport?: HalvesSplitReport;
};

export type PostProcessSummary = {
  warnings: Array<string>;
  durationMs: number;
  report: PostProcessReport;
};

export type FinalizeTempOrganiseRequest = {
  targetPath: string;
  tempFolderPath: string;
};

export type FinalizeTempOrganiseResult = {
  applied: boolean;
  targetPath: string;
};

export type SidecarMetadata = {
  title: string | null;
  description: string | null;
  takenAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
};

export type PathValidationResult = {
  valid: boolean;
  errors: Array<PathValidationError>;
};
