import fs from "node:fs/promises";
import path from "node:path";
import { ExifTool } from "exiftool-vendored";

import type {
  FinalizeTempOrganiseResult,
  FileOutcome,
  FileOutcomeTag,
  FolderTreeNode,
  PathValidationError,
  PathValidationResult,
  ProblemFile,
  PostProcessRequest,
  PostProcessSummary,
  ProcessRequest,
  ProcessReport,
  ProcessSummary,
  ProgressUpdate,
  SidecarMatchSummary,
  SidecarMatchStrategy,
  SidecarMetadata,
} from "./types.js";

type MetadataApplyResult = {
  mirroredMetadata: boolean;
};

type SidecarDirectoryEntry = {
  filePath: string;
  fileNameLower: string;
  stemLower: string;
};

type SidecarLookup = {
  byPath: Map<string, string>;
  byDirectory: Map<string, Array<SidecarDirectoryEntry>>;
  titleCache: Map<string, string | null>;
};

type SidecarMatchResult = {
  sidecarPath: string | null;
  strategy: SidecarMatchStrategy;
};

const EXIFTOOL_METADATA_TIMEOUT_MS = 45000;
const EXIFTOOL_MOV_RESTORE_TIMEOUT_MS = 20000;
const MIN_FUZZY_SIDECAR_SCORE = 300;
const MIN_TITLE_SIDECAR_SCORE = 360;
const PROCESS_ABORTED_MESSAGE = "Processing aborted by user.";

type ExifToolClient = InstanceType<typeof ExifTool>;

type ProcessorRuntimeOptions = {
  metadataTimeoutMs: number;
  movRestoreTimeoutMs: number;
};

const mediaExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".heic",
  ".heif",
  ".webp",
  ".mp4",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
  ".3gp",
]);

const ignoredOutputMetadataEntries = new Set([
  ".DS_Store",
  ".directory",
  ".fseventsd",
  ".Spotlight-V100",
  ".TemporaryItems",
  ".Trash",
  ".Trash-1000",
  ".Trashes",
  ".apdisk",
  "$RECYCLE.BIN",
  "desktop.ini",
  "ehthumbs.db",
  "System Volume Information",
  "Thumbs.db",
]);

/**
 * @description Type guard for plain object-like values.
 * @param value Candidate value.
 * @returns True when value is a non-null object.
 */
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

/**
 * @description Checks whether a file path points to a supported media extension.
 * @param filePath File path to inspect.
 * @returns True when extension is supported.
 */
const isMediaFile = (filePath: string): boolean => {
  const extension = path.extname(filePath).toLowerCase();
  return mediaExtensions.has(extension);
};

/**
 * @description Recursively enumerates files under a root directory.
 * @param rootPath Root path to traverse.
 * @returns Flat array of absolute file paths.
 */
const collectFilesRecursively = async (
  rootPath: string,
): Promise<Array<string>> => {
  const files: Array<string> = [];
  const queue: Array<string> = [rootPath];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  return files;
};

/**
 * @description Tests whether a path exists.
 * @param targetPath Path to test.
 * @returns True when path is accessible.
 */
const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const isIgnorableOutputEntry = (entryName: string): boolean => {
  if (ignoredOutputMetadataEntries.has(entryName)) {
    return true;
  }

  return entryName.startsWith("._") || entryName.startsWith(".nfs");
};

/**
 * @description Validates that input and output paths do not overlap or nest within each other.
 * @param inputPath Repair input path.
 * @param outputPath Repair output path.
 * @param checkNonEmpty Whether to check if output folder is non-empty.
 * @returns Validation result with errors if paths are unsafe.
 */
const validateProcessPaths = async (
  inputPath: string,
  outputPath: string,
  checkNonEmpty: boolean = true,
): Promise<PathValidationResult> => {
  const errors: Array<PathValidationError> = [];

  try {
    // Try to resolve to real paths, but if input doesn't exist, skip path comparison checks
    // (the actual directory existence check happens in processTakeoutFolder)
    const inputExists = await fileExists(inputPath);
    const outputExists = await fileExists(outputPath);

    if (!inputExists) {
      // Input doesn't exist - skip overlap checks, let processTakeoutFolder handle this error
      return { valid: true, errors: [] };
    }

    const realInputPath = await fs.realpath(inputPath);
    const realOutputPath = outputExists
      ? await fs.realpath(outputPath)
      : outputPath;

    // Check if paths are identical
    if (realInputPath === realOutputPath) {
      errors.push({
        type: "overlap",
        message: "Input and output folders cannot be the same directory.",
        inputPath: realInputPath,
        outputPath: realOutputPath,
      });
    }

    // Check if output is nested under input
    if (
      realOutputPath.startsWith(realInputPath + path.sep) ||
      realOutputPath === realInputPath
    ) {
      errors.push({
        type: "nested",
        message:
          "Output folder cannot be located inside the input folder. This would cause duplicates and re-processing.",
        inputPath: realInputPath,
        outputPath: realOutputPath,
        overlappingPath: realInputPath,
      });
    }

    // Check if input is nested under output
    if (realInputPath.startsWith(realOutputPath + path.sep)) {
      errors.push({
        type: "nested",
        message:
          "Input folder cannot be located inside the output folder. Please choose separate directory hierarchies.",
        inputPath: realInputPath,
        outputPath: realOutputPath,
        overlappingPath: realOutputPath,
      });
    }

    // Check if output folder exists and is non-empty
    if (checkNonEmpty && outputExists) {
      const entries = await fs.readdir(realOutputPath);
      const meaningfulEntries = entries.filter((entry: string) => {
        return !isIgnorableOutputEntry(entry);
      });
      if (meaningfulEntries.length > 0) {
        errors.push({
          type: "nonEmpty",
          message:
            "Output folder is not empty. Files will receive a unique collision suffix to avoid overwriting existing content.",
          outputPath: realOutputPath,
        });
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown validation error";
    errors.push({
      type: "invalid",
      message: `Path validation failed: ${message}`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * @description Resolves a non-conflicting output path by appending a random suffix when needed.
 * @param initialPath Preferred output path.
 * @returns Available path that does not currently exist.
 */
const resolveCollisionPath = async (initialPath: string): Promise<string> => {
  if (!(await fileExists(initialPath))) {
    return initialPath;
  }

  const parsed = path.parse(initialPath);

  for (;;) {
    const randomPart = Math.floor(Math.random() * 1000000).toString();
    const candidate = path.join(
      parsed.dir,
      `${parsed.name}-${randomPart}${parsed.ext}`,
    );
    if (!(await fileExists(candidate))) {
      return candidate;
    }
  }
};

/**
 * @description Reads and parses a JSON file if present and valid.
 * @param jsonPath JSON file path.
 * @returns Parsed record or null if missing or invalid.
 */
const readJsonIfExists = async (
  jsonPath: string,
): Promise<Record<string, unknown> | null> => {
  try {
    const raw = await fs.readFile(jsonPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

const stripJsonExtension = (fileName: string): string => {
  return fileName.replace(/\.json$/i, "");
};

const stripDuplicateSuffix = (value: string): string => {
  return value.replace(/\(\d+\)$/i, "").trim();
};

const normalizeSidecarStem = (fileName: string): string => {
  return stripDuplicateSuffix(stripJsonExtension(fileName).toLowerCase());
};

const deriveCandidateMediaName = (sidecarStem: string): string => {
  const supplementalMarkerIndex = sidecarStem.indexOf(".supp");
  if (supplementalMarkerIndex > 0) {
    return sidecarStem.slice(0, supplementalMarkerIndex);
  }

  return sidecarStem;
};

const scoreSidecarCandidate = (
  mediaNameLower: string,
  mediaBaseLower: string,
  sidecarEntry: SidecarDirectoryEntry,
): number => {
  const candidateMediaName = deriveCandidateMediaName(sidecarEntry.stemLower);

  if (candidateMediaName === mediaNameLower) {
    return 500;
  }

  if (candidateMediaName === mediaBaseLower) {
    return 450;
  }

  if (sidecarEntry.stemLower === mediaNameLower) {
    return 420;
  }

  if (sidecarEntry.stemLower === mediaBaseLower) {
    return 380;
  }

  if (sidecarEntry.stemLower.includes(mediaNameLower)) {
    return 320;
  }

  if (sidecarEntry.stemLower.includes(mediaBaseLower)) {
    return 260;
  }

  if (mediaNameLower.startsWith(candidateMediaName)) {
    return 230;
  }

  if (mediaBaseLower.startsWith(candidateMediaName)) {
    return 200;
  }

  return 0;
};

const scoreTitleCandidate = (
  mediaNameLower: string,
  mediaBaseLower: string,
  titleLower: string,
): number => {
  if (titleLower === mediaNameLower) {
    return 520;
  }

  if (titleLower === mediaBaseLower) {
    return 470;
  }

  if (titleLower.includes(mediaNameLower)) {
    return 390;
  }

  if (titleLower.includes(mediaBaseLower)) {
    return 360;
  }

  return 0;
};

const readSidecarTitle = async (
  sidecarPath: string,
  titleCache: Map<string, string | null>,
): Promise<string | null> => {
  const cached = titleCache.get(sidecarPath);
  if (cached !== undefined) {
    return cached;
  }

  const data = await readJsonIfExists(sidecarPath);
  if (!data) {
    titleCache.set(sidecarPath, null);
    return null;
  }

  const title =
    typeof data.title === "string" ? data.title.toLowerCase() : null;
  titleCache.set(sidecarPath, title);
  return title;
};

/**
 * @description Attempts to locate a Google Takeout sidecar JSON for a media file.
 * @param mediaPath Media file path.
 * @param sidecarLookup Indexed JSON files and matching caches.
 * @returns Matching sidecar path or null.
 */
const findSidecarPath = async (
  mediaPath: string,
  sidecarLookup: SidecarLookup,
): Promise<SidecarMatchResult> => {
  const dirPath = path.dirname(mediaPath);
  const fileName = path.basename(mediaPath);
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const fileNameLower = fileName.toLowerCase();
  const baseNameLower = baseName.toLowerCase();

  const candidates = [
    `${fileName}.json`,
    `${fileName}.supplemental-metadata.json`,
    `${baseName}.json`,
    `${baseName}.supplemental-metadata.json`,
  ];

  for (const candidate of candidates) {
    const absoluteCandidate = path.join(dirPath, candidate).toLowerCase();
    const resolved = sidecarLookup.byPath.get(absoluteCandidate);
    if (resolved) {
      return {
        sidecarPath: resolved,
        strategy: "exact",
      };
    }
  }

  const jsonFilesInDirectory = sidecarLookup.byDirectory.get(
    dirPath.toLowerCase(),
  );
  if (!jsonFilesInDirectory || jsonFilesInDirectory.length === 0) {
    return {
      sidecarPath: null,
      strategy: "none",
    };
  }

  let bestScore = 0;
  let bestMatch: string | null = null;

  for (const sidecarEntry of jsonFilesInDirectory) {
    const score = scoreSidecarCandidate(
      fileNameLower,
      baseNameLower,
      sidecarEntry,
    );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = sidecarEntry.filePath;
    }
  }

  if (bestMatch && bestScore >= MIN_FUZZY_SIDECAR_SCORE) {
    return {
      sidecarPath: bestMatch,
      strategy: "fuzzy",
    };
  }

  let bestTitleScore = 0;
  let bestTitleMatch: string | null = null;

  for (const sidecarEntry of jsonFilesInDirectory) {
    const title = await readSidecarTitle(
      sidecarEntry.filePath,
      sidecarLookup.titleCache,
    );
    if (!title) {
      continue;
    }

    const score = scoreTitleCandidate(fileNameLower, baseNameLower, title);
    if (score > bestTitleScore) {
      bestTitleScore = score;
      bestTitleMatch = sidecarEntry.filePath;
    }
  }

  if (bestTitleMatch && bestTitleScore >= MIN_TITLE_SIDECAR_SCORE) {
    return {
      sidecarPath: bestTitleMatch,
      strategy: "title",
    };
  }

  return {
    sidecarPath: null,
    strategy: "none",
  };
};

/**
 * @description Finds the sidecar for the base file of an edited or duplicate variant.
 * @param mediaPath Path to the variant media file.
 * @param sidecarLookup Indexed JSON files and matching caches.
 * @returns Sidecar match result using the base file's sidecar, or a "none" result.
 */
const findVariantBaseSidecar = async (
  mediaPath: string,
  sidecarLookup: SidecarLookup,
): Promise<SidecarMatchResult> => {
  const dirPath = path.dirname(mediaPath);
  const fileName = path.basename(mediaPath);
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);

  const editedMatch = baseName.match(/^(.+)-edited(\(\d+\))?$/i);
  const duplicateMatch = baseName.match(/^(.+?)\(\d+\)$/);

  const baseBaseName = editedMatch
    ? (editedMatch[1] as string)
    : duplicateMatch
      ? (duplicateMatch[1] as string).trimEnd()
      : null;

  if (!baseBaseName) {
    return { sidecarPath: null, strategy: "none" };
  }

  const baseFilePath = path.join(dirPath, `${baseBaseName}${extension}`);
  const baseResult = await findSidecarPath(baseFilePath, sidecarLookup);

  if (baseResult.sidecarPath) {
    return { sidecarPath: baseResult.sidecarPath, strategy: "variant" };
  }

  return { sidecarPath: null, strategy: "none" };
};

/**
 * @description Extracts a Unix timestamp from known Google Takeout JSON shapes.
 * @param data Sidecar JSON data.
 * @returns Parsed Date or null when unavailable.
 */
const parseTimestamp = (data: Record<string, unknown>): Date | null => {
  const timestampPaths: Array<Array<string>> = [
    ["photoTakenTime", "timestamp"],
    ["creationTime", "timestamp"],
    ["metadata", "photoTakenTime", "timestamp"],
  ];

  for (const pathParts of timestampPaths) {
    let cursor: unknown = data;
    for (const part of pathParts) {
      if (isRecord(cursor)) {
        cursor = cursor[part];
      } else {
        cursor = null;
      }
    }

    if (typeof cursor === "string") {
      const asInt = Number.parseInt(cursor, 10);
      if (!Number.isNaN(asInt) && asInt > 0) {
        return new Date(asInt * 1000);
      }
    }
  }

  return null;
};

/**
 * @description Extracts a geographic numeric value from sidecar metadata.
 * @param root Sidecar JSON data.
 * @param key Geo key to read.
 * @returns Numeric value or null.
 */
const parseGeoValue = (
  root: Record<string, unknown>,
  key: string,
): number | null => {
  const geoData = root["geoData"];
  if (isRecord(geoData) && typeof geoData[key] === "number") {
    return geoData[key] as number;
  }

  const geoDataExif = root["geoDataExif"];
  if (isRecord(geoDataExif) && typeof geoDataExif[key] === "number") {
    return geoDataExif[key] as number;
  }

  return null;
};

/**
 * @description Parses relevant sidecar metadata values used by the processor.
 * @param sidecarPath Sidecar JSON path.
 * @returns Normalized sidecar metadata or null.
 */
const parseSidecarMetadata = async (
  sidecarPath: string,
  ignoreZeroCoordinates: boolean,
): Promise<SidecarMetadata | null> => {
  const data = await readJsonIfExists(sidecarPath);
  if (!data) {
    return null;
  }

  const title = typeof data.title === "string" ? data.title : null;
  const description =
    typeof data.description === "string" ? data.description : null;
  let latitude = parseGeoValue(data, "latitude");
  let longitude = parseGeoValue(data, "longitude");
  let altitude = parseGeoValue(data, "altitude");

  if (ignoreZeroCoordinates && latitude === 0 && longitude === 0) {
    latitude = null;
    longitude = null;
    altitude = null;
  }

  return {
    title,
    description,
    takenAt: parseTimestamp(data),
    latitude,
    longitude,
    altitude,
  };
};

/**
 * @description Formats a Date for EXIF tag writes.
 * @param value Date to format.
 * @returns EXIF formatted datetime string.
 */
const padDatePart = (value: number): string => {
  return String(value).padStart(2, "0");
};

/**
 * @description Formats a Date for EXIF tag writes using the exact UTC instant from Takeout metadata.
 * @param value Date to format.
 * @returns EXIF formatted datetime string.
 */
const toExifDate = (value: Date): string => {
  return `${value.getUTCFullYear()}:${padDatePart(value.getUTCMonth() + 1)}:${padDatePart(value.getUTCDate())} ${padDatePart(value.getUTCHours())}:${padDatePart(value.getUTCMinutes())}:${padDatePart(value.getUTCSeconds())}`;
};

/**
 * @description Formats a Date for ISO-style metadata namespaces.
 * @param value Date to format.
 * @returns ISO 8601 timestamp string.
 */
const toIsoDate = (value: Date): string => {
  return value.toISOString();
};

/**
 * @description Writes available sidecar metadata into a media file using ExifTool.
 * @param mediaPath Media file path.
 * @param sidecarMetadata Parsed sidecar metadata.
 * @returns Promise that resolves when metadata write completes.
 */
const applyMetadata = async (
  mediaPath: string,
  sidecarMetadata: SidecarMetadata,
  exiftoolClient: ExifToolClient,
): Promise<MetadataApplyResult> => {
  const tags: Record<string, string | number> = {};
  let mirroredMetadata = false;

  if (sidecarMetadata.takenAt) {
    const dateValue = toExifDate(sidecarMetadata.takenAt);
    const isoDateValue = toIsoDate(sidecarMetadata.takenAt);
    tags.DateTimeOriginal = dateValue;
    tags.CreateDate = dateValue;
    tags.ModifyDate = dateValue;
    tags.MediaCreateDate = dateValue;
    tags.TrackCreateDate = dateValue;
    tags.TrackModifyDate = dateValue;
    tags["XMP:DateTimeOriginal"] = isoDateValue;
    tags["XMP:CreateDate"] = isoDateValue;
    tags["XMP:ModifyDate"] = isoDateValue;
    mirroredMetadata = true;
  }

  if (sidecarMetadata.title) {
    tags.Title = sidecarMetadata.title;
    tags["XMP:Title"] = sidecarMetadata.title;
    tags["IPTC:ObjectName"] = sidecarMetadata.title;
    mirroredMetadata = true;
  }

  if (sidecarMetadata.description) {
    tags.ImageDescription = sidecarMetadata.description;
    tags["XMP:Description"] = sidecarMetadata.description;
    tags["IPTC:Caption-Abstract"] = sidecarMetadata.description;
    mirroredMetadata = true;
  }

  if (sidecarMetadata.latitude !== null && sidecarMetadata.longitude !== null) {
    tags.GPSLatitude = Math.abs(sidecarMetadata.latitude);
    tags.GPSLongitude = Math.abs(sidecarMetadata.longitude);
    tags.GPSLatitudeRef = sidecarMetadata.latitude >= 0 ? "N" : "S";
    tags.GPSLongitudeRef = sidecarMetadata.longitude >= 0 ? "E" : "W";
    if (sidecarMetadata.altitude !== null) {
      tags.GPSAltitude = Math.abs(sidecarMetadata.altitude);
      tags.GPSAltitudeRef = sidecarMetadata.altitude >= 0 ? 0 : 1;
    }
  }

  if (Object.keys(tags).length > 0) {
    await exiftoolClient.write(mediaPath, tags, ["-overwrite_original"]);
  }

  return {
    mirroredMetadata,
  };
};

/**
 * @description Synchronizes filesystem timestamps from the trusted Takeout capture time.
 * @param mediaPath Media file path.
 * @param takenAt Sidecar capture timestamp.
 * @returns Promise that resolves when filesystem times are updated.
 */
const syncFilesystemTime = async (
  mediaPath: string,
  takenAt: Date,
): Promise<void> => {
  await fs.utimes(mediaPath, takenAt, takenAt);
};

/**
 * @description Renames a file to .MOV if metadata indicates QuickTime branding.
 * @param mediaPath Media file path.
 * @returns Updated media path, possibly unchanged.
 */
const maybeRestoreMovExtension = async (
  mediaPath: string,
  exiftoolClient: ExifToolClient,
): Promise<string> => {
  const currentExtension = path.extname(mediaPath).toLowerCase();
  if (currentExtension === ".mov") {
    return mediaPath;
  }

  const exifTags = await exiftoolClient.read(mediaPath);
  const majorBrandRaw = (exifTags as Record<string, unknown>).MajorBrand;
  const majorBrand =
    typeof majorBrandRaw === "string" ? majorBrandRaw.toLowerCase() : "";

  const shouldRestoreMov =
    majorBrand.includes("quicktime") || majorBrand === "qt  ";
  if (!shouldRestoreMov) {
    return mediaPath;
  }

  const parsed = path.parse(mediaPath);
  const targetPath = await resolveCollisionPath(
    path.join(parsed.dir, `${parsed.name}.MOV`),
  );
  await fs.rename(mediaPath, targetPath);
  return targetPath;
};

/**
 * @description Resolves the best available date for folder organization.
 * @param mediaPath Media path.
 * @param sidecarMetadata Optional sidecar metadata.
 * @returns Date from sidecar or filesystem timestamps.
 */
const resolveFileDate = async (
  mediaPath: string,
  sidecarMetadata: SidecarMetadata | null,
): Promise<Date> => {
  if (sidecarMetadata?.takenAt) {
    return sidecarMetadata.takenAt;
  }

  const stats = await fs.stat(mediaPath);
  return stats.mtime;
};

/**
 * @description Resolves destination year/month directory beneath the selected output root.
 * @param outputPath User-selected output folder.
 * @param mediaPath Media file path.
 * @param sidecarMetadata Optional sidecar metadata.
 * @returns Absolute target directory path.
 */
const resolveYearMonthTargetDir = async (
  outputPath: string,
  mediaPath: string,
  sidecarMetadata: SidecarMetadata | null,
): Promise<string> => {
  const date = await resolveFileDate(mediaPath, sidecarMetadata);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");

  const targetDir = path.join(outputPath, year, month);
  await fs.mkdir(targetDir, { recursive: true });

  return targetDir;
};

/**
 * @description Resolves destination year-only directory beneath the selected output root.
 * @param outputPath User-selected output folder.
 * @param mediaPath Media file path.
 * @param sidecarMetadata Optional sidecar metadata.
 * @returns Absolute target directory path.
 */
const resolveYearTargetDir = async (
  outputPath: string,
  mediaPath: string,
  sidecarMetadata: SidecarMetadata | null,
): Promise<string> => {
  const date = await resolveFileDate(mediaPath, sidecarMetadata);
  const year = String(date.getFullYear());

  const targetDir = path.join(outputPath, year);
  await fs.mkdir(targetDir, { recursive: true });

  return targetDir;
};

/**
 * @description Builds sidecar lookup structures for exact path, directory-level matching, and cached title checks.
 * @param allFiles All discovered files.
 * @returns Lookup data for sidecar resolution.
 */
const buildSidecarLookup = (allFiles: Array<string>): SidecarLookup => {
  const byPath = new Map<string, string>();
  const byDirectory = new Map<string, Array<SidecarDirectoryEntry>>();
  const titleCache = new Map<string, string | null>();

  for (const currentFile of allFiles) {
    if (path.extname(currentFile).toLowerCase() === ".json") {
      const lowerPath = currentFile.toLowerCase();
      byPath.set(lowerPath, currentFile);

      const directoryLower = path.dirname(currentFile).toLowerCase();
      const currentDirEntries = byDirectory.get(directoryLower) ?? [];
      currentDirEntries.push({
        filePath: currentFile,
        fileNameLower: path.basename(currentFile).toLowerCase(),
        stemLower: normalizeSidecarStem(path.basename(currentFile)),
      });
      byDirectory.set(directoryLower, currentDirEntries);
    }
  }

  return {
    byPath,
    byDirectory,
    titleCache,
  };
};

/**
 * @description Normalizes unknown errors to user-safe log strings.
 * @param error Unknown thrown value.
 * @returns Human-readable message.
 */
const normalizeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
};

/**
 * @description Applies a timeout boundary to an async operation so processing can continue if a subprocess stalls.
 * @param operationName Human-readable operation label for error messages.
 * @param timeoutMs Timeout duration in milliseconds.
 * @param task Async task to execute.
 * @returns Task result when completed before timeout.
 */
const withTimeout = async <T>(
  operationName: string,
  timeoutMs: number,
  task: () => Promise<T>,
  onTimeout?: () => Promise<void>,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await new Promise<T>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        void (async () => {
          if (onTimeout) {
            await onTimeout();
          }
        })()
          .catch(() => {
            return;
          })
          .finally(() => {
            reject(
              new Error(`${operationName} timed out after ${timeoutMs}ms`),
            );
          });
      }, timeoutMs);

      void task().then(resolve).catch(reject);
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const throwIfAborted = (abortSignal?: AbortSignal): void => {
  if (abortSignal?.aborted) {
    throw new Error(PROCESS_ABORTED_MESSAGE);
  }
};

/**
 * @description Determines whether parsed sidecar metadata contains useful fields to merge.
 * @param sidecarMetadata Parsed sidecar metadata.
 * @returns True when at least one meaningful metadata field exists.
 */
const hasUsefulMetadata = (
  sidecarMetadata: SidecarMetadata | null,
): boolean => {
  if (!sidecarMetadata) {
    return false;
  }

  return Boolean(
    sidecarMetadata.takenAt ||
    sidecarMetadata.title ||
    sidecarMetadata.description ||
    sidecarMetadata.latitude !== null ||
    sidecarMetadata.longitude !== null ||
    sidecarMetadata.altitude !== null,
  );
};

/**
 * @description Builds a recursive folder tree preview for the output directory.
 * @param rootPath Output directory path.
 * @returns Folder tree nodes for display in the report dialog.
 */
const buildFolderTree = async (
  rootPath: string,
): Promise<Array<FolderTreeNode>> => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const sortedEntries = [...entries].sort((left, right) => {
    if (left.isDirectory() && !right.isDirectory()) {
      return -1;
    }

    if (!left.isDirectory() && right.isDirectory()) {
      return 1;
    }

    return left.name.localeCompare(right.name);
  });

  const tree = await Promise.all(
    sortedEntries.map(async (entry) => {
      const fullPath = path.join(rootPath, entry.name);
      const children = entry.isDirectory()
        ? await buildFolderTree(fullPath)
        : [];

      return {
        name: entry.name,
        path: fullPath,
        kind: entry.isDirectory() ? "directory" : "file",
        children,
      } satisfies FolderTreeNode;
    }),
  );

  return tree;
};

/**
 * @description Creates the structured process report returned to the renderer.
 * @param processedCount Number of processed files.
 * @param metadataMergedFiles Files that received metadata writes.
 * @param skippedMetadataFiles Files skipped due to missing or unusable metadata.
 * @param problemFiles Files that raised processing errors.
 * @param outputPath Output directory used for the run.
 * @returns Completed process report.
 */
const createProcessReport = async (
  processedCount: number,
  outputPath: string,
  metadataMergedFiles: Array<string>,
  metadataMirroredFiles: Array<string>,
  syncedFileTimeFiles: Array<string>,
  restoredMovFiles: Array<string>,
  skippedMetadataFiles: Array<string>,
  problemFiles: Array<ProblemFile>,
  fileOutcomes: Array<FileOutcome>,
  sidecarMatchSummary: SidecarMatchSummary,
): Promise<ProcessReport> => {
  const folderTree = await buildFolderTree(outputPath);

  return {
    processedCount,
    outputPath,
    metadataMergedFiles,
    metadataMirroredFiles,
    syncedFileTimeFiles,
    restoredMovFiles,
    skippedMetadataFiles,
    problemFiles,
    fileOutcomes,
    sidecarMatchSummary,
    folderTree,
  };
};

/**
 * @description Processes an entire Google Takeout folder using the enabled options.
 * @param request Processing request payload.
 * @param onProgress Progress callback for UI updates.
 * @returns Processing summary with counts, warnings, and duration.
 */
export const processTakeoutFolder = async (
  request: ProcessRequest,
  onProgress: (update: ProgressUpdate) => void,
  abortSignal?: AbortSignal,
  runtimeOptions?: Partial<ProcessorRuntimeOptions>,
): Promise<ProcessSummary> => {
  const startedAt = Date.now();
  const inputPath = request.inputPath;
  const outputPath = request.outputPath;
  const metadataTimeoutMs =
    runtimeOptions?.metadataTimeoutMs ?? EXIFTOOL_METADATA_TIMEOUT_MS;
  const movRestoreTimeoutMs =
    runtimeOptions?.movRestoreTimeoutMs ?? EXIFTOOL_MOV_RESTORE_TIMEOUT_MS;
  let exiftoolClient = new ExifTool({
    taskTimeoutMillis: metadataTimeoutMs,
  });

  const restartExifToolClient = async (): Promise<void> => {
    try {
      await exiftoolClient.end(false);
    } catch {
      // Ignore cleanup failures and continue with a fresh worker.
    }

    exiftoolClient = new ExifTool({
      taskTimeoutMillis: metadataTimeoutMs,
    });
  };

  throwIfAborted(abortSignal);

  // Validate path safety before proceeding
  const pathValidation = await validateProcessPaths(inputPath, outputPath);
  if (!pathValidation.valid) {
    const criticalErrors = pathValidation.errors.filter(
      (e) => e.type !== "nonEmpty",
    );
    if (criticalErrors.length > 0) {
      throw new Error(criticalErrors.map((e) => e.message).join(" "));
    }
    // Non-empty warning is logged but doesn't fail
    for (const error of pathValidation.errors) {
      if (error.type === "nonEmpty") {
        // This will be shown as warning in renderer
      }
    }
  }

  const inputStats = await fs.stat(inputPath).catch(() => null);

  if (!inputStats || !inputStats.isDirectory()) {
    throw new Error(
      "Incorrect input folder selected. Please choose a valid source directory.",
    );
  }

  const outputStats = await fs.stat(outputPath).catch(() => null);
  if (outputStats && !outputStats.isDirectory()) {
    throw new Error(
      "Incorrect output folder selected. Please choose a valid destination directory.",
    );
  }

  if (!outputStats) {
    await fs.mkdir(outputPath, { recursive: true });
  }

  const allFiles = await collectFilesRecursively(inputPath);
  const mediaFiles = allFiles.filter((currentFile) => isMediaFile(currentFile));

  if (mediaFiles.length === 0) {
    throw new Error(
      "Incorrect input folder selected. No media files were found.",
    );
  }

  const sidecarLookup = buildSidecarLookup(allFiles);
  const warnings: Array<string> = [];
  const metadataMergedFiles: Array<string> = [];
  const metadataMirroredFiles: Array<string> = [];
  const syncedFileTimeFiles: Array<string> = [];
  const restoredMovFiles: Array<string> = [];
  const skippedMetadataFiles: Array<string> = [];
  const problemFiles: Array<ProblemFile> = [];
  const fileOutcomes: Array<FileOutcome> = [];
  const sidecarMatchSummary: SidecarMatchSummary = {
    exact: 0,
    fuzzy: 0,
    title: 0,
    variant: 0,
    none: 0,
  };

  let processed = 0;

  try {
    for (const mediaFile of mediaFiles) {
      throwIfAborted(abortSignal);
      let sidecarMatchResult = await findSidecarPath(mediaFile, sidecarLookup);

      if (
        sidecarMatchResult.strategy === "none" &&
        request.options.matchVariantSidecars
      ) {
        const variantResult = await findVariantBaseSidecar(
          mediaFile,
          sidecarLookup,
        );
        if (variantResult.sidecarPath) {
          sidecarMatchResult = variantResult;
        }
      }

      const sidecarPath = sidecarMatchResult.sidecarPath;
      sidecarMatchSummary[sidecarMatchResult.strategy] += 1;
      let sidecarMetadata: SidecarMetadata | null = null;

      if (sidecarPath) {
        sidecarMetadata = await parseSidecarMetadata(
          sidecarPath,
          request.options.ignoreZeroCoordinates,
        );
      }

      const relativePath = path.relative(inputPath, mediaFile);
      const relativeDir = path.dirname(relativePath);

      const baseOutputDir = request.options.createYearMonthSubfolders
        ? await resolveYearMonthTargetDir(
            outputPath,
            mediaFile,
            sidecarMetadata,
          )
        : request.options.createYearSubfoldersOnly
          ? await resolveYearTargetDir(outputPath, mediaFile, sidecarMetadata)
          : path.join(outputPath, relativeDir === "." ? "" : relativeDir);

      await fs.mkdir(baseOutputDir, { recursive: true });

      const initialOutputPath = path.join(
        baseOutputDir,
        path.basename(mediaFile),
      );
      let currentMediaPath = await resolveCollisionPath(initialOutputPath);
      const outcomeTags: Array<FileOutcomeTag> = [];
      let outcomeMessage: string | null = null;
      let metadataMerged = false;
      let metadataMirrored = false;
      let syncedFileTime = false;
      let restoredMov = false;

      try {
        throwIfAborted(abortSignal);
        await fs.copyFile(mediaFile, currentMediaPath);

        if (request.options.writeMetadata) {
          if (sidecarMetadata && hasUsefulMetadata(sidecarMetadata)) {
            try {
              const metadataResult = await withTimeout(
                "Metadata merge",
                metadataTimeoutMs,
                async () => {
                  return applyMetadata(
                    currentMediaPath,
                    sidecarMetadata,
                    exiftoolClient,
                  );
                },
                restartExifToolClient,
              );
              metadataMerged = true;
              metadataMirrored = metadataResult.mirroredMetadata;
            } catch (metadataError: unknown) {
              const metadataMessage = `Metadata merge failed for ${path.basename(currentMediaPath)}: ${normalizeError(metadataError)}. File was copied without metadata changes.`;
              warnings.push(metadataMessage);
              outcomeTags.push("warning");
              outcomeMessage = metadataMessage;
              problemFiles.push({
                filePath: currentMediaPath,
                message: metadataMessage,
              });
            }

            if (sidecarMetadata.takenAt) {
              try {
                await syncFilesystemTime(
                  currentMediaPath,
                  sidecarMetadata.takenAt,
                );
                syncedFileTime = true;
              } catch (filesystemTimeError: unknown) {
                const filesystemTimeMessage = `Filesystem time sync failed for ${path.basename(currentMediaPath)}: ${normalizeError(filesystemTimeError)}. Original filesystem times were preserved.`;
                warnings.push(filesystemTimeMessage);
                outcomeTags.push("warning");
                outcomeMessage = outcomeMessage ?? filesystemTimeMessage;
                problemFiles.push({
                  filePath: currentMediaPath,
                  message: filesystemTimeMessage,
                });
              }
            }
          } else {
            const message = `No useful metadata found for ${path.basename(currentMediaPath)}`;
            warnings.push(message);
            skippedMetadataFiles.push(currentMediaPath);
            outcomeTags.push("metadata skipped");
            outcomeMessage = message;
          }
        }

        if (request.options.writeMetadata) {
          try {
            const updatedMediaPath = await withTimeout(
              "MOV extension restore",
              movRestoreTimeoutMs,
              async () => {
                return maybeRestoreMovExtension(
                  currentMediaPath,
                  exiftoolClient,
                );
              },
              restartExifToolClient,
            );
            if (updatedMediaPath !== currentMediaPath) {
              restoredMov = true;
            }
            currentMediaPath = updatedMediaPath;
          } catch (restoreError: unknown) {
            const restoreMessage = `MOV extension restore failed for ${path.basename(currentMediaPath)}: ${normalizeError(restoreError)}. File was copied with original extension.`;
            warnings.push(restoreMessage);
            outcomeTags.push("warning");
            outcomeMessage = outcomeMessage ?? restoreMessage;
            problemFiles.push({
              filePath: currentMediaPath,
              message: restoreMessage,
            });
          }
        }

        throwIfAborted(abortSignal);

        if (metadataMerged) {
          metadataMergedFiles.push(currentMediaPath);
          outcomeTags.push("metadata merged");
        }

        if (metadataMirrored) {
          metadataMirroredFiles.push(currentMediaPath);
          outcomeTags.push("mirrored metadata");
        }

        if (syncedFileTime) {
          syncedFileTimeFiles.push(currentMediaPath);
          outcomeTags.push("synced file time");
        }

        if (restoredMov) {
          restoredMovFiles.push(currentMediaPath);
          outcomeTags.push("restored MOV");
        }

        if (outcomeTags.length === 0) {
          outcomeTags.push("copied only");
        }

        fileOutcomes.push({
          filePath: currentMediaPath,
          tags: outcomeTags,
          message: outcomeMessage,
          sidecarMatchStrategy: sidecarMatchResult.strategy,
        });

        processed += 1;
        onProgress({
          processed,
          total: mediaFiles.length,
          currentFile: currentMediaPath,
          level: "info",
          message: `Processed ${path.basename(currentMediaPath)}`,
        });
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.message === PROCESS_ABORTED_MESSAGE
        ) {
          throw error;
        }

        const message = `Failed processing ${path.basename(currentMediaPath)}: ${normalizeError(error)}`;
        warnings.push(message);
        outcomeTags.push("warning");
        outcomeMessage = message;
        fileOutcomes.push({
          filePath: currentMediaPath,
          tags: outcomeTags.length > 0 ? outcomeTags : ["warning"],
          message: outcomeMessage,
          sidecarMatchStrategy: sidecarMatchResult.strategy,
        });
        problemFiles.push({
          filePath: currentMediaPath,
          message,
        });
        processed += 1;
        onProgress({
          processed,
          total: mediaFiles.length,
          currentFile: currentMediaPath,
          level: "warn",
          message,
        });
      }
    }

    throwIfAborted(abortSignal);

    const jsonFiles = Array.from(sidecarLookup.byPath.values());
    const jsonRemoved = jsonFiles.length;
    const report = await createProcessReport(
      processed,
      outputPath,
      metadataMergedFiles,
      metadataMirroredFiles,
      syncedFileTimeFiles,
      restoredMovFiles,
      skippedMetadataFiles,
      problemFiles,
      fileOutcomes,
      sidecarMatchSummary,
    );

    return {
      processed,
      total: mediaFiles.length,
      jsonRemoved,
      warnings,
      durationMs: Date.now() - startedAt,
      report,
    };
  } finally {
    await exiftoolClient.end(false).catch(() => {
      return;
    });
  }
};

export { PROCESS_ABORTED_MESSAGE, validateProcessPaths };

/**
 * @description Returns true when a folder name looks like a 4-digit year.
 * @param name Directory name to test.
 * @returns True for year folders.
 */
const isYearFolder = (name: string): boolean => {
  return /^\d{4}$/.test(name);
};

/**
 * @description Returns true when a folder name looks like a 2-digit month.
 * @param name Directory name to test.
 * @returns True for month folders.
 */
const isMonthFolder = (name: string): boolean => {
  return /^\d{2}$/.test(name);
};

/**
 * @description Recursively removes all empty directories under a root path.
 * @param dirPath Root directory to clean.
 * @returns Count of removed directories.
 */
const removeEmptyDirsRecursively = async (dirPath: string): Promise<number> => {
  let removed = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const subPath = path.join(dirPath, entry.name);
    removed += await removeEmptyDirsRecursively(subPath);

    const remaining = await fs.readdir(subPath);
    if (remaining.length === 0) {
      await fs.rmdir(subPath);
      removed += 1;
    }
  }

  return removed;
};

/**
 * @description Creates a temporary folder with a unique name within a parent directory.
 * @param parentPath Parent directory where temp folder will be created.
 * @returns Path to newly created temporary folder.
 */
const createTempFolder = async (parentPath: string): Promise<string> => {
  const tempFolderName = `-temp-${Math.random().toString(36).substring(2, 8)}`;
  const tempPath = path.join(parentPath, tempFolderName);
  await fs.mkdir(tempPath, { recursive: true });
  return tempPath;
};

const isPathInside = (childPath: string, parentPath: string): boolean => {
  return childPath.startsWith(parentPath + path.sep);
};

const copyDirectoryEntry = async (
  sourcePath: string,
  destinationPath: string,
): Promise<void> => {
  const sourceStats = await fs.stat(sourcePath);
  if (sourceStats.isDirectory()) {
    await fs.cp(sourcePath, destinationPath, { recursive: true });
    return;
  }

  await fs.copyFile(sourcePath, destinationPath);
};

export const finalizeTempOrganise = async (
  targetPath: string,
  tempFolderPath: string,
): Promise<FinalizeTempOrganiseResult> => {
  const realTargetPath = await fs.realpath(targetPath).catch(() => null);
  const realTempPath = await fs.realpath(tempFolderPath).catch(() => null);

  if (!realTargetPath) {
    throw new Error("Target folder no longer exists.");
  }

  if (!realTempPath) {
    throw new Error("Temporary review folder no longer exists.");
  }

  if (!isPathInside(realTempPath, realTargetPath)) {
    throw new Error(
      "Temporary review folder is invalid. It must be inside the selected folder.",
    );
  }

  const backupPath = await resolveCollisionPath(
    path.join(
      path.dirname(realTargetPath),
      `${path.basename(realTargetPath)}-backup`,
    ),
  );

  const tempFolderName = path.basename(realTempPath);

  try {
    await fs.mkdir(backupPath, { recursive: true });

    const originalEntries = await fs.readdir(realTargetPath, {
      withFileTypes: true,
    });

    for (const entry of originalEntries) {
      if (entry.name === tempFolderName) {
        continue;
      }

      const sourcePath = path.join(realTargetPath, entry.name);
      const backupEntryPath = path.join(backupPath, entry.name);
      await copyDirectoryEntry(sourcePath, backupEntryPath);
    }

    for (const entry of originalEntries) {
      if (entry.name === tempFolderName) {
        continue;
      }

      await fs.rm(path.join(realTargetPath, entry.name), {
        recursive: true,
        force: true,
      });
    }

    const reviewedEntries = await fs.readdir(realTempPath, {
      withFileTypes: true,
    });
    for (const entry of reviewedEntries) {
      const sourcePath = path.join(realTempPath, entry.name);
      const destinationPath = path.join(realTargetPath, entry.name);
      await fs.rename(sourcePath, destinationPath);
    }

    await fs.rm(realTempPath, { recursive: true, force: true });
    await fs.rm(backupPath, { recursive: true, force: true });

    return {
      applied: true,
      targetPath: realTargetPath,
    };
  } catch (error: unknown) {
    try {
      const currentEntries = await fs.readdir(realTargetPath, {
        withFileTypes: true,
      });
      for (const entry of currentEntries) {
        if (entry.name === tempFolderName) {
          continue;
        }

        await fs.rm(path.join(realTargetPath, entry.name), {
          recursive: true,
          force: true,
        });
      }

      const backupEntries = await fs.readdir(backupPath, {
        withFileTypes: true,
      });
      for (const entry of backupEntries) {
        const sourcePath = path.join(backupPath, entry.name);
        const destinationPath = path.join(realTargetPath, entry.name);
        await fs.rename(sourcePath, destinationPath);
      }

      await fs.rm(backupPath, { recursive: true, force: true });
    } catch {
      // Best-effort rollback only.
    }

    throw new Error(
      `Failed to apply reviewed organisation result: ${normalizeError(error)}`,
      { cause: error },
    );
  }
};

/**
 * @description Core organisation logic that operates on a target path.
 * @param targetPath Path to reorganise.
 * @param options Organisation options.
 * @param onProgress Progress callback.
 * @returns Object with counts and warnings.
 */
const performOrganisation = async (
  targetPath: string,
  options: {
    flattenMonthsToYears: boolean;
    flattenYearsToRoot: boolean;
    removeEmptyFolders: boolean;
  },
  onProgress: (update: ProgressUpdate) => void,
): Promise<{
  movedFilesCount: number;
  removedFoldersCount: number;
  warnings: Array<string>;
  problemFiles: Array<ProblemFile>;
}> => {
  const warnings: Array<string> = [];
  const problemFiles: Array<ProblemFile> = [];
  let movedFilesCount = 0;
  let removedFoldersCount = 0;

  const { flattenMonthsToYears, flattenYearsToRoot, removeEmptyFolders } =
    options;

  // Count expected moves for accurate progress reporting.
  let totalMoves = 0;

  if (flattenMonthsToYears) {
    const rootEntries = await fs.readdir(targetPath, {
      withFileTypes: true,
    });
    for (const yearEntry of rootEntries) {
      if (!yearEntry.isDirectory() || !isYearFolder(yearEntry.name)) {
        continue;
      }
      const yearPath = path.join(targetPath, yearEntry.name);
      const monthEntries = await fs.readdir(yearPath, { withFileTypes: true });
      for (const monthEntry of monthEntries) {
        if (!monthEntry.isDirectory() || !isMonthFolder(monthEntry.name)) {
          continue;
        }
        const monthPath = path.join(yearPath, monthEntry.name);
        const monthFiles = await collectFilesRecursively(monthPath);
        totalMoves += monthFiles.length;
      }
    }
  }

  if (flattenYearsToRoot) {
    const rootEntries = await fs.readdir(targetPath, {
      withFileTypes: true,
    });
    for (const yearEntry of rootEntries) {
      if (!yearEntry.isDirectory() || !isYearFolder(yearEntry.name)) {
        continue;
      }
      const yearPath = path.join(targetPath, yearEntry.name);
      const yearFiles = await collectFilesRecursively(yearPath);
      totalMoves += yearFiles.length;
    }
  }

  let processed = 0;
  onProgress({
    processed: 0,
    total: totalMoves,
    currentFile: null,
    level: "info",
    message: "Starting organisation…",
  });

  const moveFile = async (srcPath: string, destDir: string): Promise<void> => {
    const destPath = await resolveCollisionPath(
      path.join(destDir, path.basename(srcPath)),
    );
    await fs.rename(srcPath, destPath);
    movedFilesCount += 1;
  };

  // Step 1 – flatten months into their parent year folder.
  if (flattenMonthsToYears) {
    const rootEntries = await fs.readdir(targetPath, {
      withFileTypes: true,
    });
    for (const yearEntry of rootEntries) {
      if (!yearEntry.isDirectory() || !isYearFolder(yearEntry.name)) {
        continue;
      }
      const yearPath = path.join(targetPath, yearEntry.name);
      const monthEntries = await fs.readdir(yearPath, { withFileTypes: true });
      for (const monthEntry of monthEntries) {
        if (!monthEntry.isDirectory() || !isMonthFolder(monthEntry.name)) {
          continue;
        }
        const monthPath = path.join(yearPath, monthEntry.name);
        const monthFiles = await collectFilesRecursively(monthPath);
        for (const filePath of monthFiles) {
          const fileName = path.basename(filePath);
          onProgress({
            processed,
            total: totalMoves,
            currentFile: fileName,
            level: "info",
            message: `Moving ${fileName} → ${yearEntry.name}/`,
          });
          try {
            await moveFile(filePath, yearPath);
            processed += 1;
          } catch (moveError: unknown) {
            const message = `Failed to move ${fileName}: ${normalizeError(moveError)}`;
            warnings.push(message);
            problemFiles.push({ filePath, message });
            processed += 1;
          }
        }

        // Remove the month directory if now empty.
        try {
          const remaining = await fs.readdir(monthPath);
          if (remaining.length === 0) {
            await fs.rmdir(monthPath);
            removedFoldersCount += 1;
          }
        } catch {
          // Not fatal – the folder may have non-empty sub-items.
        }
      }
    }
  }

  // Step 2 – flatten year folders into the target root.
  if (flattenYearsToRoot) {
    const rootEntries = await fs.readdir(targetPath, {
      withFileTypes: true,
    });
    for (const yearEntry of rootEntries) {
      if (!yearEntry.isDirectory() || !isYearFolder(yearEntry.name)) {
        continue;
      }
      const yearPath = path.join(targetPath, yearEntry.name);
      const yearFiles = await collectFilesRecursively(yearPath);
      for (const filePath of yearFiles) {
        const fileName = path.basename(filePath);
        onProgress({
          processed,
          total: totalMoves,
          currentFile: fileName,
          level: "info",
          message: `Moving ${fileName} → root`,
        });
        try {
          await moveFile(filePath, targetPath);
          processed += 1;
        } catch (moveError: unknown) {
          const message = `Failed to move ${fileName}: ${normalizeError(moveError)}`;
          warnings.push(message);
          problemFiles.push({ filePath, message });
          processed += 1;
        }
      }

      // Remove the year directory tree if now empty.
      try {
        const remaining = await collectFilesRecursively(yearPath);
        if (remaining.length === 0) {
          await fs.rm(yearPath, { recursive: true });
          removedFoldersCount += 1;
        }
      } catch {
        // Not fatal.
      }
    }
  }

  // Step 3 – sweep for any remaining empty directories.
  if (removeEmptyFolders) {
    removedFoldersCount += await removeEmptyDirsRecursively(targetPath);
  }

  onProgress({
    processed: totalMoves,
    total: totalMoves,
    currentFile: null,
    level: "info",
    message: "Organisation complete",
  });

  return {
    movedFilesCount,
    removedFoldersCount,
    warnings,
    problemFiles,
  };
};

/**
 * @description Reorganises a previously-output folder by flattening YYYY/MM or YYYY structures.
 * @param request Post-process request payload.
 * @param onProgress Progress callback for UI updates.
 * @returns Post-process summary with counts, warnings, and duration.
 */
export const postProcessFolder = async (
  request: PostProcessRequest,
  onProgress: (update: ProgressUpdate) => void,
): Promise<PostProcessSummary> => {
  const startedAt = Date.now();

  const targetStats = await fs.stat(request.targetPath).catch(() => null);
  if (!targetStats || !targetStats.isDirectory()) {
    throw new Error(
      "Incorrect folder selected. Please choose a valid directory.",
    );
  }

  const useTemp = request.options.createTempFolderForReview ?? false;
  const workPath = useTemp
    ? await createTempFolder(request.targetPath)
    : request.targetPath;
  const workFolderName = path.basename(workPath);

  try {
    // Copy contents to temp folder if using temp mode
    if (useTemp && workPath !== request.targetPath) {
      // Copy structure and files to temp folder
      const entries = await fs.readdir(request.targetPath, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (entry.name === workFolderName) {
          continue;
        }

        const source = path.join(request.targetPath, entry.name);
        const destination = path.join(workPath, entry.name);
        if (entry.isDirectory()) {
          await fs.cp(source, destination, { recursive: true });
        } else {
          await fs.copyFile(source, destination);
        }
      }
    }

    const result = await performOrganisation(
      workPath,
      request.options,
      onProgress,
    );

    return {
      warnings: result.warnings,
      durationMs: Date.now() - startedAt,
      report: {
        targetPath: request.targetPath,
        movedFilesCount: result.movedFilesCount,
        removedFoldersCount: result.removedFoldersCount,
        problemFiles: result.problemFiles,
        ...(useTemp ? { tempFolderPath: workPath } : {}),
      },
    };
  } catch (error: unknown) {
    // Clean up temp folder if operation fails
    if (useTemp && workPath !== request.targetPath) {
      try {
        await fs.rm(workPath, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
};
