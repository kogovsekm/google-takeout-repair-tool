import type { PostProcessSummary } from "../types/electronApi";
import { Dialog, DialogContent } from "./ui/Dialog";

type OrganiseReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: PostProcessSummary;
  onApplyTempReview?: () => Promise<void>;
  isApplyingTempReview?: boolean;
  theme?: "dark" | "light";
};

type StatCardProps = {
  label: string;
  value: number;
  theme: "dark" | "light";
};

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
 * @description Lightweight report dialog shown after a folder organisation run.
 * @param open Current dialog state.
 * @param onOpenChange Change handler for dialog visibility.
 * @param summary Completed post-process summary.
 * @param theme Active app theme.
 * @returns Styled organisation report dialog.
 */
const OrganiseReportDialog = ({
  open,
  onOpenChange,
  summary,
  onApplyTempReview,
  isApplyingTempReview = false,
  theme = "dark",
}: OrganiseReportDialogProps) => {
  const isLightTheme = theme === "light";
  const report = summary.report;
  const hasTempReview = typeof report.tempFolderPath === "string";

  const handleOpenFolder = async (): Promise<void> => {
    const folderToOpen = hasTempReview
      ? report.tempFolderPath
      : report.targetPath;
    if (!folderToOpen) {
      return;
    }

    await window.takeoutApi.openFolder(folderToOpen);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Organisation report"
        description="Summary of files moved and folders removed during the organisation run."
        theme={theme}
      >
        <div className="mb-5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                void handleOpenFolder();
              }}
              className={`rounded-2xl border px-4 py-3 font-display text-base font-semibold transition ${isLightTheme ? "border-[#5f8dbf]/25 bg-[#f1f6ff] text-[#325077] hover:border-[#4e79a8]/55 hover:bg-[#e8f0ff]" : "border-cyan-300/20 bg-slate-900/70 text-cyan-50 hover:border-cyan-300/70 hover:bg-slate-800/80"}`}
            >
              {hasTempReview ? "Open review folder" : "Open organised folder"}
            </button>

            {hasTempReview && onApplyTempReview ? (
              <button
                type="button"
                onClick={() => {
                  void onApplyTempReview();
                }}
                disabled={isApplyingTempReview}
                className={`rounded-2xl border px-4 py-3 font-display text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-65 ${isLightTheme ? "border-[#7c79cf]/35 bg-[#eceeff] text-[#554f99] hover:border-[#6c68bd]/65 hover:bg-[#e2e6ff]" : "border-[#c678dd]/35 bg-[#c678dd]/10 text-[#ead8ff] hover:border-[#c678dd]/70 hover:bg-[#c678dd]/20"}`}
              >
                {isApplyingTempReview
                  ? "Applying reviewed result…"
                  : "Apply reviewed result"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Files moved"
            value={report.movedFilesCount}
            theme={theme}
          />
          <StatCard
            label="Folders removed"
            value={report.removedFoldersCount}
            theme={theme}
          />
          <StatCard
            label="Warnings"
            value={summary.warnings.length}
            theme={theme}
          />
          <StatCard
            label="Problems"
            value={report.problemFiles.length}
            theme={theme}
          />
        </div>

        {summary.warnings.length > 0 && (
          <div className="mt-5">
            <p
              className={`mb-2 text-xs uppercase tracking-[0.2em] ${isLightTheme ? "text-[#6d67bc]" : "text-[#c678dd]/90"}`}
            >
              Warnings
            </p>
            <div
              className={`max-h-56 overflow-auto rounded-2xl border p-3 ${isLightTheme ? "border-amber-300/25 bg-amber-50/55" : "border-amber-300/15 bg-slate-950/70"}`}
            >
              {summary.warnings.map((warning) => {
                return (
                  <p
                    key={warning}
                    className={`mb-2 text-sm last:mb-0 ${isLightTheme ? "text-amber-700" : "text-amber-200"}`}
                  >
                    {warning}
                  </p>
                );
              })}
            </div>
          </div>
        )}

        {report.problemFiles.length > 0 && (
          <div className="mt-5">
            <p
              className={`mb-2 text-xs uppercase tracking-[0.2em] ${isLightTheme ? "text-rose-600" : "text-rose-400/90"}`}
            >
              Problem files
            </p>
            <div
              className={`max-h-56 space-y-3 overflow-auto rounded-2xl border p-3 ${isLightTheme ? "border-rose-300/25 bg-rose-50/55" : "border-rose-300/15 bg-slate-950/70"}`}
            >
              {report.problemFiles.map((item) => {
                return (
                  <div
                    key={`${item.filePath}:${item.message}`}
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default OrganiseReportDialog;
