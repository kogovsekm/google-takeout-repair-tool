// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockExifToolInstance = {
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

const mockExifToolInstances: Array<MockExifToolInstance> = [];
let mockWriteMode: "normal" | "hang-first" = "normal";
let mockWriteCallCount = 0;

vi.mock("exiftool-vendored", () => {
  class MockExifTool {
    read = vi.fn(async () => ({ MajorBrand: "" }));

    write = vi.fn(async () => {
      const currentCall = mockWriteCallCount;
      mockWriteCallCount += 1;

      if (mockWriteMode === "hang-first" && currentCall === 0) {
        await new Promise(() => {
          return;
        });
      }

      return;
    });

    end = vi.fn(async () => {
      return;
    });

    constructor() {
      mockExifToolInstances.push(this);
    }
  }

  return {
    ExifTool: MockExifTool,
  };
});

const {
  processTakeoutFolder,
  PROCESS_ABORTED_MESSAGE,
  finalizeTempOrganise,
  postProcessFolder,
} = await import("./processor.js");

const createTempDir = async (name: string): Promise<string> => {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
};

const writeJson = async (
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> => {
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
};

const createMediaFixture = async (
  rootDir: string,
  baseName: string,
): Promise<void> => {
  const mediaPath = path.join(rootDir, `${baseName}.jpg`);
  const sidecarPath = path.join(rootDir, `${baseName}.jpg.json`);

  await fs.writeFile(mediaPath, "fake-media", "utf8");
  await writeJson(sidecarPath, {
    photoTakenTime: {
      timestamp: "1700000000",
    },
    title: `${baseName} title`,
  });
};

afterEach(() => {
  mockExifToolInstances.length = 0;
  mockWriteMode = "normal";
  mockWriteCallCount = 0;
  vi.clearAllMocks();
});

describe("processTakeoutFolder", () => {
  it("throws a friendly error for an invalid directory", async () => {
    const action = processTakeoutFolder(
      {
        inputPath: "/this/path/does/not/exist",
        outputPath: "/tmp",
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: true,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    await expect(action).rejects.toThrow(
      "Incorrect input folder selected. Please choose a valid source directory.",
    );
  });

  it("does not warn for output folders that only contain OS metadata files", async () => {
    const inputPath = await createTempDir("takeout-input-ds-store-only");
    const outputPath = await createTempDir("takeout-output-ds-store-only");

    await createMediaFixture(inputPath, "photo");
    await fs.writeFile(path.join(outputPath, ".DS_Store"), "finder", "utf8");

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: false,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    expect(
      summary.warnings.some((warning) => {
        return warning.includes("Output folder is not empty");
      }),
    ).toBe(false);
  });

  it("does not warn for output folders that only contain Windows or Linux metadata", async () => {
    const inputPath = await createTempDir("takeout-input-os-metadata-only");
    const outputPath = await createTempDir("takeout-output-os-metadata-only");

    await createMediaFixture(inputPath, "photo");
    await fs.writeFile(path.join(outputPath, "desktop.ini"), "shell", "utf8");
    await fs.writeFile(path.join(outputPath, "Thumbs.db"), "thumbs", "utf8");
    await fs.writeFile(path.join(outputPath, ".directory"), "kde", "utf8");
    await fs.writeFile(path.join(outputPath, ".nfs0001"), "nfs", "utf8");

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: false,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    expect(
      summary.warnings.some((warning) => {
        return warning.includes("Output folder is not empty");
      }),
    ).toBe(false);
  });

  it("recovers from metadata timeout by restarting ExifTool and continues", async () => {
    mockWriteMode = "hang-first";

    const inputPath = await createTempDir("takeout-input-timeout");
    const outputPath = await createTempDir("takeout-output-timeout");
    await createMediaFixture(inputPath, "a");
    await createMediaFixture(inputPath, "b");

    const action = processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
      undefined,
      {
        metadataTimeoutMs: 30,
        movRestoreTimeoutMs: 30,
      },
    );

    const summary = await action;

    expect(summary.processed).toBe(2);
    expect(
      summary.warnings.some((warning) => warning.includes("timed out")),
    ).toBe(true);
    expect(mockExifToolInstances.length).toBeGreaterThanOrEqual(2);
    expect(mockExifToolInstances[0]?.end).toHaveBeenCalled();
  });

  it("stops processing when abort signal is already set", async () => {
    const inputPath = await createTempDir("takeout-input-abort");
    const outputPath = await createTempDir("takeout-output-abort");
    await createMediaFixture(inputPath, "abort-me");

    const abortController = new AbortController();
    abortController.abort();

    const action = processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: false,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
      abortController.signal,
    );

    await expect(action).rejects.toThrow(PROCESS_ABORTED_MESSAGE);
  });

  it("matches sidecars with non-standard supplemental json suffixes", async () => {
    const inputPath = await createTempDir("takeout-input-sidecar-match");
    const outputPath = await createTempDir("takeout-output-sidecar-match");
    const mediaPath = path.join(inputPath, "AndroidMarshmallow_09.jpg");
    const sidecarPath = path.join(
      inputPath,
      "AndroidMarshmallow_09.jpg.supplemental-metadat.json",
    );

    await fs.writeFile(mediaPath, "fake-media", "utf8");
    await writeJson(sidecarPath, {
      photoTakenTime: {
        timestamp: "1700000000",
      },
      title: "AndroidMarshmallow_09.jpg",
    });

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    const writeCalls = mockExifToolInstances.flatMap((instance) => {
      return instance.write.mock.calls;
    });
    expect(writeCalls.length).toBeGreaterThan(0);
    expect(summary.report.sidecarMatchSummary.fuzzy).toBe(1);
  });

  it("applies base sidecar to edited and duplicate variants via matchVariantSidecars option", async () => {
    const inputPath = await createTempDir("takeout-input-variant-option");
    const outputPath = await createTempDir("takeout-output-variant-option");

    // Base file + its sidecar (truncated supplemental suffix, like real Takeout exports)
    await fs.writeFile(path.join(inputPath, "photo.jpg"), "fake-media", "utf8");
    await writeJson(
      path.join(inputPath, "photo.jpg.supplemental-metad.json"),
      { photoTakenTime: { timestamp: "1700000000" }, title: "photo.jpg" },
    );
    // Edited and duplicate variants — no dedicated sidecar for either
    await fs.writeFile(
      path.join(inputPath, "photo-edited.jpg"),
      "fake-media",
      "utf8",
    );
    await fs.writeFile(
      path.join(inputPath, "photo(1).jpg"),
      "fake-media",
      "utf8",
    );

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    // base file: exact or fuzzy; two variants: both resolved via "variant" strategy
    expect(summary.report.sidecarMatchSummary.variant).toBe(2);
  });

  it("leaves variants unmatched when matchVariantSidecars is disabled", async () => {
    const inputPath = await createTempDir("takeout-input-variant-disabled");
    const outputPath = await createTempDir("takeout-output-variant-disabled");

    await fs.writeFile(path.join(inputPath, "photo.jpg"), "fake-media", "utf8");
    await writeJson(
      path.join(inputPath, "photo.jpg.supplemental-metad.json"),
      { photoTakenTime: { timestamp: "1700000000" }, title: "photo.jpg" },
    );
    await fs.writeFile(
      path.join(inputPath, "photo-edited.jpg"),
      "fake-media",
      "utf8",
    );
    await fs.writeFile(
      path.join(inputPath, "photo(1).jpg"),
      "fake-media",
      "utf8",
    );

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: false,
        },
      },
      () => {
        return;
      },
    );

    expect(summary.report.sidecarMatchSummary.variant).toBe(0);
    // variants have no dedicated sidecar and option is off — both should be unmatched
    expect(summary.report.sidecarMatchSummary.none).toBe(2);
  });

  it("matches base json sidecar to a filename-edited variant (plain .json)", async () => {
    const inputPath = await createTempDir("takeout-input-edited-match");
    const outputPath = await createTempDir("takeout-output-edited-match");
    const mediaPath = path.join(inputPath, "123-edited.jpg");
    const sidecarPath = path.join(inputPath, "123.json");

    await fs.writeFile(mediaPath, "fake-media", "utf8");
    await writeJson(sidecarPath, {
      photoTakenTime: { timestamp: "1700000000" },
      title: "123",
    });

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    expect(summary.report.sidecarMatchSummary.variant).toBe(1);
  });

  it("matches base json sidecar to a filename-edited(N) numbered variant (plain .json)", async () => {
    const inputPath = await createTempDir("takeout-input-edited-numbered-match");
    const outputPath = await createTempDir(
      "takeout-output-edited-numbered-match",
    );
    const mediaPath = path.join(inputPath, "123-edited(1).jpg");
    const sidecarPath = path.join(inputPath, "123.json");

    await fs.writeFile(mediaPath, "fake-media", "utf8");
    await writeJson(sidecarPath, {
      photoTakenTime: { timestamp: "1700000000" },
      title: "123",
    });

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    expect(summary.report.sidecarMatchSummary.variant).toBe(1);
  });

  it("matches supplemental-metad sidecar to its filename-edited variant via variant option", async () => {
    const inputPath = await createTempDir("takeout-input-edited-fuzzy");
    const outputPath = await createTempDir("takeout-output-edited-fuzzy");
    const mediaPath = path.join(inputPath, "IMG_708-edited.jpg");
    const sidecarPath = path.join(
      inputPath,
      "IMG_708.jpg.supplemental-metad.json",
    );

    await fs.writeFile(mediaPath, "fake-media", "utf8");
    await writeJson(sidecarPath, {
      photoTakenTime: { timestamp: "1700000000" },
      title: "IMG_708.jpg",
    });

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    expect(summary.report.sidecarMatchSummary.variant).toBe(1);
  });

  it("matches supplemental-metad sidecar to its filename(N) duplicate variant via variant option", async () => {
    const inputPath = await createTempDir("takeout-input-duplicate-fuzzy");
    const outputPath = await createTempDir("takeout-output-duplicate-fuzzy");
    const mediaPath = path.join(inputPath, "IMG_708(1).jpg");
    const sidecarPath = path.join(
      inputPath,
      "IMG_708.jpg.supplemental-metad.json",
    );

    await fs.writeFile(mediaPath, "fake-media", "utf8");
    await writeJson(sidecarPath, {
      photoTakenTime: { timestamp: "1700000000" },
      title: "IMG_708.jpg",
    });

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    expect(summary.report.sidecarMatchSummary.variant).toBe(1);
  });

  it("does not force-match unrelated low-confidence json sidecars", async () => {
    const inputPath = await createTempDir("takeout-input-low-confidence");
    const outputPath = await createTempDir("takeout-output-low-confidence");
    const mediaPath = path.join(inputPath, "photo.jpg");
    const unrelatedSidecarPath = path.join(inputPath, "metadata.json");

    await fs.writeFile(mediaPath, "fake-media", "utf8");
    await writeJson(unrelatedSidecarPath, {
      title: "Wallpapers",
      description: "album metadata",
    });

    const summary = await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    expect(summary.report.sidecarMatchSummary.none).toBe(1);
    expect(summary.report.sidecarMatchSummary.title).toBe(0);
  });

  it("ignores 0,0 coordinates by default when option is enabled", async () => {
    const inputPath = await createTempDir("takeout-input-ignore-zero");
    const outputPath = await createTempDir("takeout-output-ignore-zero");
    const mediaPath = path.join(inputPath, "zero.jpg");
    const sidecarPath = path.join(inputPath, "zero.jpg.supplemental-meta.json");

    await fs.writeFile(mediaPath, "fake-media", "utf8");
    await writeJson(sidecarPath, {
      photoTakenTime: {
        timestamp: "1700000000",
      },
      geoData: {
        latitude: 0,
        longitude: 0,
        altitude: 0,
      },
    });

    await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: true,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    const writeCalls = mockExifToolInstances.flatMap((instance) => {
      return instance.write.mock.calls;
    });

    const exifTagPayloads = writeCalls.map((call) => {
      const tags = call[1] as Record<string, unknown>;
      return tags;
    });

    const wroteGps = exifTagPayloads.some((tags) => {
      return "GPSLatitude" in tags || "GPSLongitude" in tags;
    });
    expect(wroteGps).toBe(false);
  });

  it("writes 0,0 coordinates when ignore option is disabled", async () => {
    const inputPath = await createTempDir("takeout-input-allow-zero");
    const outputPath = await createTempDir("takeout-output-allow-zero");
    const mediaPath = path.join(inputPath, "zero-allowed.jpg");
    const sidecarPath = path.join(
      inputPath,
      "zero-allowed.jpg.supplemental-meta.json",
    );

    await fs.writeFile(mediaPath, "fake-media", "utf8");
    await writeJson(sidecarPath, {
      photoTakenTime: {
        timestamp: "1700000000",
      },
      geoData: {
        latitude: 0,
        longitude: 0,
        altitude: 0,
      },
    });

    await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: false,
          createYearSubfoldersOnly: false,
          ignoreZeroCoordinates: false,
          matchVariantSidecars: true,
        },
      },
      () => {
        return;
      },
    );

    const writeCalls = mockExifToolInstances.flatMap((instance) => {
      return instance.write.mock.calls;
    });

    const wroteGpsZeroCoordinates = writeCalls.some((call) => {
      const tags = call[1] as Record<string, unknown>;
      return tags.GPSLatitude === 0 && tags.GPSLongitude === 0;
    });
    expect(wroteGpsZeroCoordinates).toBe(true);
  });
});

describe("finalizeTempOrganise", () => {
  it("applies reviewed temp-folder contents into the selected target folder", async () => {
    const targetPath = await createTempDir("takeout-finalize-target");
    const originalFilePath = path.join(targetPath, "original.txt");
    const tempFolderPath = path.join(targetPath, "-temp-review");
    const reviewedFilePath = path.join(tempFolderPath, "reviewed.txt");

    await fs.writeFile(originalFilePath, "before", "utf8");
    await fs.mkdir(tempFolderPath, { recursive: true });
    await fs.writeFile(reviewedFilePath, "after", "utf8");

    const result = await finalizeTempOrganise(targetPath, tempFolderPath);

    expect(result.applied).toBe(true);
    await expect(
      fs.access(path.join(targetPath, "reviewed.txt")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(targetPath, "original.txt")),
    ).rejects.toThrow();
    await expect(fs.access(tempFolderPath)).rejects.toThrow();
  });
});

describe("timestamp preservation during organisation moves", () => {
  const noop = (): void => {
    return;
  };

  const originalDate = new Date("2022-01-15T07:50:00.000Z");

  it("preserves mtime after flattenMonthsToYears", async () => {
    const targetPath = await createTempDir("takeout-ts-months");
    const monthPath = path.join(targetPath, "2022", "01");
    await fs.mkdir(monthPath, { recursive: true });
    const filePath = path.join(monthPath, "photo.jpg");
    await fs.writeFile(filePath, "data", "utf8");
    await fs.utimes(filePath, originalDate, originalDate);

    await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: true,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
        },
      },
      noop,
    );

    const moved = path.join(targetPath, "2022", "photo.jpg");
    const { mtime } = await fs.stat(moved);
    expect(mtime.getTime()).toBe(originalDate.getTime());
  });

  it("preserves mtime after flattenAllToRoot", async () => {
    const targetPath = await createTempDir("takeout-ts-all-root");
    const subDir = path.join(targetPath, "misc");
    await fs.mkdir(subDir, { recursive: true });
    const filePath = path.join(subDir, "photo.jpg");
    await fs.writeFile(filePath, "data", "utf8");
    await fs.utimes(filePath, originalDate, originalDate);

    await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: true,
          removeEmptyFolders: false,
        },
      },
      noop,
    );

    const moved = path.join(targetPath, "photo.jpg");
    const { mtime } = await fs.stat(moved);
    expect(mtime.getTime()).toBe(originalDate.getTime());
  });

  it("preserves mtime after flattenIntoHalves", async () => {
    const targetPath = await createTempDir("takeout-ts-halves");
    const filePath = path.join(targetPath, "photo.jpg");
    await fs.writeFile(filePath, "data", "utf8");
    await fs.utimes(filePath, originalDate, originalDate);

    await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          flattenIntoHalves: true,
        },
      },
      noop,
    );

    const moved = path.join(targetPath, "H1", "photo.jpg");
    const { mtime } = await fs.stat(moved);
    expect(mtime.getTime()).toBe(originalDate.getTime());
  });
});

describe("timestamp preservation through temp-folder round trip", () => {
  const noop = (): void => {
    return;
  };

  const originalDate = new Date("2022-01-15T07:50:00.000Z");

  it("preserves mtime through copy → organise → apply when using temp folder", async () => {
    const targetPath = await createTempDir("takeout-ts-tempfolder");
    const subDir = path.join(targetPath, "misc");
    await fs.mkdir(subDir, { recursive: true });
    const filePath = path.join(subDir, "photo.jpg");
    await fs.writeFile(filePath, "data", "utf8");
    await fs.utimes(filePath, originalDate, originalDate);

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: true,
          removeEmptyFolders: false,
          createTempFolderForReview: true,
        },
      },
      noop,
    );

    const tempFolderPath = summary.report.tempFolderPath;
    if (!tempFolderPath) {
      throw new Error("Expected a temp folder path in the report");
    }

    // Verify mtime is preserved inside the temp folder before apply.
    const tempFile = path.join(tempFolderPath, "photo.jpg");
    const { mtime: mtimeInTemp } = await fs.stat(tempFile);
    expect(mtimeInTemp.getTime()).toBe(originalDate.getTime());

    // Apply the reviewed result.
    await finalizeTempOrganise(targetPath, tempFolderPath);

    // Verify mtime is still preserved after apply.
    const finalFile = path.join(targetPath, "photo.jpg");
    const { mtime: mtimeFinal } = await fs.stat(finalFile);
    expect(mtimeFinal.getTime()).toBe(originalDate.getTime());
  });
});

describe("postProcessFolder", () => {
  it("creates a temp review folder without attempting to copy the folder into itself", async () => {
    const targetPath = await createTempDir("takeout-post-process-temp");
    const yearPath = path.join(targetPath, "2024");
    const monthPath = path.join(yearPath, "03");
    const mediaPath = path.join(monthPath, "photo.jpg");

    await fs.mkdir(monthPath, { recursive: true });
    await fs.writeFile(mediaPath, "fake-media", "utf8");

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: true,
          flattenAllToRoot: false,
          removeEmptyFolders: true,
          createTempFolderForReview: true,
        },
      },
      () => {
        return;
      },
    );

    expect(summary.report.tempFolderPath).toBeTruthy();
    expect(summary.report.tempFolderPath).toContain("-temp-");
  });
});

describe("flattenIntoHalves", () => {
  const noop = (): void => {
    return;
  };

  it("places every file into H1 or H2 — no files are lost", async () => {
    const targetPath = await createTempDir("takeout-halves-all-included");

    await fs.writeFile(path.join(targetPath, "a.jpg"), "x".repeat(100), "utf8");
    await fs.writeFile(path.join(targetPath, "b.jpg"), "x".repeat(200), "utf8");
    await fs.writeFile(path.join(targetPath, "c.jpg"), "x".repeat(300), "utf8");

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          flattenIntoHalves: true,
        },
      },
      noop,
    );

    const h1Files = await fs.readdir(path.join(targetPath, "H1"));
    const h2Files = await fs.readdir(path.join(targetPath, "H2"));
    const totalMoved = h1Files.length + h2Files.length;

    expect(totalMoved).toBe(3);
    expect(summary.report.halvesReport?.h1FileCount).toBeGreaterThan(0);
    expect(summary.report.halvesReport?.h2FileCount).toBeGreaterThan(0);
    expect(
      (summary.report.halvesReport?.h1FileCount ?? 0) +
        (summary.report.halvesReport?.h2FileCount ?? 0),
    ).toBe(3);
  });

  it("puts a single file into H1 only and never creates H2", async () => {
    const targetPath = await createTempDir("takeout-halves-single-file");

    await fs.writeFile(
      path.join(targetPath, "only.jpg"),
      "x".repeat(500),
      "utf8",
    );

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          flattenIntoHalves: true,
        },
      },
      noop,
    );

    const h1Files = await fs.readdir(path.join(targetPath, "H1"));
    const h2Exists = await fs
      .access(path.join(targetPath, "H2"))
      .then(() => true)
      .catch(() => false);

    expect(h1Files).toHaveLength(1);
    expect(h2Exists).toBe(false);
    expect(summary.report.halvesReport?.h1FileCount).toBe(1);
    expect(summary.report.halvesReport?.h2FileCount).toBe(0);
  });

  it("balances a large file against many small files correctly", async () => {
    const targetPath = await createTempDir("takeout-halves-large-vs-small");

    // One 600-byte file and ten 30-byte files (300 bytes total).
    // Greedy largest-first: big file → H1 (600), then all small → H2 (300).
    await fs.writeFile(
      path.join(targetPath, "big.jpg"),
      "x".repeat(600),
      "utf8",
    );
    for (let i = 0; i < 10; i++) {
      await fs.writeFile(
        path.join(targetPath, `small-${i}.jpg`),
        "x".repeat(30),
        "utf8",
      );
    }

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          flattenIntoHalves: true,
        },
      },
      noop,
    );

    const h1Files = await fs.readdir(path.join(targetPath, "H1"));
    const h2Files = await fs.readdir(path.join(targetPath, "H2"));

    // All 11 files must be present across both halves.
    expect(h1Files.length + h2Files.length).toBe(11);
    // The big file alone goes to H1; the ten small files go to H2.
    expect(h1Files).toHaveLength(1);
    expect(h2Files).toHaveLength(10);
    expect(summary.report.halvesReport?.h1SizeBytes).toBeGreaterThan(
      summary.report.halvesReport?.h2SizeBytes ?? 0,
    );
  });

  it("scans files recursively from sub-folders", async () => {
    const targetPath = await createTempDir("takeout-halves-recursive");
    const subDir = path.join(targetPath, "nested");
    await fs.mkdir(subDir, { recursive: true });

    await fs.writeFile(path.join(targetPath, "root.jpg"), "x".repeat(100), "utf8");
    await fs.writeFile(path.join(subDir, "deep.jpg"), "x".repeat(100), "utf8");

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          flattenIntoHalves: true,
        },
      },
      noop,
    );

    const h1Files = await fs.readdir(path.join(targetPath, "H1"));
    const h2Files = await fs.readdir(path.join(targetPath, "H2"));

    expect(h1Files.length + h2Files.length).toBe(2);
    expect(
      (summary.report.halvesReport?.h1FileCount ?? 0) +
        (summary.report.halvesReport?.h2FileCount ?? 0),
    ).toBe(2);
  });

  it("reports zero problem files when all moves succeed", async () => {
    const targetPath = await createTempDir("takeout-halves-no-problems");

    await fs.writeFile(path.join(targetPath, "x.jpg"), "data", "utf8");
    await fs.writeFile(path.join(targetPath, "y.jpg"), "data", "utf8");

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          flattenIntoHalves: true,
        },
      },
      noop,
    );

    expect(summary.report.problemFiles).toHaveLength(0);
    expect(summary.warnings).toHaveLength(0);
  });
});

describe("flattenAllToRoot", () => {
  const noop = (): void => {
    return;
  };

  it("moves files from deeply nested sub-folders into the root", async () => {
    const targetPath = await createTempDir("takeout-flatten-all-root");
    const deepDir = path.join(targetPath, "a", "b", "c");
    await fs.mkdir(deepDir, { recursive: true });
    await fs.writeFile(path.join(deepDir, "deep.jpg"), "data", "utf8");
    await fs.writeFile(path.join(targetPath, "root.jpg"), "data", "utf8");

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: true,
          removeEmptyFolders: false,
        },
      },
      noop,
    );

    const entries = await fs.readdir(targetPath);
    expect(entries).toContain("deep.jpg");
    expect(entries).toContain("root.jpg");
    expect(summary.report.movedFilesCount).toBe(1);
  });

  it("removes now-empty sub-folders after flattening", async () => {
    const targetPath = await createTempDir("takeout-flatten-all-cleanup");
    const subDir = path.join(targetPath, "2023", "06");
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(subDir, "photo.jpg"), "data", "utf8");

    await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: true,
          removeEmptyFolders: false,
        },
      },
      noop,
    );

    const yearExists = await fs
      .access(path.join(targetPath, "2023"))
      .then(() => true)
      .catch(() => false);

    expect(yearExists).toBe(false);
    const entries = await fs.readdir(targetPath);
    expect(entries).toContain("photo.jpg");
  });

  it("leaves files already at root level untouched", async () => {
    const targetPath = await createTempDir("takeout-flatten-all-root-only");
    await fs.writeFile(path.join(targetPath, "a.jpg"), "data", "utf8");
    await fs.writeFile(path.join(targetPath, "b.jpg"), "data", "utf8");

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: true,
          removeEmptyFolders: false,
        },
      },
      noop,
    );

    expect(summary.report.movedFilesCount).toBe(0);
    expect(summary.report.problemFiles).toHaveLength(0);
  });

  it("flattens non-year-named sub-folders that flattenMonthsToYears would ignore", async () => {
    const targetPath = await createTempDir("takeout-flatten-all-arbitrary");
    const arbitrary = path.join(targetPath, "misc", "stuff");
    await fs.mkdir(arbitrary, { recursive: true });
    await fs.writeFile(path.join(arbitrary, "file.mp4"), "data", "utf8");

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: true,
          removeEmptyFolders: false,
        },
      },
      noop,
    );

    const entries = await fs.readdir(targetPath);
    expect(entries).toContain("file.mp4");
    expect(summary.report.movedFilesCount).toBe(1);
  });
});

describe("syncTimestampsInFolder via postProcessFolder", () => {
  const noop = (): void => { return; };

  afterEach(() => {
    mockExifToolInstances.length = 0;
    mockWriteCallCount = 0;
    mockWriteMode = "normal";
  });

  it("writeModifiedToCreated: writes FileCreateDate = mtime via ExifTool", async () => {
    const targetPath = await createTempDir("ts-sync-mod-to-created");
    const filePath = path.join(targetPath, "photo.jpg");
    await fs.writeFile(filePath, "fake-media", "utf8");

    const mtime = new Date("2018-01-24T17:28:52.000Z");
    await fs.utimes(filePath, mtime, mtime);

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          writeModifiedToCreated: true,
        },
      },
      noop,
    );

    expect(summary.report.timestampSyncReport?.processedCount).toBe(1);
    expect(summary.report.timestampSyncReport?.successCount).toBe(1);

    const writeInstance = mockExifToolInstances[mockExifToolInstances.length - 1];
    if (!writeInstance) {
      throw new Error("No ExifTool instance was created");
    }
    const writeCalls = writeInstance.write.mock.calls;
    const fileCreateDateCall = writeCalls.find(
      ([, tags]) => (tags as Record<string, unknown>).FileCreateDate !== undefined,
    );
    if (!fileCreateDateCall) {
      throw new Error("ExifTool.write was not called with FileCreateDate");
    }
    const writtenDate = (fileCreateDateCall[1] as Record<string, unknown>).FileCreateDate as Date;
    expect(Math.floor(writtenDate.getTime() / 1000)).toBe(Math.floor(mtime.getTime() / 1000));
  });

  it("writeCreatedToModified: sets mtime = birthtime via fs.utimes", async () => {
    const targetPath = await createTempDir("ts-sync-created-to-mod");
    const filePath = path.join(targetPath, "photo.jpg");
    await fs.writeFile(filePath, "fake-media", "utf8");

    const { birthtime } = await fs.stat(filePath);

    // Set mtime to a far-future date so it clearly differs from birthtime.
    // Using a future date (not a past one) avoids macOS APFS silently updating
    // birthtime to match when mtime < birthtime.
    const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
    const futureMtime = new Date(birthtime.getTime() + TEN_YEARS_MS);
    await fs.utimes(filePath, futureMtime, futureMtime);

    await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          writeCreatedToModified: true,
        },
      },
      noop,
    );

    const { mtime: newMtime } = await fs.stat(filePath);
    // mtime should now match birthtime (at second precision)
    expect(Math.floor(newMtime.getTime() / 1000)).toBe(
      Math.floor(birthtime.getTime() / 1000),
    );
  });

  it("coerceBothToLowest: sets mtime = birthtime when birthtime is earlier", async () => {
    const targetPath = await createTempDir("ts-sync-coerce");
    const filePath = path.join(targetPath, "photo.jpg");
    await fs.writeFile(filePath, "fake-media", "utf8");

    const { birthtime } = await fs.stat(filePath);

    // Set mtime to a far-future date so mtime > birthtime (the standard macOS state).
    // coerceBothToLowest should pull mtime down to birthtime (the lower value).
    const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
    const futureMtime = new Date(birthtime.getTime() + TEN_YEARS_MS);
    await fs.utimes(filePath, futureMtime, futureMtime);

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          coerceBothToLowest: true,
        },
      },
      noop,
    );

    expect(summary.report.timestampSyncReport?.processedCount).toBe(1);
    expect(summary.report.timestampSyncReport?.successCount).toBe(1);

    // mtime should now match birthtime (coerced to the lower value)
    const { mtime: newMtime } = await fs.stat(filePath);
    expect(Math.floor(newMtime.getTime() / 1000)).toBe(
      Math.floor(birthtime.getTime() / 1000),
    );
  });

  it("skips non-media files and counts only media files", async () => {
    const targetPath = await createTempDir("ts-sync-non-media");
    await fs.writeFile(path.join(targetPath, "photo.jpg"), "fake-media", "utf8");
    await fs.writeFile(path.join(targetPath, "notes.txt"), "text", "utf8");
    await fs.writeFile(path.join(targetPath, "data.json"), "{}", "utf8");

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          writeModifiedToCreated: true,
        },
      },
      noop,
    );

    // Only the .jpg counts
    expect(summary.report.timestampSyncReport?.processedCount).toBe(1);
  });

  it("scans subdirectories recursively", async () => {
    const targetPath = await createTempDir("ts-sync-recursive");
    const subDir = path.join(targetPath, "2018", "01");
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(targetPath, "a.jpg"), "x", "utf8");
    await fs.writeFile(path.join(subDir, "b.jpg"), "x", "utf8");

    const summary = await postProcessFolder(
      {
        targetPath,
        options: {
          flattenMonthsToYears: false,
          flattenAllToRoot: false,
          removeEmptyFolders: false,
          writeModifiedToCreated: true,
        },
      },
      noop,
    );

    expect(summary.report.timestampSyncReport?.processedCount).toBe(2);
  });
});
