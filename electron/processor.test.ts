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
          flattenYearsToRoot: false,
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
