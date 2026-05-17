import { useEffect, useRef, useState } from "react";

declare const __APP_VERSION__: string;
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  CircleAlert,
  FileText,
  FolderOpen,
  Info,
  Layers2,
  LoaderCircle,
  Moon,
  Rocket,
  RotateCcw,
  Sun,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import OrganiseReportDialog from "./components/OrganiseReportDialog";
import ProcessReportDialog from "./components/ProcessReportDialog";
import { Accordion, AccordionItem } from "./components/ui/Accordion";
import type {
  PostProcessOptions,
  PostProcessSummary,
  ProcessOptions,
  ProcessSummary,
  ProgressUpdate,
} from "./types/electronApi";

type LogEntry = {
  id: string;
  text: string;
  level: "info" | "warn" | "error";
};

type LogVisual = {
  label: string;
  Icon: LucideIcon;
  cardClassName: string;
  chipClassName: string;
  iconClassName: string;
  textClassName: string;
};

type ThemeMode = "dark" | "light";
type TabId = "repair" | "organise";
type Toast = { id: string; message: string };

type ConfirmationDialogState = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
};

const THEME_STORAGE_KEY = "takeout-repair-theme";
const PROCESS_ABORTED_MESSAGE = "Processing aborted by user.";

type CheckboxRowProps = {
  label: React.ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  isLightTheme: boolean;
};

const CheckboxRow = ({
  label,
  checked,
  onChange,
  disabled,
  isLightTheme,
}: CheckboxRowProps) => (
  <label
    className={`option-row ${
      disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
    }`}
  >
    <input
      type="checkbox"
      className="peer sr-only"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-transparent shadow-[inset_0_0_0_1px_rgba(86,182,194,0.22)] transition peer-checked:border-[#56b6c2]/90 peer-checked:bg-gradient-to-br peer-checked:from-[#56b6c2] peer-checked:via-[#61afef] peer-checked:to-[#c678dd] peer-checked:text-[#1b1f2a] peer-focus-visible:ring-2 ${
        isLightTheme
          ? "border-[#5a87b9]/45 bg-[#f3f8ff] peer-focus-visible:ring-[#7084dd]/45"
          : "border-[#61afef]/45 bg-[#1f2430]/85 peer-focus-visible:ring-[#c678dd]/60"
      }`}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M5 12.5L9.5 17L19 7.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
    <div
      className={`relative ml-0.5 inline-flex items-center gap-2 font-body text-lg ${
        isLightTheme ? "text-[#2f3f56]" : "text-[#d7deea]"
      }`}
    >
      {label}
    </div>
  </label>
);

const darkLogVisualByLevel: Record<LogEntry["level"], LogVisual> = {
  info: {
    label: "Information",
    Icon: Info,
    cardClassName: "border-[#56b6c2]/30 bg-[#56b6c2]/8",
    chipClassName: "border-[#56b6c2]/45 bg-[#56b6c2]/20 text-[#9fe8f2]",
    iconClassName: "text-[#56b6c2]",
    textClassName: "text-[#98c379]",
  },
  warn: {
    label: "Warning",
    Icon: TriangleAlert,
    cardClassName: "border-[#e5c07b]/35 bg-[#e5c07b]/8",
    chipClassName: "border-[#e5c07b]/45 bg-[#e5c07b]/18 text-[#f3d8a7]",
    iconClassName: "text-[#e5c07b]",
    textClassName: "text-[#f1d59c]",
  },
  error: {
    label: "Problem",
    Icon: CircleAlert,
    cardClassName: "border-rose-300/35 bg-rose-400/8",
    chipClassName: "border-rose-300/50 bg-rose-400/16 text-rose-100",
    iconClassName: "text-rose-300",
    textClassName: "text-rose-200",
  },
};

const lightLogVisualByLevel: Record<LogEntry["level"], LogVisual> = {
  info: {
    label: "Information",
    Icon: Info,
    cardClassName: "border-[#6ca2cc]/35 bg-[#e7f4ff]",
    chipClassName: "border-[#5f9dca]/45 bg-[#d7ecff] text-[#2f638b]",
    iconClassName: "text-[#2f7eaa]",
    textClassName: "text-[#3f6f3b]",
  },
  warn: {
    label: "Warning",
    Icon: TriangleAlert,
    cardClassName: "border-[#d3a95f]/38 bg-[#fff2dc]",
    chipClassName: "border-[#c89c4f]/45 bg-[#ffe8bf] text-[#7f5b1f]",
    iconClassName: "text-[#b27a2a]",
    textClassName: "text-[#8c641f]",
  },
  error: {
    label: "Problem",
    Icon: CircleAlert,
    cardClassName: "border-[#d98e9c]/38 bg-[#ffe7eb]",
    chipClassName: "border-[#cd7b8b]/48 bg-[#ffd7df] text-[#7d3341]",
    iconClassName: "text-[#b74e61]",
    textClassName: "text-[#8c2f40]",
  },
};

/**
 * @description Main desktop interface for selecting a Google Takeout folder, toggling processing options, and tracking progress.
 * @returns Rendered app shell with controls, warnings, progress bar, and live logs.
 */
const App = () => {
  const desktopApi =
    typeof window !== "undefined" ? window.takeoutApi : undefined;
  const hasDesktopApi =
    typeof desktopApi?.validatePaths === "function" &&
    typeof desktopApi?.onProgress === "function" &&
    typeof desktopApi.selectFolder === "function" &&
    typeof desktopApi.processFolder === "function" &&
    typeof desktopApi.finalizeTempOrganise === "function" &&
    typeof desktopApi.abortProcess === "function" &&
    typeof desktopApi.openFolder === "function" &&
    typeof desktopApi.saveReport === "function";
  const [selectedInputFolder, setSelectedInputFolder] = useState<string | null>(
    null,
  );
  const [selectedOutputFolder, setSelectedOutputFolder] = useState<
    string | null
  >(null);
  const [lastInputFolder, setLastInputFolder] = useState<string | null>(null);
  const [lastOutputFolder, setLastOutputFolder] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAbortRequested, setIsAbortRequested] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [completedSummary, setCompletedSummary] =
    useState<ProcessSummary | null>(null);
  const [statusText, setStatusText] = useState("Ready to start");
  const [warningText, setWarningText] = useState<string | null>(
    hasDesktopApi
      ? null
      : "Electron bridge is unavailable. Start the desktop app with npm run dev.",
  );
  const [logs, setLogs] = useState<Array<LogEntry>>([]);
  const [progress, setProgress] = useState<ProgressUpdate>({
    processed: 0,
    total: 0,
    currentFile: null,
    level: "info",
    message: "",
  });

  const [options, setOptions] = useState<ProcessOptions>({
    writeMetadata: true,
    createYearMonthSubfolders: true,
    createYearSubfoldersOnly: false,
    ignoreZeroCoordinates: true,
    matchVariantSidecars: true,
  });
  const [pathWarnings, setPathWarnings] = useState<
    Array<{ type: string; message: string }>
  >([]);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  // ── Tab + cross-tab locking ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>("repair");
  const [activeJob, setActiveJob] = useState<TabId | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmationDialog, setConfirmationDialog] =
    useState<ConfirmationDialogState | null>(null);
  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );

  // ── Organise tab state ─────────────────────────────────────────────────────
  const [orgSelectedFolder, setOrgSelectedFolder] = useState<string | null>(
    null,
  );
  const [orgLastFolder, setOrgLastFolder] = useState<string | null>(null);
  const [orgCompletedSummary, setOrgCompletedSummary] =
    useState<PostProcessSummary | null>(null);
  const [isApplyingOrgTempReview, setIsApplyingOrgTempReview] = useState(false);
  const [orgIsReportOpen, setOrgIsReportOpen] = useState(false);
  const [orgStatusText, setOrgStatusText] = useState(
    "Select a folder to organise",
  );
  const [orgWarningText, setOrgWarningText] = useState<string | null>(null);
  const [orgLogs, setOrgLogs] = useState<Array<LogEntry>>([]);
  const [orgProgress, setOrgProgress] = useState<ProgressUpdate>({
    processed: 0,
    total: 0,
    currentFile: null,
    level: "info",
    message: "",
  });
  const [orgOptions, setOrgOptions] = useState<PostProcessOptions>({
    flattenMonthsToYears: false,
    flattenAllToRoot: false,
    removeEmptyFolders: true,
    createTempFolderForReview: true,
    flattenIntoHalves: false,
    writeModifiedToCreated: false,
    writeCreatedToModified: false,
    coerceBothToLowest: false,
  });
  const orgLogsContainerRef = useRef<HTMLDivElement | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const infoButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isThemePinned, setIsThemePinned] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === "dark" || storedTheme === "light";
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      return storedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  const isLightTheme = theme === "light";
  const logVisualByLevel = isLightTheme
    ? lightLogVisualByLevel
    : darkLogVisualByLevel;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (isThemePinned || typeof window === "undefined") {
      return () => {
        return;
      };
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChange = (event: MediaQueryListEvent): void => {
      setTheme(event.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", onSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener("change", onSystemThemeChange);
    };
  }, [isThemePinned]);

  useEffect(() => {
    if (!hasDesktopApi) {
      return () => {
        return;
      };
    }

    const unsubscribe = desktopApi.onProgress((update) => {
      setProgress(update);
      setLogs((current) => {
        const next = [
          ...current,
          {
            id: crypto.randomUUID(),
            text: `[${update.level.toUpperCase()}] ${update.message}`,
            level: update.level,
          },
        ];

        return next.slice(-250);
      });

      const hasFile =
        typeof update.currentFile === "string" && update.currentFile.length > 0;
      const current = hasFile ? update.currentFile : "processing";
      setStatusText(
        `Processing ${update.processed}/${update.total}: ${current}`,
      );
    });

    return () => {
      unsubscribe();
    };
  }, [desktopApi, hasDesktopApi]);

  // Organise progress subscription (separate IPC channel — no routing needed).
  useEffect(() => {
    if (!hasDesktopApi) {
      return () => {
        return;
      };
    }

    const unsubscribe = desktopApi.onOrganiseProgress((update) => {
      setOrgProgress(update);
      setOrgLogs((current) => {
        const next = [
          ...current,
          {
            id: crypto.randomUUID(),
            text: `[${update.level.toUpperCase()}] ${update.message}`,
            level: update.level,
          },
        ];
        return next.slice(-250);
      });

      const hasFile =
        typeof update.currentFile === "string" && update.currentFile.length > 0;
      const current = hasFile ? update.currentFile : "organising";
      setOrgStatusText(
        `Organising ${update.processed}/${update.total}: ${current}`,
      );
    });

    return () => {
      unsubscribe();
    };
  }, [desktopApi, hasDesktopApi]);

  useEffect(() => {
    if (isProcessing || completedSummary) {
      return;
    }

    if (!selectedInputFolder && !selectedOutputFolder) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatusText("Missing input and destination folders to proceed");
      return;
    }

    if (!selectedInputFolder) {
      setStatusText("Waiting on input folder");
      return;
    }

    if (!selectedOutputFolder) {
      setStatusText("Waiting on target destination folder");
      return;
    }

    setStatusText("Ready to start processing");
  }, [
    completedSummary,
    isProcessing,
    selectedInputFolder,
    selectedOutputFolder,
  ]);

  useEffect(() => {
    if (!logsContainerRef.current) {
      return;
    }

    logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!orgLogsContainerRef.current) {
      return;
    }

    orgLogsContainerRef.current.scrollTop =
      orgLogsContainerRef.current.scrollHeight;
  }, [orgLogs]);

  // Organise tab idle status text.
  useEffect(() => {
    if (activeJob === "organise" || orgCompletedSummary) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrgStatusText(
      orgSelectedFolder
        ? "Ready to start organising"
        : "Select a folder to organise",
    );
  }, [activeJob, orgCompletedSummary, orgSelectedFolder]);

  // Validate repair tab paths for safety warnings.
  useEffect(() => {
    if (!hasDesktopApi || !selectedInputFolder || !selectedOutputFolder) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPathWarnings([]);
      return;
    }

    const validatePaths = async (): Promise<void> => {
      try {
        const result = await desktopApi.validatePaths(
          selectedInputFolder,
          selectedOutputFolder,
        );
        setPathWarnings(result.errors);
      } catch {
        // Silently ignore validation errors
        setPathWarnings([]);
      }
    };

    void validatePaths();
  }, [desktopApi, hasDesktopApi, selectedInputFolder, selectedOutputFolder]);

  /**
   * @description Shows a temporary dismissing toast notification.
   * @param message Message to display.
   * @returns Nothing.
   */
  const showToast = (message: string): void => {
    const id = crypto.randomUUID();
    setToast({ id, message });
    setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 4000);
  };

  const requestConfirmation = async (
    params: Omit<ConfirmationDialogState, "open">,
  ): Promise<boolean> => {
    return await new Promise<boolean>((resolve) => {
      confirmationResolverRef.current = resolve;
      setConfirmationDialog({
        open: true,
        title: params.title,
        message: params.message,
        confirmLabel: params.confirmLabel,
        cancelLabel: params.cancelLabel,
      });
    });
  };

  const resolveConfirmation = (confirmed: boolean): void => {
    const resolver = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmationDialog(null);
    if (resolver) {
      resolver(confirmed);
    }
  };

  const getCriticalPathWarnings = (
    warnings: Array<{ type: string; message: string }>,
  ): Array<{ type: string; message: string }> => {
    return warnings.filter((warning) => warning.type !== "nonEmpty");
  };

  const validateRepairPaths = async (
    inputPath: string,
    outputPath: string,
  ): Promise<Array<{ type: string; message: string }>> => {
    if (!hasDesktopApi) {
      return [];
    }

    const result = await desktopApi.validatePaths(inputPath, outputPath);
    return result.errors;
  };

  const refreshRepairPathWarnings = async (
    inputPath: string,
    outputPath: string,
  ): Promise<Array<{ type: string; message: string }>> => {
    const errors = await validateRepairPaths(inputPath, outputPath);
    setPathWarnings(errors);
    return errors;
  };

  /**
   * @description Switches to the given tab, or shows a toast if a job is running on another tab.
   * @param tab Target tab identifier.
   * @returns Nothing.
   */
  const handleTabClick = (tab: TabId): void => {
    if (activeJob !== null && tab !== activeTab) {
      const jobLabel = activeJob === "repair" ? "Repair" : "Organise";
      showToast(
        `${jobLabel} is currently running. Please wait until it finishes before switching tabs.`,
      );
      return;
    }

    setActiveTab(tab);
  };

  /**
   * @description Opens the native folder picker and stores selected source folder path.
   * @returns Promise that resolves after selection handling completes.
   */
  const handleInputFolderSelect = async (): Promise<void> => {
    setWarningText(null);
    if (!hasDesktopApi) {
      setWarningText("Desktop API is unavailable.");
      return;
    }

    const picked = await desktopApi.selectFolder(
      "Select Source Takeout Folder",
      lastInputFolder ?? selectedInputFolder ?? undefined,
    );
    if (picked) {
      let nextOutputFolder = selectedOutputFolder;

      if (selectedOutputFolder) {
        const validationErrors = await validateRepairPaths(
          picked,
          selectedOutputFolder,
        );
        const criticalWarnings = getCriticalPathWarnings(validationErrors);

        if (criticalWarnings.length > 0) {
          nextOutputFolder = null;
          setSelectedOutputFolder(null);
          setPathWarnings([]);
          setWarningText(
            `${criticalWarnings.map((warning) => warning.message).join(" ")} The output folder selection was cleared.`,
          );
          setLogs((current) => {
            return [
              ...current,
              {
                id: crypto.randomUUID(),
                text: `[WARN] Cleared output folder because it conflicts with the selected input folder: ${picked}`,
                level: "warn",
              },
            ];
          });
        } else {
          setPathWarnings(validationErrors);
        }
      }

      setCompletedSummary(null);
      setIsReportOpen(false);
      setSelectedInputFolder(picked);
      setLastInputFolder(picked);
      setLogs((current) => {
        return [
          ...current,
          {
            id: crypto.randomUUID(),
            text: `[INFO] Selected input folder: ${picked}`,
            level: "info",
          },
          ...(nextOutputFolder === null && selectedOutputFolder
            ? [
                {
                  id: crypto.randomUUID(),
                  text: `[WARN] Output folder deselected after selecting conflicting input folder.`,
                  level: "warn" as const,
                },
              ]
            : []),
        ];
      });
    }
  };

  /**
   * @description Opens the native folder picker and stores selected destination folder path.
   * @returns Promise that resolves after selection handling completes.
   */
  const handleOutputFolderSelect = async (): Promise<void> => {
    setWarningText(null);
    if (!hasDesktopApi) {
      setWarningText("Desktop API is unavailable.");
      return;
    }

    const picked = await desktopApi.selectFolder(
      "Select Repaired Output Folder",
      lastOutputFolder ?? selectedOutputFolder ?? undefined,
    );
    if (picked) {
      if (selectedInputFolder) {
        const validationErrors = await validateRepairPaths(
          selectedInputFolder,
          picked,
        );
        const criticalWarnings = getCriticalPathWarnings(validationErrors);

        if (criticalWarnings.length > 0) {
          setSelectedOutputFolder(null);
          setPathWarnings([]);
          setWarningText(
            criticalWarnings.map((warning) => warning.message).join(" "),
          );
          setLogs((current) => {
            return [
              ...current,
              {
                id: crypto.randomUUID(),
                text: `[WARN] Rejected output folder because it conflicts with the selected input folder: ${picked}`,
                level: "warn",
              },
            ];
          });
          return;
        }

        setPathWarnings(validationErrors);
      }

      setCompletedSummary(null);
      setIsReportOpen(false);
      setSelectedOutputFolder(picked);
      setLastOutputFolder(picked);
      setLogs((current) => {
        return [
          ...current,
          {
            id: crypto.randomUUID(),
            text: `[INFO] Selected destination folder: ${picked}`,
            level: "info",
          },
        ];
      });
    }
  };

  /**
   * @description Toggles one processing option checkbox.
   * @param key Option key to toggle.
   * @returns Nothing.
   */
  const handleOptionToggle = async (
    key: keyof ProcessOptions,
  ): Promise<void> => {
    if (key === "ignoreZeroCoordinates" && options.ignoreZeroCoordinates) {
      const confirmed = await requestConfirmation({
        title: "Disable 0,0 Filtering?",
        message:
          "By default, 0,0 coordinates are ignored. Turning this off will write 0,0 as valid coordinates into your files.",
        confirmLabel: "Disable filter",
        cancelLabel: "Keep enabled",
      });
      if (!confirmed) {
        return;
      }
    }

    setOptions((current) => {
      if (key === "ignoreZeroCoordinates") {
        return {
          ...current,
          ignoreZeroCoordinates: !current.ignoreZeroCoordinates,
        };
      }

      if (key === "createYearSubfoldersOnly") {
        const nextYearOnly = !current.createYearSubfoldersOnly;
        return {
          ...current,
          createYearSubfoldersOnly: nextYearOnly,
          createYearMonthSubfolders: nextYearOnly
            ? false
            : current.createYearMonthSubfolders,
        };
      }

      if (key === "createYearMonthSubfolders") {
        const nextYearMonth = !current.createYearMonthSubfolders;
        return {
          ...current,
          createYearMonthSubfolders: nextYearMonth,
          createYearSubfoldersOnly: nextYearMonth
            ? false
            : current.createYearSubfoldersOnly,
        };
      }

      return {
        ...current,
        [key]: !current[key],
      };
    });
  };

  /**
   * @description Validates state and starts folder processing through the Electron bridge.
   * @returns Promise that resolves when processing call completes.
   */
  const handleStartProcessing = async (): Promise<void> => {
    setWarningText(null);

    if (!selectedInputFolder) {
      setWarningText(
        "No input folder selected. Please choose a Google Takeout folder.",
      );
      return;
    }

    if (!selectedOutputFolder) {
      setWarningText(
        "No destination folder selected. Please choose an output folder.",
      );
      return;
    }

    const actionsEnabled =
      options.writeMetadata ||
      options.createYearMonthSubfolders ||
      options.createYearSubfoldersOnly;
    if (!actionsEnabled) {
      setWarningText("At least one processing action must be enabled.");
      return;
    }

    const currentPathWarnings = await refreshRepairPathWarnings(
      selectedInputFolder,
      selectedOutputFolder,
    );

    // Check for critical path validation errors
    const criticalPathErrors = getCriticalPathWarnings(currentPathWarnings);
    if (criticalPathErrors.length > 0) {
      setWarningText(
        `Cannot proceed: ${criticalPathErrors.map((e) => e.message).join(" ")}`,
      );
      return;
    }

    // Show confirmation if non-empty output folder
    const nonEmptyWarning = currentPathWarnings.find(
      (warning) => warning.type === "nonEmpty",
    );
    if (nonEmptyWarning) {
      const confirmed = await requestConfirmation({
        title: "Output Folder Not Empty",
        message: `${nonEmptyWarning.message} Continue anyway?`,
        confirmLabel: "Continue",
        cancelLabel: "Cancel",
      });
      if (!confirmed) {
        return;
      }
    }

    if (!hasDesktopApi) {
      setWarningText("Desktop API is unavailable.");
      return;
    }

    setIsProcessing(true);
    setIsAbortRequested(false);
    setActiveJob("repair");
    setIsReportOpen(false);
    setCompletedSummary(null);
    setStatusText("Starting processing...");
    setProgress({
      processed: 0,
      total: 0,
      currentFile: null,
      level: "info",
      message: "",
    });
    setLogs([
      {
        id: crypto.randomUUID(),
        text: "[INFO] Processing started",
        level: "info",
      },
    ]);

    try {
      const summary = await desktopApi.processFolder({
        inputPath: selectedInputFolder,
        outputPath: selectedOutputFolder,
        options,
      });

      const roundedSeconds = (summary.durationMs / 1000).toFixed(1);
      setCompletedSummary(summary);
      setIsReportOpen(true);
      const postRunWarnings = await refreshRepairPathWarnings(
        selectedInputFolder,
        selectedOutputFolder,
      );
      const postRunNonEmptyWarning = postRunWarnings.find(
        (warning) => warning.type === "nonEmpty",
      );
      if (postRunNonEmptyWarning) {
        setWarningText(postRunNonEmptyWarning.message);
      }
      setProgress({
        processed: summary.processed,
        total: summary.total,
        currentFile: null,
        level: "info",
        message: "Processing complete",
      });
      setStatusText(
        `Done. ${summary.processed}/${summary.total} files processed in ${roundedSeconds}s.`,
      );
      setLogs((current) => {
        const next: Array<LogEntry> = [
          ...current,
          {
            id: crypto.randomUUID(),
            text: `[INFO] Removed ${summary.jsonRemoved} JSON sidecar files.`,
            level: "info",
          },
        ];

        for (const warning of summary.warnings) {
          next.push({
            id: crypto.randomUUID(),
            text: `[WARN] ${warning}`,
            level: "warn",
          });
        }

        return next.slice(-250);
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unexpected processing error";
      const wasAborted = message === PROCESS_ABORTED_MESSAGE;
      setWarningText(wasAborted ? null : message);
      setStatusText(wasAborted ? "Processing aborted." : "Processing failed.");
      setLogs((current) => {
        const next: Array<LogEntry> = [
          ...current,
          {
            id: crypto.randomUUID(),
            text: wasAborted
              ? `[WARN] ${PROCESS_ABORTED_MESSAGE}`
              : `[ERROR] ${message}`,
            level: wasAborted ? "warn" : "error",
          },
        ];

        return next;
      });
    } finally {
      setIsProcessing(false);
      setIsAbortRequested(false);
      setActiveJob(null);
    }
  };

  /**
   * @description Requests cancellation for the active repair run.
   * @returns Promise that resolves after the abort request is sent.
   */
  const handleAbortProcessing = async (): Promise<void> => {
    if (!hasDesktopApi || !isProcessing) {
      return;
    }

    setWarningText(null);
    setIsAbortRequested(true);
    setStatusText("Abort requested. Finishing current step...");

    try {
      const aborted = await desktopApi.abortProcess();
      if (!aborted) {
        setIsAbortRequested(false);
        setStatusText("No active repair run to abort.");
        setLogs((current) => {
          const next: Array<LogEntry> = [
            ...current,
            {
              id: crypto.randomUUID(),
              text: "[WARN] No active repair run was found for abort.",
              level: "warn",
            },
          ];

          return next.slice(-250);
        });
        return;
      }

      setLogs((current) => {
        const next: Array<LogEntry> = [
          ...current,
          {
            id: crypto.randomUUID(),
            text: "[WARN] Abort requested by user.",
            level: "warn",
          },
        ];

        return next.slice(-250);
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to request abort.";
      setIsAbortRequested(false);
      setWarningText(message);
      setStatusText("Unable to send abort request.");
    }
  };

  /**
   * @description Clears the completed run state so a new queue can be started.
   * @returns Nothing.
   */
  const handleResetQueue = (): void => {
    setLastInputFolder((current) => {
      return selectedInputFolder ?? current;
    });
    setLastOutputFolder((current) => {
      return selectedOutputFolder ?? current;
    });
    setSelectedInputFolder(null);
    setSelectedOutputFolder(null);
    setCompletedSummary(null);
    setIsReportOpen(false);
    setWarningText(null);
    setProgress({
      processed: 0,
      total: 0,
      currentFile: null,
      level: "info",
      message: "",
    });
    setLogs([]);
  };

  /**
   * @description Opens the native folder picker and stores the organise target folder path.
   * @returns Promise that resolves after selection handling completes.
   */
  const handleOrgFolderSelect = async (): Promise<void> => {
    setOrgWarningText(null);
    if (!hasDesktopApi) {
      setOrgWarningText("Desktop API is unavailable.");
      return;
    }

    const picked = await desktopApi.selectFolder(
      "Select Folder to Organise",
      orgLastFolder ?? orgSelectedFolder ?? undefined,
    );
    if (picked) {
      setOrgCompletedSummary(null);
      setOrgIsReportOpen(false);
      setOrgSelectedFolder(picked);
      setOrgLastFolder(picked);
      setOrgLogs((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          text: `[INFO] Selected folder to organise: ${picked}`,
          level: "info" as const,
        },
      ]);
    }
  };

  /**
   * @description Toggles one organise option checkbox.
   * @param key Option key to toggle.
   * @returns Nothing.
   */
  const handleOrgOptionToggle = (key: keyof PostProcessOptions): void => {
    setOrgOptions((current) => {
      const next = { ...current, [key]: !current[key] };
      // All six folder-action options are mutually exclusive.
      const FOLDER_ACTION_KEYS: Array<keyof PostProcessOptions> = [
        "flattenMonthsToYears",
        "flattenAllToRoot",
        "flattenIntoHalves",
        "writeModifiedToCreated",
        "writeCreatedToModified",
        "coerceBothToLowest",
      ];
      if (FOLDER_ACTION_KEYS.includes(key) && next[key]) {
        for (const other of FOLDER_ACTION_KEYS) {
          if (other !== key) {
            next[other] = false;
          }
        }
      }
      return next;
    });
  };

  const hasFolderActionSelected =
    orgOptions.flattenMonthsToYears ||
    orgOptions.flattenAllToRoot ||
    Boolean(orgOptions.flattenIntoHalves) ||
    Boolean(orgOptions.writeModifiedToCreated) ||
    Boolean(orgOptions.writeCreatedToModified) ||
    Boolean(orgOptions.coerceBothToLowest);

  /**
   * @description Validates state and starts folder organisation through the Electron bridge.
   * @returns Promise that resolves when the operation completes.
   */
  const handleOrgStart = async (): Promise<void> => {
    setOrgWarningText(null);

    if (!orgSelectedFolder) {
      setOrgWarningText(
        "No folder selected. Please choose a folder to organise.",
      );
      return;
    }

    if (!hasFolderActionSelected) {
      setOrgWarningText("Select a folder action before starting.");
      return;
    }

    if (!hasDesktopApi) {
      setOrgWarningText("Desktop API is unavailable.");
      return;
    }

    setActiveJob("organise");
    setOrgIsReportOpen(false);
    setOrgCompletedSummary(null);
    setOrgStatusText("Starting organisation\u2026");
    setOrgProgress({
      processed: 0,
      total: 0,
      currentFile: null,
      level: "info",
      message: "",
    });
    setOrgLogs([
      {
        id: crypto.randomUUID(),
        text: "[INFO] Organisation started",
        level: "info",
      },
    ]);

    try {
      const summary = await desktopApi.postProcessFolder({
        targetPath: orgSelectedFolder,
        options: orgOptions,
      });

      const roundedSeconds = (summary.durationMs / 1000).toFixed(1);
      setOrgCompletedSummary(summary);
      setOrgIsReportOpen(true);
      setOrgProgress({
        processed: summary.report.movedFilesCount,
        total: Math.max(summary.report.movedFilesCount, 1),
        currentFile: null,
        level: "info",
        message: "Organisation complete",
      });
      setOrgStatusText(
        `Done. ${summary.report.movedFilesCount} files moved in ${roundedSeconds}s.`,
      );
      setOrgLogs((current) => {
        const next: Array<LogEntry> = [
          ...current,
          {
            id: crypto.randomUUID(),
            text: `[INFO] Moved ${summary.report.movedFilesCount} files, removed ${summary.report.removedFoldersCount} empty folders.`,
            level: "info",
          },
        ];
        for (const warning of summary.warnings) {
          next.push({
            id: crypto.randomUUID(),
            text: `[WARN] ${warning}`,
            level: "warn",
          });
        }
        return next.slice(-250);
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unexpected organisation error";
      setOrgWarningText(message);
      setOrgStatusText("Organisation failed.");
      setOrgLogs((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          text: `[ERROR] ${message}`,
          level: "error" as const,
        },
      ]);
    } finally {
      setActiveJob(null);
    }
  };

  const handleApplyOrgTempReview = async (): Promise<void> => {
    if (!hasDesktopApi || !orgCompletedSummary) {
      return;
    }

    const tempFolderPath = orgCompletedSummary.report.tempFolderPath;
    if (!tempFolderPath) {
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Apply Reviewed Result?",
      message:
        "Apply the reviewed temporary organisation result to the selected folder? This will replace the original folder contents.",
      confirmLabel: "Apply",
      cancelLabel: "Cancel",
    });
    if (!confirmed) {
      return;
    }

    setOrgWarningText(null);
    setIsApplyingOrgTempReview(true);
    setActiveJob("organise");

    try {
      const result = await desktopApi.finalizeTempOrganise({
        targetPath: orgCompletedSummary.report.targetPath,
        tempFolderPath,
      });

      if (result.applied) {
        setOrgCompletedSummary((current) => {
          if (!current) {
            return current;
          }

          const nextReport = {
            targetPath: current.report.targetPath,
            movedFilesCount: current.report.movedFilesCount,
            removedFoldersCount: current.report.removedFoldersCount,
            problemFiles: current.report.problemFiles,
          };

          return {
            ...current,
            report: {
              ...nextReport,
              targetPath: result.targetPath,
            },
          };
        });
        setOrgStatusText("Reviewed organisation result applied.");
        setOrgLogs((current): LogEntry[] => {
          const entry: LogEntry = {
            id: crypto.randomUUID(),
            text: `[INFO] Reviewed organisation result applied to ${result.targetPath}`,
            level: "info",
          };

          return [...current, entry].slice(-250);
        });
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to apply reviewed organisation result.";
      setOrgWarningText(message);
      setOrgLogs((current): LogEntry[] => {
        const entry: LogEntry = {
          id: crypto.randomUUID(),
          text: `[ERROR] ${message}`,
          level: "error",
        };

        return [...current, entry].slice(-250);
      });
    } finally {
      setIsApplyingOrgTempReview(false);
      setActiveJob(null);
    }
  };

  /**
   * @description Resets organise tab state so a new folder can be selected.
   * @returns Nothing.
   */
  const handleOrgResetQueue = (): void => {
    setOrgLastFolder(orgSelectedFolder);
    setOrgSelectedFolder(null);
    setOrgCompletedSummary(null);
    setOrgIsReportOpen(false);
    setOrgWarningText(null);
    setOrgProgress({
      processed: 0,
      total: 0,
      currentFile: null,
      level: "info",
      message: "",
    });
    setOrgLogs([]);
  };

  const percent =
    progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;
  const isReadyToStartStatus = statusText === "Ready to start processing";
  const canStartNewQueue =
    !isProcessing && completedSummary !== null && percent >= 100;

  const isOrgProcessing = activeJob === "organise";
  const orgPercent =
    orgProgress.total > 0
      ? Math.round((orgProgress.processed / orgProgress.total) * 100)
      : 0;
  const orgCanReset = !isOrgProcessing && orgCompletedSummary !== null;

  const handleThemeToggle = (): void => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
    setIsThemePinned(true);
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden overflow-y-auto bg-[var(--app-bg)] text-[var(--app-text)]">
      <div className="app-backdrop pointer-events-none absolute inset-0" />
      <div className="space-aurora pointer-events-none absolute inset-0" />
      <div className="space-aurora-secondary pointer-events-none absolute inset-0" />
      <div className="space-stars pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-start px-4 py-6 sm:px-8">
        <section className="glass-panel w-full animate-rise rounded-3xl border p-4 sm:p-6">
          <header
            className={`mb-5 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between ${isLightTheme ? "border-[#5f7faf]/28" : "border-[#61afef]/20"}`}
          >
            <div>
              <p
                className={`font-body text-xs uppercase tracking-[0.25em] ${isLightTheme ? "text-[#3c6ea7]" : "text-[#61afef]/80"}`}
              >
                Google Takeout Repair Tool
                <span className="ml-2 normal-case tracking-normal opacity-50">
                  v{__APP_VERSION__}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <h1
                  className={`font-display text-3xl font-semibold sm:text-4xl ${isLightTheme ? "text-[#7a5a1d]" : "text-[#e5c07b]"}`}
                >
                  Repair Studio
                </h1>
                <div className="relative">
                  <button
                    ref={infoButtonRef}
                    type="button"
                    aria-label="How to use this app"
                    onClick={() => {
                      setIsInfoOpen((v) => !v);
                    }}
                    className={`mt-1 rounded-full p-1 transition focus:outline-none focus-visible:ring-2 ${isLightTheme ? "text-[#916f2b]/80 hover:bg-[#8b6a2b]/14 hover:text-[#7a5a1d] focus-visible:ring-[#a77f2e]/40" : "text-[#e5c07b]/70 hover:bg-[#e5c07b]/10 hover:text-[#e5c07b] focus-visible:ring-[#e5c07b]/50"}`}
                  >
                    <Info size={18} strokeWidth={2} />
                  </button>
                  {isInfoOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => {
                          setIsInfoOpen(false);
                        }}
                      />
                      <div
                        className={`absolute left-0 top-full z-50 mt-2 w-80 rounded-2xl border p-4 shadow-xl backdrop-blur-md sm:w-96 ${isLightTheme ? "border-[#9b7b37]/25 bg-[#f8fbff]/96" : "border-[#e5c07b]/25 bg-[#1b2030]/95"}`}
                      >
                        <p
                          className={`mb-3 font-display text-sm font-semibold uppercase tracking-widest ${isLightTheme ? "text-[#8f6d28]" : "text-[#e5c07b]/80"}`}
                        >
                          Getting started
                        </p>

                        <div className="mb-3 rounded-xl border border-[#61afef]/20 bg-[#252b38]/70 p-3">
                          <p className="mb-1.5 font-body text-xs font-semibold uppercase tracking-wider text-[#61afef]">
                            1 — Prepare your Takeout data
                          </p>
                          <ul className="space-y-1.5 font-body text-xs leading-relaxed text-[#c8d0dd]/85">
                            <li>
                              • Go to{" "}
                              <span className="text-[#56b6c2]">
                                takeout.google.com
                              </span>{" "}
                              and request a download of{" "}
                              <span className="text-[#d7deea]">
                                Google Photos
                              </span>
                              .
                            </li>
                            <li>
                              • Download the archive(s) and{" "}
                              <span className="text-[#e5c07b] font-medium">
                                extract them
                              </span>{" "}
                              — do not point the app at a .zip or .tgz file.
                            </li>
                            <li>
                              • The extracted folder typically contains a{" "}
                              <span className="text-[#d7deea]">
                                Google Photos
                              </span>{" "}
                              subfolder with year-based sub‑folders inside.
                            </li>
                            <li>
                              •{" "}
                              <span className="text-[#98c379] font-medium">
                                All child folders are scanned automatically
                              </span>{" "}
                              — you only need to select the top‑level folder.
                            </li>
                          </ul>
                        </div>

                        <div className="rounded-xl border border-[#c678dd]/20 bg-[#252b38]/70 p-3">
                          <p className="mb-1.5 font-body text-xs font-semibold uppercase tracking-wider text-[#c678dd]">
                            2 — Using the app
                          </p>
                          <ol className="space-y-1.5 font-body text-xs leading-relaxed text-[#c8d0dd]/85">
                            <li>
                              <span className="text-[#d7deea] font-medium">
                                ①
                              </span>{" "}
                              Click{" "}
                              <span className="text-[#d7deea]">
                                Select Source Takeout Folder
                              </span>{" "}
                              and pick your extracted Takeout directory.
                            </li>
                            <li>
                              <span className="text-[#d7deea] font-medium">
                                ②
                              </span>{" "}
                              Click{" "}
                              <span className="text-[#d7deea]">
                                Select Repaired Output Folder
                              </span>{" "}
                              to choose where fixed files will be written.
                            </li>
                            <li>
                              <span className="text-[#d7deea] font-medium">
                                ③
                              </span>{" "}
                              Expand{" "}
                              <span className="text-[#d7deea]">
                                Repair options
                              </span>{" "}
                              to enable or disable individual fixes.
                            </li>
                            <li>
                              <span className="text-[#d7deea] font-medium">
                                ④
                              </span>{" "}
                              Click{" "}
                              <span className="text-[#98c379] font-medium">
                                Start Repair Run
                              </span>
                              . Progress and logs appear below.
                            </li>
                            <li>
                              <span className="text-[#d7deea] font-medium">
                                ⑤
                              </span>{" "}
                              When done, click{" "}
                              <span className="text-[#d7deea]">
                                View Report
                              </span>{" "}
                              to inspect detailed results.
                            </li>
                          </ol>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setIsInfoOpen(false);
                          }}
                          className={`mt-3 w-full rounded-xl border py-1.5 font-body text-xs transition ${isLightTheme ? "border-[#4f88be]/35 text-[#3f709f] hover:border-[#3f709f]/55 hover:text-[#355f88]" : "border-[#56b6c2]/20 text-[#56b6c2]/70 hover:border-[#56b6c2]/40 hover:text-[#56b6c2]"}`}
                        >
                          Close
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 sm:items-end">
              <p
                className={`max-w-sm font-body text-sm ${isLightTheme ? "text-[#4a5e78]" : "text-[#c8d0dd]/80"}`}
              >
                A local-first recovery workflow for damaged or messy Takeout
                exports.
              </p>
              <button
                type="button"
                onClick={handleThemeToggle}
                aria-label={
                  theme === "dark"
                    ? "Switch to light theme"
                    : "Switch to dark theme"
                }
                title={
                  theme === "dark"
                    ? "Switch to light theme"
                    : "Switch to dark theme"
                }
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition focus:outline-none focus-visible:ring-2 ${isLightTheme ? "border-[#5682b3]/35 bg-[#f4f8ff]/90 text-[#496f99] hover:border-[#3f6894] hover:bg-[#edf4ff] focus-visible:ring-[#4d77a5]/45" : "border-[#61afef]/35 bg-[#232a38]/88 text-[#cdd8e8] hover:border-[#56b6c2]/70 hover:bg-[#2b3446] focus-visible:ring-[#56b6c2]/45"}`}
              >
                {theme === "dark" ? (
                  <Sun className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Moon className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </header>

          {/* ── Tab bar ──────────────────────────────────────────────────── */}
          <div
            className={`mt-4 flex rounded-2xl border p-1 ${isLightTheme ? "border-[#5f8dbf]/30 bg-[#f0f5ff]" : "border-[#61afef]/20 bg-[#1f2530]/70"}`}
          >
            <button
              type="button"
              onClick={() => {
                handleTabClick("repair");
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-display text-base font-semibold transition focus:outline-none focus-visible:ring-2 ${
                activeTab === "repair"
                  ? isLightTheme
                    ? "border border-[#5f8dbf]/25 bg-white text-[#2f3f56] shadow-sm"
                    : "border border-[#61afef]/25 bg-[#2a3140] text-white shadow-sm"
                  : isLightTheme
                    ? "text-[#4a607c] hover:text-[#2f3f56]"
                    : "text-[#abb2bf]/75 hover:text-[#d7deea]"
              } focus-visible:ring-[#56b6c2]/45`}
            >
              <Wrench className="h-4 w-4" aria-hidden="true" />
              Repair
            </button>
            <button
              type="button"
              onClick={() => {
                handleTabClick("organise");
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-display text-base font-semibold transition focus:outline-none focus-visible:ring-2 ${
                activeTab === "organise"
                  ? isLightTheme
                    ? "border border-[#5f8dbf]/25 bg-white text-[#2f3f56] shadow-sm"
                    : "border border-[#61afef]/25 bg-[#2a3140] text-white shadow-sm"
                  : isLightTheme
                    ? "text-[#4a607c] hover:text-[#2f3f56]"
                    : "text-[#abb2bf]/75 hover:text-[#d7deea]"
              } focus-visible:ring-[#56b6c2]/45`}
            >
              <Layers2 className="h-4 w-4" aria-hidden="true" />
              Organise
            </button>
          </div>

          {/* ── Repair tab ───────────────────────────────────────────────── */}
          {activeTab === "repair" && (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => {
                      void handleInputFolderSelect();
                    }}
                    disabled={isProcessing}
                    className={`group w-full rounded-2xl border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f9fbff]/88 hover:border-[#6f6ed0]/58 hover:bg-[#f0f5ff]" : "border-[#61afef]/25 bg-[#2a3140]/70 hover:border-[#c678dd]/65 hover:bg-[#31394b]/85"}`}
                  >
                    <p
                      className={`inline-flex items-center gap-2 font-display text-lg ${isLightTheme ? "text-[#7a5a1d]" : "text-[#e5c07b]"}`}
                    >
                      <FolderOpen className="h-5 w-5" aria-hidden="true" />
                      Select Source Folder
                    </p>
                    <p
                      className={`mt-1 truncate font-body text-sm ${isLightTheme ? "text-[#4b607c]" : "text-[#abb2bf]/85"}`}
                    >
                      {selectedInputFolder
                        ? selectedInputFolder
                        : "No source folder selected"}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleOutputFolderSelect();
                    }}
                    disabled={isProcessing}
                    className={`group w-full rounded-2xl border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f9fbff]/88 hover:border-[#6f6ed0]/58 hover:bg-[#f0f5ff]" : "border-[#61afef]/25 bg-[#2a3140]/70 hover:border-[#c678dd]/65 hover:bg-[#31394b]/85"}`}
                  >
                    <p
                      className={`inline-flex items-center gap-2 font-display text-lg ${isLightTheme ? "text-[#7a5a1d]" : "text-[#e5c07b]"}`}
                    >
                      <FolderOpen className="h-5 w-5" aria-hidden="true" />
                      Select Output Folder
                    </p>
                    <p
                      className={`mt-1 truncate font-body text-sm ${isLightTheme ? "text-[#4b607c]" : "text-[#abb2bf]/85"}`}
                    >
                      {selectedOutputFolder
                        ? selectedOutputFolder
                        : "No output folder selected"}
                    </p>
                  </button>
                </div>

                <aside
                  className={`rounded-2xl border p-3 ${isLightTheme ? "border-[#7d78d2]/35 bg-[#f6f9ff]/92" : "border-[#c678dd]/35 bg-[#252b38]/70"}`}
                >
                  <p
                    className={`mb-2 px-1 font-body text-xs uppercase tracking-[0.2em] ${isLightTheme ? "text-[#6d67bc]" : "text-[#c678dd]/90"}`}
                  >
                    Repair actions
                  </p>
                  <Accordion theme={theme}>
                    <AccordionItem
                      value="processing-options"
                      title="Repair options"
                      theme={theme}
                    >
                      <div className="grid grid-cols-1 gap-3">
                        <label
                          className={`option-row ${isProcessing ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                        >
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={options.writeMetadata}
                            onChange={() => {
                              void handleOptionToggle("writeMetadata");
                            }}
                            disabled={isProcessing}
                          />
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-transparent shadow-[inset_0_0_0_1px_rgba(86,182,194,0.22)] transition peer-checked:border-[#56b6c2]/90 peer-checked:bg-gradient-to-br peer-checked:from-[#56b6c2] peer-checked:via-[#61afef] peer-checked:to-[#c678dd] peer-checked:text-[#1b1f2a] peer-focus-visible:ring-2 ${isLightTheme ? "border-[#5a87b9]/45 bg-[#f3f8ff] peer-focus-visible:ring-[#7084dd]/45" : "border-[#61afef]/45 bg-[#1f2430]/85 peer-focus-visible:ring-[#c678dd]/60"}`}
                          >
                            <svg
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M5 12.5L9.5 17L19 7.5"
                                stroke="currentColor"
                                strokeWidth="2.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <div className="relative ml-0.5 inline-flex items-center gap-2">
                            <span
                              className={`font-body text-lg ${isLightTheme ? "text-[#2f3f56]" : "text-[#d7deea]"}`}
                            >
                              Restore metadata
                            </span>
                            <span className="group/metadata-help relative inline-flex h-5 w-5 items-center justify-center">
                              <Info
                                className={`h-4 w-4 ${isLightTheme ? "text-[#5b7ea7]" : "text-[#8dbde8]"}`}
                                aria-hidden="true"
                              />
                              <span
                                className={`pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-72 -translate-y-1/2 rounded-xl border p-3 text-left font-body text-xs leading-relaxed opacity-0 shadow-lg transition group-hover/metadata-help:opacity-100 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff] text-[#395170]" : "border-[#61afef]/30 bg-[#1f2634]/95 text-[#c7d4e7]"}`}
                              >
                                Restores sidecar-based metadata by:
                                <br />
                                - writing capture date/time from the Takeout
                                sidecar
                                <br />
                                - mirroring date, title, and description across
                                compatible metadata formats
                                <br />
                                - writing GPS coordinates and altitude when
                                available
                                <br />- matching sidecar JSON files using exact,
                                fuzzy, and title-based strategies
                                <br />- applying confidence thresholds so
                                low-confidence matches are skipped to avoid
                                incorrect metadata links
                                <br />( photo.jpg vs
                                photo.jpg.supplemental-meta.json: High score,
                                accepted. photo.jpg vs metadata.json: Low score,
                                rejected. )
                                <br />- ignoring 0,0 Google Takeout placeholders
                                when enabled below
                                <br />- syncing the file modified time from the
                                trusted sidecar capture timestamp
                                <br />- restoring the .MOV extension for
                                QuickTime-branded files
                                <br />- skipping date restoration when no
                                trusted sidecar timestamp is available
                              </span>
                            </span>
                          </div>
                        </label>

                        <label
                          className={`option-row ${isProcessing ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                        >
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={options.ignoreZeroCoordinates}
                            onChange={() => {
                              void handleOptionToggle("ignoreZeroCoordinates");
                            }}
                            disabled={isProcessing}
                          />
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-transparent shadow-[inset_0_0_0_1px_rgba(86,182,194,0.22)] transition peer-checked:border-[#56b6c2]/90 peer-checked:bg-gradient-to-br peer-checked:from-[#56b6c2] peer-checked:via-[#61afef] peer-checked:to-[#c678dd] peer-checked:text-[#1b1f2a] peer-focus-visible:ring-2 ${isLightTheme ? "border-[#5a87b9]/45 bg-[#f3f8ff] peer-focus-visible:ring-[#7084dd]/45" : "border-[#61afef]/45 bg-[#1f2430]/85 peer-focus-visible:ring-[#c678dd]/60"}`}
                          >
                            <svg
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M5 12.5L9.5 17L19 7.5"
                                stroke="currentColor"
                                strokeWidth="2.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <div className="relative ml-0.5 inline-flex items-center gap-2">
                            <span
                              className={`font-body text-lg ${isLightTheme ? "text-[#2f3f56]" : "text-[#d7deea]"}`}
                            >
                              Ignore 0,0 geolocation values
                            </span>
                            <span className="group/geo-zero-help relative inline-flex h-5 w-5 items-center justify-center">
                              <Info
                                className={`h-4 w-4 ${isLightTheme ? "text-[#5b7ea7]" : "text-[#8dbde8]"}`}
                                aria-hidden="true"
                              />
                              <span
                                className={`pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-72 -translate-y-1/2 rounded-xl border p-3 text-left font-body text-xs leading-relaxed opacity-0 shadow-lg transition group-hover/geo-zero-help:opacity-100 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff] text-[#395170]" : "border-[#61afef]/30 bg-[#1f2634]/95 text-[#c7d4e7]"}`}
                              >
                                Google Takeout often stores missing locations as
                                0,0. When this option is on, these placeholder
                                coordinates are ignored so destination files do
                                not receive false GPS positions.
                              </span>
                            </span>
                          </div>
                        </label>

                        <label
                          className={`option-row ${isProcessing ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                        >
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={options.matchVariantSidecars}
                            onChange={() => {
                              void handleOptionToggle("matchVariantSidecars");
                            }}
                            disabled={isProcessing}
                          />
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-transparent shadow-[inset_0_0_0_1px_rgba(86,182,194,0.22)] transition peer-checked:border-[#56b6c2]/90 peer-checked:bg-gradient-to-br peer-checked:from-[#56b6c2] peer-checked:via-[#61afef] peer-checked:to-[#c678dd] peer-checked:text-[#1b1f2a] peer-focus-visible:ring-2 ${isLightTheme ? "border-[#5a87b9]/45 bg-[#f3f8ff] peer-focus-visible:ring-[#7084dd]/45" : "border-[#61afef]/45 bg-[#1f2430]/85 peer-focus-visible:ring-[#c678dd]/60"}`}
                          >
                            <svg
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M5 12.5L9.5 17L19 7.5"
                                stroke="currentColor"
                                strokeWidth="2.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <div className="relative ml-0.5 inline-flex items-center gap-2">
                            <span
                              className={`font-body text-lg ${isLightTheme ? "text-[#2f3f56]" : "text-[#d7deea]"}`}
                            >
                              Match .json to edited and copied files
                            </span>
                            <span className="group/variant-help relative inline-flex h-5 w-5 items-center justify-center">
                              <Info
                                className={`h-4 w-4 ${isLightTheme ? "text-[#5b7ea7]" : "text-[#8dbde8]"}`}
                                aria-hidden="true"
                              />
                              <span
                                className={`pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-72 -translate-y-1/2 rounded-xl border p-3 text-left font-body text-xs leading-relaxed opacity-0 shadow-lg transition group-hover/variant-help:opacity-100 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff] text-[#395170]" : "border-[#61afef]/30 bg-[#1f2634]/95 text-[#c7d4e7]"}`}
                              >
                                When enabled, if a sidecar JSON (JSON file
                                provided by Google Takeout) is matched for an
                                original file (e.g. 123.jpg → 123.json), the
                                same JSON is also applied to edited and
                                duplicate variants of that file — such as
                                123-edited.jpg and 123(1).jpg. This ensures
                                edited and copied versions receive the correct
                                capture date and metadata even when no dedicated
                                sidecar exists for them.
                              </span>
                            </span>
                          </div>
                        </label>

                        <label
                          className={`option-row ${isProcessing ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                        >
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={options.createYearMonthSubfolders}
                            onChange={() => {
                              void handleOptionToggle(
                                "createYearMonthSubfolders",
                              );
                            }}
                            disabled={isProcessing}
                          />
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-transparent shadow-[inset_0_0_0_1px_rgba(86,182,194,0.22)] transition peer-checked:border-[#56b6c2]/90 peer-checked:bg-gradient-to-br peer-checked:from-[#56b6c2] peer-checked:via-[#61afef] peer-checked:to-[#c678dd] peer-checked:text-[#1b1f2a] peer-focus-visible:ring-2 ${isLightTheme ? "border-[#5a87b9]/45 bg-[#f3f8ff] peer-focus-visible:ring-[#7084dd]/45" : "border-[#61afef]/45 bg-[#1f2430]/85 peer-focus-visible:ring-[#c678dd]/60"}`}
                          >
                            <svg
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M5 12.5L9.5 17L19 7.5"
                                stroke="currentColor"
                                strokeWidth="2.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span
                            className={`font-body text-lg ${isLightTheme ? "text-[#2f3f56]" : "text-[#d7deea]"}`}
                          >
                            Create year-month subfolders
                          </span>
                        </label>

                        <label
                          className={`option-row ${isProcessing ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                        >
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={options.createYearSubfoldersOnly}
                            onChange={() => {
                              void handleOptionToggle(
                                "createYearSubfoldersOnly",
                              );
                            }}
                            disabled={isProcessing}
                          />
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-transparent shadow-[inset_0_0_0_1px_rgba(86,182,194,0.22)] transition peer-checked:border-[#56b6c2]/90 peer-checked:bg-gradient-to-br peer-checked:from-[#56b6c2] peer-checked:via-[#61afef] peer-checked:to-[#c678dd] peer-checked:text-[#1b1f2a] peer-focus-visible:ring-2 ${isLightTheme ? "border-[#5a87b9]/45 bg-[#f3f8ff] peer-focus-visible:ring-[#7084dd]/45" : "border-[#61afef]/45 bg-[#1f2430]/85 peer-focus-visible:ring-[#c678dd]/60"}`}
                          >
                            <svg
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M5 12.5L9.5 17L19 7.5"
                                stroke="currentColor"
                                strokeWidth="2.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span
                            className={`font-body text-lg ${isLightTheme ? "text-[#2f3f56]" : "text-[#d7deea]"}`}
                          >
                            Create year subfolders only
                          </span>
                        </label>
                      </div>
                    </AccordionItem>
                  </Accordion>
                </aside>
              </div>

              {/* ── Path safety warnings ──────────────────────────────── */}
              {pathWarnings.length > 0 && (
                <div className="mt-4 space-y-2">
                  {pathWarnings.map((warning) => {
                    const isCritical = warning.type !== "nonEmpty";
                    return (
                      <div
                        key={`${warning.type}-${warning.message}`}
                        className={`rounded-xl border px-3 py-2 font-body text-sm ${isCritical ? (isLightTheme ? "border-rose-300/38 bg-rose-100/70 text-rose-700" : "border-rose-300/30 bg-rose-500/10 text-rose-200") : isLightTheme ? "border-amber-300/38 bg-amber-100/60 text-amber-700" : "border-amber-400/30 bg-amber-500/12 text-amber-200"}`}
                      >
                        {isCritical ? (
                          <strong>Error:</strong>
                        ) : (
                          <strong>Warning:</strong>
                        )}{" "}
                        {warning.message}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex h-full flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void handleStartProcessing();
                    }}
                    disabled={
                      isProcessing ||
                      !selectedInputFolder ||
                      !selectedOutputFolder
                    }
                    className={`inline-flex h-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#56b6c2] via-[#61afef] to-[#c678dd] px-4 py-3 font-display text-xl font-semibold text-[#1b1f2a] transition hover:from-[#7ad0da] hover:via-[#83c3ff] hover:to-[#d99bf0] disabled:cursor-not-allowed disabled:text-[#8f97a6] ${isLightTheme ? "disabled:from-[#c6cdd8] disabled:via-[#c6cdd8] disabled:to-[#c6cdd8]" : "disabled:from-[#5a6271] disabled:via-[#5a6271] disabled:to-[#5a6271] disabled:text-[#c5ccd9]"} ${isReadyToStartStatus && !isProcessing ? "ready-start-glow" : ""}`}
                  >
                    {isProcessing ? (
                      <LoaderCircle
                        className="h-5 w-5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Rocket className="h-5 w-5" aria-hidden="true" />
                    )}
                    {isProcessing ? "Repairing..." : "Start Repair Run"}
                  </button>

                  {isProcessing ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleAbortProcessing();
                      }}
                      disabled={isAbortRequested}
                      className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 font-display text-lg font-semibold transition disabled:cursor-not-allowed ${isLightTheme ? "border-rose-400/45 bg-rose-100/75 text-rose-700 hover:border-rose-500/75 hover:bg-rose-100 disabled:opacity-65" : "border-rose-300/45 bg-rose-500/14 text-rose-200 hover:border-rose-300/70 hover:bg-rose-500/22 disabled:opacity-65"}`}
                    >
                      {isAbortRequested ? (
                        <LoaderCircle
                          className="h-5 w-5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <CircleAlert className="h-5 w-5" aria-hidden="true" />
                      )}
                      {isAbortRequested ? "Aborting..." : "Abort process"}
                    </button>
                  ) : null}
                </div>

                <div
                  className={`rounded-2xl border px-4 py-3 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff]/90" : "border-[#61afef]/30 bg-[#252b38]/75"}`}
                >
                  <p
                    className={`font-body text-sm ${isLightTheme ? "text-[#3b6ea8]" : "text-[#61afef]/85"}`}
                  >
                    Status
                  </p>
                  <p
                    className={`truncate font-body text-base ${isLightTheme ? "text-[#2f3f56]" : "text-[#d7deea]"}`}
                  >
                    {statusText}
                  </p>
                </div>

                {canStartNewQueue ? (
                  <button
                    type="button"
                    onClick={handleResetQueue}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 font-display text-lg font-semibold transition ${isLightTheme ? "border-[#7c79cf]/35 bg-[#eceeff] text-[#554f99] hover:border-[#6c68bd]/65 hover:bg-[#e2e6ff]" : "border-[#c678dd]/35 bg-[#c678dd]/10 text-[#ead8ff] hover:border-[#c678dd]/70 hover:bg-[#c678dd]/20"}`}
                  >
                    <RotateCcw className="h-5 w-5" aria-hidden="true" />
                    Start new process queue
                  </button>
                ) : null}

                {completedSummary ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsReportOpen(true);
                    }}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 font-display text-lg font-semibold transition ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff]/90 text-[#2f3f56] hover:border-[#6f6ed0]/58 hover:bg-[#edf3ff]" : "border-[#61afef]/30 bg-[#252b38]/75 text-[#d7deea] hover:border-[#c678dd]/60 hover:bg-[#30384a]/85"}`}
                  >
                    <FileText className="h-5 w-5" aria-hidden="true" />
                    View report
                  </button>
                ) : null}
              </div>

              <div className="mt-4">
                <div
                  className={`relative h-4 overflow-hidden rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_18px_rgba(97,175,239,0.14)] ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#edf3ff]" : "border-[#61afef]/35 bg-[#252b38]/95"}`}
                >
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-[#ffffff]/5 to-transparent" />
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#56b6c2] via-[#61afef] to-[#c678dd] shadow-[0_0_16px_rgba(97,175,239,0.42)] transition-all duration-500 ease-out"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p
                  className={`mt-2 text-center font-body text-base ${isLightTheme ? "text-[#445873]" : "text-[#abb2bf]/90"}`}
                >
                  {percent}%
                </p>
              </div>

              <div className="mt-3 min-h-6">
                {warningText ? (
                  <p
                    className={`rounded-xl border px-3 py-2 font-body text-sm ${isLightTheme ? "border-rose-300/38 bg-rose-100/70 text-rose-700" : "border-rose-300/30 bg-rose-500/10 text-rose-200"}`}
                  >
                    {warningText}
                  </p>
                ) : (
                  <p
                    className={`font-body text-sm ${isLightTheme ? "text-[#5a6b82]" : "text-[#abb2bf]/75"}`}
                  >
                    No warnings.
                  </p>
                )}
              </div>

              <div
                ref={logsContainerRef}
                className={`mt-3 h-56 overflow-auto rounded-2xl border p-3 font-mono text-sm ${isLightTheme ? "border-[#5f8dbf]/30 bg-[#f6f9ff]/92" : "border-[#61afef]/25 bg-[#1b202c]/80"}`}
              >
                {logs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center">
                    <p
                      className={`max-w-md font-body text-sm ${isLightTheme ? "text-[#5d708b]" : "text-[#95a2b5]"}`}
                    >
                      Activity logs will appear here.
                    </p>
                  </div>
                ) : (
                  logs.map((entry) => {
                    const visuals = logVisualByLevel[entry.level];
                    const message = entry.text.replace(
                      /^\[(INFO|WARN|ERROR)\]\s*/i,
                      "",
                    );

                    return (
                      <article
                        key={entry.id}
                        className={`${visuals.cardClassName} mb-2 rounded-xl border p-2.5 last:mb-0`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`mt-0.5 rounded-md border p-1.5 ${isLightTheme ? "border-[#4d6586]/15 bg-[#edf3ff]" : "border-white/10 bg-[#1f2430]/80"}`}
                          >
                            <visuals.Icon
                              className={`${visuals.iconClassName} h-4 w-4`}
                              aria-hidden="true"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span
                              className={`${visuals.chipClassName} inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em]`}
                            >
                              {visuals.label}
                            </span>
                            <p
                              className={`${visuals.textClassName} mt-1 break-words`}
                            >
                              {message}
                            </p>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* ── Organise tab ─────────────────────────────────────────────── */}
          {
            activeTab === "organise" && (
              <>
                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => {
                        void handleOrgFolderSelect();
                      }}
                      disabled={isOrgProcessing}
                      className={`group w-full rounded-2xl border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f9fbff]/88 hover:border-[#6f6ed0]/58 hover:bg-[#f0f5ff]" : "border-[#61afef]/25 bg-[#2a3140]/70 hover:border-[#c678dd]/65 hover:bg-[#31394b]/85"}`}
                    >
                      <p
                        className={`inline-flex items-center gap-2 font-display text-lg ${isLightTheme ? "text-[#7a5a1d]" : "text-[#e5c07b]"}`}
                      >
                        <FolderOpen className="h-5 w-5" aria-hidden="true" />
                        Select Folder to Organise
                      </p>
                      <p
                        className={`mt-1 truncate font-body text-sm ${isLightTheme ? "text-[#4b607c]" : "text-[#abb2bf]/85"}`}
                      >
                        {orgSelectedFolder ?? "No folder selected"}
                      </p>
                    </button>
                  </div>

                  <aside
                    className={`rounded-2xl border p-3 ${isLightTheme ? "border-[#7d78d2]/35 bg-[#f6f9ff]/92" : "border-[#c678dd]/35 bg-[#252b38]/70"}`}
                  >
                    <p
                      className={`mb-2 px-1 font-body text-xs uppercase tracking-[0.2em] ${isLightTheme ? "text-[#6d67bc]" : "text-[#c678dd]/90"}`}
                    >
                      Organisation actions
                    </p>
                    <Accordion theme={theme}>
                      <AccordionItem
                        value="org-folder-options"
                        title="Folder options"
                        theme={theme}
                      >
                        <div className="grid grid-cols-1 gap-3">
                          <CheckboxRow
                            label="Flatten months into years"
                            checked={orgOptions.flattenMonthsToYears}
                            onChange={() => {
                              handleOrgOptionToggle("flattenMonthsToYears");
                            }}
                            disabled={isOrgProcessing}
                            isLightTheme={isLightTheme}
                          />
                          <CheckboxRow
                            label={
                              <>
                                Flatten all data to selected folder
                                <span className="group/org-flatten-all-help relative inline-flex h-5 w-5 items-center justify-center">
                                  <Info
                                    className={`h-4 w-4 ${isLightTheme ? "text-[#5b7ea7]" : "text-[#8dbde8]"}`}
                                    aria-hidden="true"
                                  />
                                  <span
                                    className={`pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-80 -translate-y-1/2 rounded-xl border p-3 text-left font-body text-xs leading-relaxed opacity-0 shadow-lg transition group-hover/org-flatten-all-help:opacity-100 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff] text-[#395170]" : "border-[#61afef]/30 bg-[#1f2634]/95 text-[#c7d4e7]"}`}
                                  >
                                    Recursively moves every file from all
                                    sub-folders directly into the selected
                                    folder, regardless of how deeply nested
                                    they are. All empty sub-folders are removed
                                    afterwards. Not compatible with other folder
                                    options.
                                  </span>
                                </span>
                              </>
                            }
                            checked={orgOptions.flattenAllToRoot}
                            onChange={() => {
                              handleOrgOptionToggle("flattenAllToRoot");
                            }}
                            disabled={isOrgProcessing}
                            isLightTheme={isLightTheme}
                          />
                          <CheckboxRow
                            label={
                              <>
                                Flatten data into halves
                                <span className="group/org-halves-help relative inline-flex h-5 w-5 items-center justify-center">
                                  <Info
                                    className={`h-4 w-4 ${isLightTheme ? "text-[#5b7ea7]" : "text-[#8dbde8]"}`}
                                    aria-hidden="true"
                                  />
                                  <span
                                    className={`pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-80 -translate-y-1/2 rounded-xl border p-3 text-left font-body text-xs leading-relaxed opacity-0 shadow-lg transition group-hover/org-halves-help:opacity-100 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff] text-[#395170]" : "border-[#61afef]/30 bg-[#1f2634]/95 text-[#c7d4e7]"}`}
                                  >
                                    Recursively scans the selected folder and
                                    creates two sub-folders named{" "}
                                    <strong>H1</strong> and{" "}
                                    <strong>H2</strong>, distributing all files
                                    as evenly as possible by total size. Every
                                    file is always included — if a perfect split
                                    isn&apos;t possible, the remainder goes into
                                    H1. Not compatible with other folder
                                    options.
                                  </span>
                                </span>
                              </>
                            }
                            checked={Boolean(orgOptions.flattenIntoHalves)}
                            onChange={() => {
                              handleOrgOptionToggle("flattenIntoHalves");
                            }}
                            disabled={isOrgProcessing}
                            isLightTheme={isLightTheme}
                          />
                          <CheckboxRow
                            label={
                              <>
                                Write modified date to created date
                                <span className="group/org-mod-to-created-help relative inline-flex h-5 w-5 items-center justify-center">
                                  <Info
                                    className={`h-4 w-4 ${isLightTheme ? "text-[#5b7ea7]" : "text-[#8dbde8]"}`}
                                    aria-hidden="true"
                                  />
                                  <span
                                    className={`pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-80 -translate-y-1/2 rounded-xl border p-3 text-left font-body text-xs leading-relaxed opacity-0 shadow-lg transition group-hover/org-mod-to-created-help:opacity-100 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff] text-[#395170]" : "border-[#61afef]/30 bg-[#1f2634]/95 text-[#c7d4e7]"}`}
                                  >
                                    Scans all media files in the selected folder
                                    recursively and sets the created date equal
                                    to the modified date, making both values
                                    identical. Other file metadata is not
                                    changed.
                                  </span>
                                </span>
                              </>
                            }
                            checked={Boolean(orgOptions.writeModifiedToCreated)}
                            onChange={() => {
                              handleOrgOptionToggle("writeModifiedToCreated");
                            }}
                            disabled={isOrgProcessing}
                            isLightTheme={isLightTheme}
                          />
                          <CheckboxRow
                            label={
                              <>
                                Write created date to modified date
                                <span className="group/org-created-to-mod-help relative inline-flex h-5 w-5 items-center justify-center">
                                  <Info
                                    className={`h-4 w-4 ${isLightTheme ? "text-[#5b7ea7]" : "text-[#8dbde8]"}`}
                                    aria-hidden="true"
                                  />
                                  <span
                                    className={`pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-80 -translate-y-1/2 rounded-xl border p-3 text-left font-body text-xs leading-relaxed opacity-0 shadow-lg transition group-hover/org-created-to-mod-help:opacity-100 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff] text-[#395170]" : "border-[#61afef]/30 bg-[#1f2634]/95 text-[#c7d4e7]"}`}
                                  >
                                    Scans all media files in the selected folder
                                    recursively and sets the modified date equal
                                    to the created date, making both values
                                    identical. Other file metadata is not
                                    changed.
                                  </span>
                                </span>
                              </>
                            }
                            checked={Boolean(orgOptions.writeCreatedToModified)}
                            onChange={() => {
                              handleOrgOptionToggle("writeCreatedToModified");
                            }}
                            disabled={isOrgProcessing}
                            isLightTheme={isLightTheme}
                          />
                          <CheckboxRow
                            label={
                              <>
                                Coerce dates to lowest value
                                <span className="group/org-coerce-help relative inline-flex h-5 w-5 items-center justify-center">
                                  <Info
                                    className={`h-4 w-4 ${isLightTheme ? "text-[#5b7ea7]" : "text-[#8dbde8]"}`}
                                    aria-hidden="true"
                                  />
                                  <span
                                    className={`pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-80 -translate-y-1/2 rounded-xl border p-3 text-left font-body text-xs leading-relaxed opacity-0 shadow-lg transition group-hover/org-coerce-help:opacity-100 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff] text-[#395170]" : "border-[#61afef]/30 bg-[#1f2634]/95 text-[#c7d4e7]"}`}
                                  >
                                    Scans all media files in the selected folder
                                    recursively, compares the created and
                                    modified dates, and sets both to whichever
                                    is earlier. Other file metadata is not
                                    changed.
                                  </span>
                                </span>
                              </>
                            }
                            checked={Boolean(orgOptions.coerceBothToLowest)}
                            onChange={() => {
                              handleOrgOptionToggle("coerceBothToLowest");
                            }}
                            disabled={isOrgProcessing}
                            isLightTheme={isLightTheme}
                          />
                        </div>
                      </AccordionItem>
                      <AccordionItem
                        value="org-supporting-options"
                        title="Supporting options"
                        theme={theme}
                      >
                        <div className="grid grid-cols-1 gap-3">
                          <CheckboxRow
                            label="Remove empty folders"
                            checked={orgOptions.removeEmptyFolders}
                            onChange={() => {
                              handleOrgOptionToggle("removeEmptyFolders");
                            }}
                            disabled={isOrgProcessing}
                            isLightTheme={isLightTheme}
                          />
                          <CheckboxRow
                            label={
                              <>
                                Create temporary folder for review
                                <span className="group/org-temp-help relative inline-flex h-5 w-5 items-center justify-center">
                                  <Info
                                    className={`h-4 w-4 ${isLightTheme ? "text-[#5b7ea7]" : "text-[#8dbde8]"}`}
                                    aria-hidden="true"
                                  />
                                  <span
                                    className={`pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-80 -translate-y-1/2 rounded-xl border p-3 text-left font-body text-xs leading-relaxed opacity-0 shadow-lg transition group-hover/org-temp-help:opacity-100 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff] text-[#395170]" : "border-[#61afef]/30 bg-[#1f2634]/95 text-[#c7d4e7]"}`}
                                  >
                                    Runs organisation in a temporary folder
                                    inside your selected directory so you can
                                    review the result first. Compatible with any
                                    folder option.
                                  </span>
                                </span>
                              </>
                            }
                            checked={Boolean(
                              orgOptions.createTempFolderForReview,
                            )}
                            onChange={() => {
                              handleOrgOptionToggle(
                                "createTempFolderForReview",
                              );
                            }}
                            disabled={isOrgProcessing}
                            isLightTheme={isLightTheme}
                          />
                        </div>
                      </AccordionItem>
                    </Accordion>
                    {!hasFolderActionSelected && (
                      <p
                        className={`mt-3 rounded-xl px-3 py-2 font-body text-xs ${isLightTheme ? "bg-amber-50 text-amber-700" : "bg-amber-500/10 text-amber-300/90"}`}
                      >
                        Select a folder action to enable organising.
                      </p>
                    )}
                  </aside>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleOrgStart();
                    }}
                    disabled={
                      isOrgProcessing ||
                      !orgSelectedFolder ||
                      !hasFolderActionSelected
                    }
                    className={`inline-flex h-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#56b6c2] via-[#61afef] to-[#c678dd] px-4 py-3 font-display text-xl font-semibold text-[#1b1f2a] transition hover:from-[#7ad0da] hover:via-[#83c3ff] hover:to-[#d99bf0] disabled:cursor-not-allowed disabled:text-[#8f97a6] ${isLightTheme ? "disabled:from-[#c6cdd8] disabled:via-[#c6cdd8] disabled:to-[#c6cdd8]" : "disabled:from-[#5a6271] disabled:via-[#5a6271] disabled:to-[#5a6271] disabled:text-[#c5ccd9]"}`}
                  >
                    {isOrgProcessing ? (
                      <LoaderCircle
                        className="h-5 w-5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Layers2 className="h-5 w-5" aria-hidden="true" />
                    )}
                    {isOrgProcessing ? "Organising\u2026" : "Start Organising"}
                  </button>

                  <div
                    className={`rounded-2xl border px-4 py-3 ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff]/90" : "border-[#61afef]/30 bg-[#252b38]/75"}`}
                  >
                    <p
                      className={`font-body text-sm ${isLightTheme ? "text-[#3b6ea8]" : "text-[#61afef]/85"}`}
                    >
                      Status
                    </p>
                    <p
                      className={`truncate font-body text-base ${isLightTheme ? "text-[#2f3f56]" : "text-[#d7deea]"}`}
                    >
                      {orgStatusText}
                    </p>
                  </div>

                  {orgCanReset ? (
                    <button
                      type="button"
                      onClick={handleOrgResetQueue}
                      className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 font-display text-lg font-semibold transition ${isLightTheme ? "border-[#7c79cf]/35 bg-[#eceeff] text-[#554f99] hover:border-[#6c68bd]/65 hover:bg-[#e2e6ff]" : "border-[#c678dd]/35 bg-[#c678dd]/10 text-[#ead8ff] hover:border-[#c678dd]/70 hover:bg-[#c678dd]/20"}`}
                    >
                      <RotateCcw className="h-5 w-5" aria-hidden="true" />
                      Organise another folder
                    </button>
                  ) : null}

                  {orgCompletedSummary ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOrgIsReportOpen(true);
                      }}
                      className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 font-display text-lg font-semibold transition ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff]/90 text-[#2f3f56] hover:border-[#6f6ed0]/58 hover:bg-[#edf3ff]" : "border-[#61afef]/30 bg-[#252b38]/75 text-[#d7deea] hover:border-[#c678dd]/60 hover:bg-[#30384a]/85"}`}
                    >
                      <FileText className="h-5 w-5" aria-hidden="true" />
                      View organise report
                    </button>
                  ) : null}
                </div>

                <div className="mt-4">
                  <div
                    className={`relative h-4 overflow-hidden rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_18px_rgba(97,175,239,0.14)] ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#edf3ff]" : "border-[#61afef]/35 bg-[#252b38]/95"}`}
                  >
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-[#ffffff]/5 to-transparent" />
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#56b6c2] via-[#61afef] to-[#c678dd] shadow-[0_0_16px_rgba(97,175,239,0.42)] transition-all duration-500 ease-out"
                      style={{ width: `${orgPercent}%` }}
                    />
                  </div>
                  <p
                    className={`mt-2 text-center font-body text-base ${isLightTheme ? "text-[#445873]" : "text-[#abb2bf]/90"}`}
                  >
                    {orgPercent}%
                  </p>
                </div>

                <div className="mt-3 min-h-6">
                  {orgWarningText ? (
                    <p
                      className={`rounded-xl border px-3 py-2 font-body text-sm ${isLightTheme ? "border-rose-300/38 bg-rose-100/70 text-rose-700" : "border-rose-300/30 bg-rose-500/10 text-rose-200"}`}
                    >
                      {orgWarningText}
                    </p>
                  ) : (
                    <p
                      className={`font-body text-sm ${isLightTheme ? "text-[#5a6b82]" : "text-[#abb2bf]/75"}`}
                    >
                      No warnings.
                    </p>
                  )}
                </div>

                <div
                  ref={orgLogsContainerRef}
                  className={`mt-3 h-56 overflow-auto rounded-2xl border p-3 font-mono text-sm ${isLightTheme ? "border-[#5f8dbf]/30 bg-[#f6f9ff]/92" : "border-[#61afef]/25 bg-[#1b202c]/80"}`}
                >
                  {orgLogs.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-center">
                      <p
                        className={`max-w-md font-body text-sm ${isLightTheme ? "text-[#5d708b]" : "text-[#95a2b5]"}`}
                      >
                        Activity logs will appear here.
                      </p>
                    </div>
                  ) : (
                    orgLogs.map((entry) => {
                      const visuals = logVisualByLevel[entry.level];
                      const message = entry.text.replace(
                        /^\[(INFO|WARN|ERROR)\]\s*/i,
                        "",
                      );

                      return (
                        <article
                          key={entry.id}
                          className={`${visuals.cardClassName} mb-2 rounded-xl border p-2.5 last:mb-0`}
                        >
                          <div className="flex items-start gap-2.5">
                            <div
                              className={`mt-0.5 rounded-md border p-1.5 ${isLightTheme ? "border-[#4d6586]/15 bg-[#edf3ff]" : "border-white/10 bg-[#1f2430]/80"}`}
                            >
                              <visuals.Icon
                                className={`${visuals.iconClassName} h-4 w-4`}
                                aria-hidden="true"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span
                                className={`${visuals.chipClassName} inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em]`}
                              >
                                {visuals.label}
                              </span>
                              <p
                                className={`${visuals.textClassName} mt-1 break-words`}
                              >
                                {message}
                              </p>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </>
            ) /* end organise tab */
          }

          {/* ── Toast overlay ────────────────────────────────────────────── */}
          {toast ? (
            <div
              role="alert"
              aria-live="assertive"
              className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 font-body text-sm transition ${isLightTheme ? "border-amber-300/45 bg-amber-50/90 text-amber-800" : "border-amber-300/30 bg-amber-500/10 text-amber-200"}`}
            >
              <TriangleAlert
                className={`mt-0.5 h-4 w-4 shrink-0 ${isLightTheme ? "text-amber-600" : "text-amber-400"}`}
                aria-hidden="true"
              />
              {toast.message}
            </div>
          ) : null}
        </section>
      </div>
      {completedSummary ? (
        <ProcessReportDialog
          open={isReportOpen}
          onOpenChange={setIsReportOpen}
          summary={completedSummary}
          theme={theme}
        />
      ) : null}
      {orgCompletedSummary ? (
        <OrganiseReportDialog
          open={orgIsReportOpen}
          onOpenChange={setOrgIsReportOpen}
          summary={orgCompletedSummary}
          onApplyTempReview={handleApplyOrgTempReview}
          isApplyingTempReview={isApplyingOrgTempReview}
          theme={theme}
        />
      ) : null}
      {confirmationDialog?.open ? (
        <DialogPrimitive.Root
          open={confirmationDialog.open}
          onOpenChange={() => {
            return;
          }}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay
              className={`fixed inset-0 z-[60] backdrop-blur-sm ${isLightTheme ? "bg-[#d6e1f2]/55" : "bg-slate-950/75"}`}
            />
            <DialogPrimitive.Content
              onEscapeKeyDown={(event) => {
                event.preventDefault();
              }}
              onPointerDownOutside={(event) => {
                event.preventDefault();
              }}
              onInteractOutside={(event) => {
                event.preventDefault();
              }}
              className={`fixed left-1/2 top-1/2 z-[70] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border shadow-[0_24px_100px_-24px_rgba(14,165,233,0.45)] ${isLightTheme ? "border-[#5f8dbf]/30 bg-[#f8fbff]" : "border-cyan-300/20 bg-slate-950"}`}
            >
              <div
                className={`border-b px-6 py-5 ${isLightTheme ? "border-[#5f8dbf]/20" : "border-cyan-100/10"}`}
              >
                <DialogPrimitive.Title
                  className={`font-display text-2xl font-semibold ${isLightTheme ? "text-[#2f3f56]" : "text-white"}`}
                >
                  {confirmationDialog.title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description
                  className={`mt-1 text-sm ${isLightTheme ? "text-[#4d6482]" : "text-cyan-100/70"}`}
                >
                  {confirmationDialog.message}
                </DialogPrimitive.Description>
              </div>
              <div className="flex justify-end gap-3 px-6 py-5">
                <button
                  type="button"
                  onClick={() => {
                    resolveConfirmation(false);
                  }}
                  className={`rounded-2xl border px-4 py-2 font-display text-base font-semibold transition ${isLightTheme ? "border-[#5f8dbf]/35 bg-[#f8fbff]/90 text-[#2f3f56] hover:border-[#6f6ed0]/58 hover:bg-[#edf3ff]" : "border-[#61afef]/30 bg-[#252b38]/75 text-[#d7deea] hover:border-[#c678dd]/60 hover:bg-[#30384a]/85"}`}
                >
                  {confirmationDialog.cancelLabel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resolveConfirmation(true);
                  }}
                  className="rounded-2xl bg-gradient-to-r from-[#56b6c2] via-[#61afef] to-[#c678dd] px-4 py-2 font-display text-base font-semibold text-[#1b1f2a] transition hover:from-[#7ad0da] hover:via-[#83c3ff] hover:to-[#d99bf0]"
                >
                  {confirmationDialog.confirmLabel}
                </button>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      ) : null}
    </main>
  );
};

export default App;
