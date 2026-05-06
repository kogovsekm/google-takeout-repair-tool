import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { processTakeoutFolder } from "../dist-electron/processor.js";

const MIN_IMAGES = 10000;
const DEFAULT_IMAGES = 30000;
const CPU_COUNT = Math.max(1, os.cpus().length);
const ONE_BY_ONE_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEA8PEBAQDw8PEA8QDw8PEA8PFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDQ0OFQ8PFS0dFR0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBEQACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFhABAQEAAAAAAAAAAAAAAAAAAAER/9oADAMBAAIQAxAAAAGjANf/xAAXEAADAQAAAAAAAAAAAAAAAAAAAREx/9oACAEBAAEFAvEj/8QAFREBAQAAAAAAAAAAAAAAAAAAABH/2gAIAQMBAT8Baf/EABURAQEAAAAAAAAAAAAAAAAAABAR/9oACAECAQE/ATf/xAAXEAEBAQEAAAAAAAAAAAAAAAABABEh/9oACAEBAAY/AtvH/8QAFhABAQEAAAAAAAAAAAAAAAAAARAR/9oACAEBAAE/IWX/xAAaEAACAwEBAAAAAAAAAAAAAAABEQAhMUFh/9oACAEBAAE/IZQjYSxXF0mtDv/aAAwDAQACAAMAAAAQvP/EABcRAQADAAAAAAAAAAAAAAAAAAABETH/2gAIAQMBAT8Qx1f/xAAXEQEAAwAAAAAAAAAAAAAAAAABABEh/9oACAECAQE/EEXL/8QAGxABAQACAwEAAAAAAAAAAAAAAREAITFBUXH/2gAIAQEAAT8QhQ8p7dwd2sVqJbPLgYQf/9k=";

/**
 * @description Parses benchmark arg from npm invocation.
 * Expected formats:
 * - npm run benchmark
 * - npm run benchmark -- --images=30000
 * @param argv Raw process argv values.
 * @returns Parsed image count when valid, otherwise null.
 */
const parseImageCount = (argv) => {
  if (argv.length === 0) {
    return DEFAULT_IMAGES;
  }

  if (argv.length !== 1) {
    return null;
  }

  const namedArg = argv[0];
  if (!/^--images=\d+$/.test(namedArg)) {
    return null;
  }

  const parsedNamedValue = Number.parseInt(
    namedArg.replace("--images=", ""),
    10,
  );
  if (!Number.isFinite(parsedNamedValue) || parsedNamedValue < MIN_IMAGES) {
    return null;
  }

  return parsedNamedValue;
};

/**
 * @description Creates a synthetic input dataset with media files and sidecar JSON.
 * @param rootInputDir Input root directory.
 * @param imageCount Number of image files to generate.
 * @returns Nothing.
 */
const createSyntheticDataset = async (rootInputDir, imageCount) => {
  const jpegBuffer = Buffer.from(ONE_BY_ONE_JPEG_BASE64, "base64");
  const baseTimestamp = Date.UTC(2020, 0, 1, 12, 0, 0);

  for (let index = 1; index <= imageCount; index += 1) {
    const monthBucket = String(((index - 1) % 12) + 1).padStart(2, "0");
    const nestedDir = path.join(rootInputDir, `takeout_batch_${monthBucket}`);
    await fs.mkdir(nestedDir, { recursive: true });

    const fileName = `IMG_${String(index).padStart(6, "0")}.jpg`;
    const mediaPath = path.join(nestedDir, fileName);
    await fs.writeFile(mediaPath, jpegBuffer);

    const sidecarPath = `${mediaPath}.json`;
    const timestampSeconds = Math.floor(
      (baseTimestamp + index * 3600 * 1000) / 1000,
    );
    const sidecar = {
      title: `Synthetic Image ${index}`,
      description: `Synthetic benchmark payload ${index}`,
      photoTakenTime: {
        timestamp: String(timestampSeconds),
      },
      geoData: {
        latitude: 37.4219999,
        longitude: -122.0840575,
        altitude: 15,
      },
    };

    await fs.writeFile(sidecarPath, JSON.stringify(sidecar), "utf8");
  }
};

/**
 * @description Formats elapsed milliseconds into mm:ss.
 * @param durationMs Elapsed time in milliseconds.
 * @returns Human-readable duration.
 */
const formatMinutesSeconds = (durationMs) => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

const run = async () => {
  const imageCount = parseImageCount(process.argv.slice(2));

  if (imageCount === null) {
    console.warn(
      "Warning: invalid argument format. Use `npm run benchmark` (defaults to 30000) or `npm run benchmark -- --images=30000`. Minimum accepted value is 10000.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Preparing synthetic benchmark dataset for ${imageCount} images...`,
  );

  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "takeout-benchmark-"),
  );
  const inputPath = path.join(tempRoot, "input");
  const outputPath = path.join(tempRoot, "output");

  await fs.mkdir(inputPath, { recursive: true });
  await fs.mkdir(outputPath, { recursive: true });

  let peakCpuPercent = 0;
  let peakMemoryMb = 0;

  let previousCpuUsage = process.cpuUsage();
  let previousHrTime = process.hrtime.bigint();

  try {
    await createSyntheticDataset(inputPath, imageCount);

    const startedAt = Date.now();

    await processTakeoutFolder(
      {
        inputPath,
        outputPath,
        options: {
          writeMetadata: true,
          createYearMonthSubfolders: true,
        },
      },
      (update) => {
        const currentCpuUsage = process.cpuUsage();
        const currentHrTime = process.hrtime.bigint();

        const cpuDeltaMicros =
          currentCpuUsage.user +
          currentCpuUsage.system -
          (previousCpuUsage.user + previousCpuUsage.system);
        const wallDeltaMs = Number(currentHrTime - previousHrTime) / 1e6;

        const cpuPercent =
          wallDeltaMs > 0
            ? (cpuDeltaMicros / 1000 / wallDeltaMs / CPU_COUNT) * 100
            : 0;

        const memoryMb = process.memoryUsage().rss / 1024 / 1024;

        if (cpuPercent > peakCpuPercent) {
          peakCpuPercent = cpuPercent;
        }

        if (memoryMb > peakMemoryMb) {
          peakMemoryMb = memoryMb;
        }

        console.log(`Processing image ${update.processed} of ${imageCount}.`);
        console.log(`CPU usage: ${cpuPercent.toFixed(2)}%`);
        console.log(`Memory usage: ${memoryMb.toFixed(2)} MB`);
        console.log("----");

        previousCpuUsage = currentCpuUsage;
        previousHrTime = currentHrTime;
      },
    );

    const endedAt = Date.now();
    const totalDurationMs = endedAt - startedAt;

    console.log(`Completed in ${formatMinutesSeconds(totalDurationMs)}.`);
    console.log(`Peak CPU usage: ${peakCpuPercent.toFixed(2)}%`);
    console.log(`Peak memory usage: ${peakMemoryMb.toFixed(2)} MB`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};

void run();
