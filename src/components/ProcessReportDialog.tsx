import type {
  FileOutcome,
  FileOutcomeTag,
  FolderTreeNode,
  ProcessSummary,
} from "../types/electronApi";
import { Accordion, AccordionItem } from "./ui/Accordion";
import { Dialog, DialogContent } from "./ui/Dialog";

type ProcessReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: ProcessSummary;
  theme?: "dark" | "light";
};

type StatCardProps = {
  label: string;
  value: number;
  theme: "dark" | "light";
};

type FileListProps = {
  items: Array<string>;
  emptyMessage: string;
  theme: "dark" | "light";
};

type ProblemListProps = {
  items: ProcessSummary["report"]["problemFiles"];
  theme: "dark" | "light";
};

type FolderTreeProps = {
  nodes: Array<FolderTreeNode>;
  depth?: number;
  emptyMessage?: string;
  theme: "dark" | "light";
};

type FileOutcomeListProps = {
  items: Array<FileOutcome>;
  theme: "dark" | "light";
};

const darkTagStyles: Record<FileOutcomeTag, string> = {
  "metadata merged": "border-emerald-300/20 bg-emerald-500/10 text-emerald-200",
  "mirrored metadata": "border-cyan-300/20 bg-cyan-500/10 text-cyan-200",
  "metadata skipped": "border-amber-300/20 bg-amber-500/10 text-amber-200",
  "synced file time": "border-violet-300/20 bg-violet-500/10 text-violet-200",
  "restored MOV": "border-sky-300/20 bg-sky-500/10 text-sky-200",
  "copied only": "border-slate-300/20 bg-slate-500/10 text-slate-200",
  warning: "border-rose-300/20 bg-rose-500/10 text-rose-200",
};

const lightTagStyles: Record<FileOutcomeTag, string> = {
  "metadata merged": "border-emerald-400/35 bg-emerald-100/90 text-emerald-700",
  "mirrored metadata": "border-cyan-400/35 bg-cyan-100/90 text-cyan-700",
  "metadata skipped": "border-amber-400/35 bg-amber-100/90 text-amber-700",
  "synced file time": "border-violet-400/35 bg-violet-100/90 text-violet-700",
  "restored MOV": "border-sky-400/35 bg-sky-100/90 text-sky-700",
  "copied only": "border-slate-400/35 bg-slate-200/85 text-slate-700",
  warning: "border-rose-400/35 bg-rose-100/90 text-rose-700",
};

/**
 * @description Returns true for macOS Finder metadata files that can be safely ignored in preview.
 * @param name File name to inspect.
 * @returns True when the file is .DS_Store.
 */
const isMacMetadataFile = (name: string): boolean => {
  return name === ".DS_Store";
};

/**
 * @description Counts matching nodes recursively in a folder tree.
 * @param nodes Tree nodes to inspect.
 * @param predicate Match function.
 * @returns Count of matched nodes.
 */
const countTreeNodes = (
  nodes: Array<FolderTreeNode>,
  predicate: (node: FolderTreeNode) => boolean,
): number => {
  let count = 0;

  for (const node of nodes) {
    if (predicate(node)) {
      count += 1;
    }

    if (node.children.length > 0) {
      count += countTreeNodes(node.children, predicate);
    }
  }

  return count;
};

/**
 * @description Removes preview-noise files from the folder tree while preserving structure.
 * @param nodes Tree nodes to filter.
 * @returns Filtered tree nodes.
 */
const filterPreviewTreeNodes = (
  nodes: Array<FolderTreeNode>,
): Array<FolderTreeNode> => {
  const filtered: Array<FolderTreeNode> = [];

  for (const node of nodes) {
    if (node.kind === "file" && isMacMetadataFile(node.name)) {
      continue;
    }

    const children =
      node.children.length > 0 ? filterPreviewTreeNodes(node.children) : [];
    filtered.push({
      ...node,
      children,
    });
  }

  return filtered;
};

/**
 * @description Small stat card used in the processing report overview.
 * @param label Stat label.
 * @param value Stat numeric value.
 * @returns Styled stat card.
 */
const StatCard = ({ label, value, theme }: StatCardProps) => {
  const isLightTheme = theme === "light";

  return (
    <div
      className={`rounded-2xl border px-4 py-4 ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#f0f5ff]" : "border-cyan-100/10 bg-slate-900/70"}`}
    >
      <p
        className={`text-xs uppercase tracking-[0.22em] ${isLightTheme ? "text-[#4f77a6]/75" : "text-cyan-200/60"}`}
      >
        {label}
      </p>
      <p
        className={`mt-2 font-display text-3xl font-semibold ${isLightTheme ? "text-[#2f3f56]" : "text-white"}`}
      >
        {value}
      </p>
    </div>
  );
};

/**
 * @description Simple scrollable file list for report sections.
 * @param items File paths to show.
 * @param emptyMessage Message shown when list is empty.
 * @returns Styled file list panel.
 */
const FileList = ({ items, emptyMessage, theme }: FileListProps) => {
  const isLightTheme = theme === "light";

  return items.length > 0 ? (
    <div
      className={`max-h-64 overflow-auto rounded-2xl border p-3 font-mono text-xs ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#eef4ff] text-[#3f5672]" : "border-cyan-100/10 bg-slate-950/70 text-cyan-100/85"}`}
    >
      {items.map((item) => {
        return (
          <p key={item} className="mb-2 break-all last:mb-0">
            {item}
          </p>
        );
      })}
    </div>
  ) : (
    <p
      className={`rounded-2xl border px-4 py-3 text-sm ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#f2f7ff] text-[#4a607c]" : "border-cyan-100/10 bg-slate-900/60 text-cyan-100/70"}`}
    >
      {emptyMessage}
    </p>
  );
};

/**
 * @description Problem list with message and file path grouped together.
 * @param items Problem file entries.
 * @returns Styled list of processing problems.
 */
const ProblemList = ({ items, theme }: ProblemListProps) => {
  const isLightTheme = theme === "light";

  return items.length > 0 ? (
    <div
      className={`max-h-72 space-y-3 overflow-auto rounded-2xl border p-3 ${isLightTheme ? "border-rose-300/25 bg-rose-50/55" : "border-rose-300/15 bg-slate-950/70"}`}
    >
      {items.map((item) => {
        const key = `${item.filePath}:${item.message}`;
        return (
          <div
            key={key}
            className={`rounded-xl border p-3 ${isLightTheme ? "border-rose-300/30 bg-rose-100/45" : "border-rose-300/10 bg-rose-500/5"}`}
          >
            <p
              className={`text-sm font-semibold ${isLightTheme ? "text-rose-700" : "text-rose-200"}`}
            >
              {item.message}
            </p>
            <p
              className={`mt-2 break-all font-mono text-xs ${isLightTheme ? "text-rose-700/80" : "text-rose-100/80"}`}
            >
              {item.filePath}
            </p>
          </div>
        );
      })}
    </div>
  ) : (
    <p
      className={`rounded-2xl border px-4 py-3 text-sm ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#f2f7ff] text-[#4a607c]" : "border-cyan-100/10 bg-slate-900/60 text-cyan-100/70"}`}
    >
      No problem files were recorded.
    </p>
  );
};

/**
 * @description Recursive destination folder tree renderer.
 * @param nodes Folder tree nodes.
 * @param depth Nesting depth used for indentation.
 * @returns Nested tree preview.
 */
const FolderTree = ({
  nodes,
  depth = 0,
  emptyMessage = "Destination folder is empty.",
  theme,
}: FolderTreeProps) => {
  const isLightTheme = theme === "light";

  return nodes.length > 0 ? (
    <div className="space-y-2">
      {nodes.map((node) => {
        return (
          <div key={node.path} style={{ paddingLeft: `${depth * 14}px` }}>
            <div
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${isLightTheme ? "border-[#5f8dbf]/20 bg-[#f1f6ff] text-[#3f5672]" : "border-cyan-100/10 bg-slate-900/55 text-cyan-50/85"}`}
            >
              <span
                className={isLightTheme ? "text-[#4f77a6]" : "text-cyan-300"}
              >
                {node.kind === "directory" ? "▾" : "•"}
              </span>
              <span className="break-all font-mono">{node.name}</span>
            </div>
            {node.children.length > 0 ? (
              <div className="mt-2">
                <FolderTree
                  nodes={node.children}
                  depth={depth + 1}
                  theme={theme}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  ) : (
    <p
      className={`rounded-2xl border px-4 py-3 text-sm ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#f2f7ff] text-[#4a607c]" : "border-cyan-100/10 bg-slate-900/60 text-cyan-100/70"}`}
    >
      {emptyMessage}
    </p>
  );
};

/**
 * @description Renders per-file outcomes with tagged statuses for each processed file.
 * @param items Per-file outcome entries.
 * @returns Styled per-file outcome list.
 */
const FileOutcomeList = ({ items, theme }: FileOutcomeListProps) => {
  const isLightTheme = theme === "light";
  const tagStyles = isLightTheme ? lightTagStyles : darkTagStyles;

  return items.length > 0 ? (
    <div
      className={`max-h-80 space-y-3 overflow-auto rounded-2xl border p-3 ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#eef4ff]" : "border-cyan-100/10 bg-slate-950/70"}`}
    >
      {items.map((item) => {
        return (
          <div
            key={item.filePath}
            className={`rounded-xl border p-3 ${isLightTheme ? "border-[#5f8dbf]/20 bg-[#f7faff]" : "border-cyan-100/10 bg-slate-900/55"}`}
          >
            <p
              className={`break-all font-mono text-xs ${isLightTheme ? "text-[#3f5672]" : "text-cyan-50/85"}`}
            >
              {item.filePath}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.tags.map((tag) => {
                return (
                  <span
                    key={`${item.filePath}:${tag}`}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tagStyles[tag]}`}
                  >
                    {tag}
                  </span>
                );
              })}
              {item.sidecarMatchStrategy &&
              item.sidecarMatchStrategy !== "none" ? (
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${isLightTheme ? "border-[#5f8dbf]/30 bg-[#dbe9ff] text-[#325077]" : "border-cyan-300/20 bg-cyan-500/10 text-cyan-200"}`}
                >
                  {`sidecar: ${item.sidecarMatchStrategy}`}
                </span>
              ) : null}
            </div>
            {item.message ? (
              <p
                className={`mt-3 text-sm ${isLightTheme ? "text-[#4a607c]" : "text-cyan-100/70"}`}
              >
                {item.message}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  ) : (
    <p
      className={`rounded-2xl border px-4 py-3 text-sm ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#f2f7ff] text-[#4a607c]" : "border-cyan-100/10 bg-slate-900/60 text-cyan-100/70"}`}
    >
      No per-file outcomes were recorded.
    </p>
  );
};

/**
 * @description Report dialog shown after processing completes.
 * @param open Current dialog state.
 * @param onOpenChange Change handler for dialog visibility.
 * @param summary Completed process summary with report data.
 * @returns Styled report dialog with accordion sections.
 */
const ProcessReportDialog = ({
  open,
  onOpenChange,
  summary,
  theme = "dark",
}: ProcessReportDialogProps) => {
  const isLightTheme = theme === "light";
  const report = summary.report;
  const dsStoreCount = countTreeNodes(report.folderTree, (node) => {
    return node.kind === "file" && isMacMetadataFile(node.name);
  });
  const previewTree = filterPreviewTreeNodes(report.folderTree);

  const handleOpenFolder = async (): Promise<void> => {
    await window.takeoutApi.openFolder(report.outputPath);
  };

  const handleSaveReport = async (): Promise<void> => {
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replaceAll(":", "-");
    await window.takeoutApi.saveReport(
      `takeout-report-${timestamp}.json`,
      summary,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Processing report"
        description="Review what was processed, which files received metadata, what was skipped, and how the destination folder was created."
        theme={theme}
      >
        <div className="mb-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              void handleOpenFolder();
            }}
            className={`rounded-2xl border px-4 py-3 font-display text-base font-semibold transition ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#f1f6ff] text-[#325077] hover:border-[#4e79a8]/55 hover:bg-[#e8f0ff]" : "border-cyan-300/20 bg-slate-900/70 text-cyan-50 hover:border-cyan-300/70 hover:bg-slate-800/80"}`}
          >
            Open destination folder
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSaveReport();
            }}
            className={`rounded-2xl border px-4 py-3 font-display text-base font-semibold transition ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#f1f6ff] text-[#325077] hover:border-[#4e79a8]/55 hover:bg-[#e8f0ff]" : "border-cyan-300/20 bg-slate-900/70 text-cyan-50 hover:border-cyan-300/70 hover:bg-slate-800/80"}`}
          >
            Save report as JSON
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Files processed"
            value={report.processedCount}
            theme={theme}
          />
          <StatCard
            label="Metadata merged"
            value={report.metadataMergedFiles.length}
            theme={theme}
          />
          <StatCard
            label="Metadata mirrored"
            value={report.metadataMirroredFiles.length}
            theme={theme}
          />
          <StatCard
            label="File time synced"
            value={report.syncedFileTimeFiles.length}
            theme={theme}
          />
          <StatCard
            label="MOV restored"
            value={report.restoredMovFiles.length}
            theme={theme}
          />
          <StatCard
            label="Skipped metadata"
            value={report.skippedMetadataFiles.length}
            theme={theme}
          />
          <StatCard
            label="Problem files"
            value={report.problemFiles.length}
            theme={theme}
          />
          <StatCard
            label="Sidecar exact match"
            value={report.sidecarMatchSummary.exact}
            theme={theme}
          />
          <StatCard
            label="Sidecar fuzzy match"
            value={report.sidecarMatchSummary.fuzzy}
            theme={theme}
          />
          <StatCard
            label="Sidecar title match"
            value={report.sidecarMatchSummary.title}
            theme={theme}
          />
          <StatCard
            label="No sidecar matched"
            value={report.sidecarMatchSummary.none}
            theme={theme}
          />
        </div>

        <div className="mt-5">
          <Accordion defaultValue="merged-files" theme={theme}>
            <AccordionItem
              value="merged-files"
              title="Files successfully merged with metadata"
              theme={theme}
            >
              <FileList
                items={report.metadataMergedFiles}
                emptyMessage="No files were merged with metadata during this run."
                theme={theme}
              />
            </AccordionItem>
            <AccordionItem
              value="mirrored-files"
              title="Files mirrored across metadata formats"
              theme={theme}
            >
              <FileList
                items={report.metadataMirroredFiles}
                emptyMessage="No files required cross-format metadata mirroring during this run."
                theme={theme}
              />
            </AccordionItem>
            <AccordionItem
              value="synced-file-times"
              title="Files with synced filesystem time"
              theme={theme}
            >
              <FileList
                items={report.syncedFileTimeFiles}
                emptyMessage="No files had their filesystem time synced during this run."
                theme={theme}
              />
            </AccordionItem>
            <AccordionItem
              value="restored-mov-files"
              title="Files restored to .MOV"
              theme={theme}
            >
              <FileList
                items={report.restoredMovFiles}
                emptyMessage="No files needed a .MOV extension restoration during this run."
                theme={theme}
              />
            </AccordionItem>
            <AccordionItem
              value="skipped-files"
              title="Files skipped because there was no useful metadata"
              theme={theme}
            >
              <FileList
                items={report.skippedMetadataFiles}
                emptyMessage="No files were skipped for missing metadata."
                theme={theme}
              />
            </AccordionItem>
            <AccordionItem
              value="problem-files"
              title="Files that might have caused problems"
              theme={theme}
            >
              <ProblemList items={report.problemFiles} theme={theme} />
            </AccordionItem>
            <AccordionItem
              value="file-outcomes"
              title="Per-file outcomes and status tags"
              theme={theme}
            >
              <FileOutcomeList items={report.fileOutcomes} theme={theme} />
            </AccordionItem>
            <AccordionItem
              value="folder-structure"
              title="Destination folder structure preview"
              theme={theme}
            >
              {dsStoreCount > 0 ? (
                <p
                  className={`mb-3 rounded-2xl border px-4 py-3 text-sm ${isLightTheme ? "border-[#5f8dbf]/30 bg-[#eaf1ff] text-[#4a607c]" : "border-cyan-200/20 bg-cyan-500/10 text-cyan-100/85"}`}
                >
                  Found {dsStoreCount} macOS metadata
                  {dsStoreCount === 1 ? " file" : " files"} (.DS_Store). These
                  are Finder helper files and can be safely ignored.
                </p>
              ) : null}
              <FolderTree
                nodes={previewTree}
                emptyMessage="No media folders to preview yet."
                theme={theme}
              />
            </AccordionItem>
          </Accordion>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProcessReportDialog;
