// @vitest-environment node

import { describe, expect, it } from "vitest";

import { processTakeoutFolder } from "./processor.js";

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
});
