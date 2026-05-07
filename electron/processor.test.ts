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

const { processTakeoutFolder, PROCESS_ABORTED_MESSAGE } =
  await import("./processor.js");

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
        },
      },
      () => {
        return;
      },
      abortController.signal,
    );

    await expect(action).rejects.toThrow(PROCESS_ABORTED_MESSAGE);
  });
});
