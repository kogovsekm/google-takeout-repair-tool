import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

type DialogContentProps = {
  title: string;
  description: string;
  children: ReactNode;
  theme?: "dark" | "light";
};

/**
 * @description Shadcn-style dialog wrapper for the processing report.
 * @param open Current open state.
 * @param onOpenChange Change handler for dialog open state.
 * @param children Dialog content tree.
 * @returns Radix dialog root.
 */
export const Dialog = ({ open, onOpenChange, children }: DialogProps) => {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
};

/**
 * @description Styled dialog content shell with header and close button.
 * @param title Dialog title text.
 * @param description Dialog description text.
 * @param children Dialog body content.
 * @returns Styled dialog content.
 */
export const DialogContent = ({
  title,
  description,
  children,
  theme = "dark",
}: DialogContentProps) => {
  const isLightTheme = theme === "light";

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={`fixed inset-0 z-40 backdrop-blur-sm ${isLightTheme ? "bg-[#d6e1f2]/55" : "bg-slate-950/75"}`}
      />
      <DialogPrimitive.Content
        className={`fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(960px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border shadow-[0_24px_100px_-24px_rgba(14,165,233,0.45)] ${isLightTheme ? "border-[#5f8dbf]/30 bg-[#f8fbff]" : "border-cyan-300/20 bg-slate-950"}`}
      >
        <div
          className={`border-b px-6 py-5 ${isLightTheme ? "border-[#5f8dbf]/20" : "border-cyan-100/10"}`}
        >
          <DialogPrimitive.Title
            className={`font-display text-2xl font-semibold ${isLightTheme ? "text-[#2f3f56]" : "text-white"}`}
          >
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            className={`mt-1 text-sm ${isLightTheme ? "text-[#4d6482]" : "text-cyan-100/70"}`}
          >
            {description}
          </DialogPrimitive.Description>
        </div>
        <div className="overflow-auto px-6 py-5">{children}</div>
        <DialogPrimitive.Close
          className={`absolute right-4 top-4 rounded-full border p-2 transition ${isLightTheme ? "border-[#5f8dbf]/20 bg-[#edf3ff] text-[#4d6482] hover:border-[#4e79a8]/45 hover:bg-[#e4ecfb]" : "border-cyan-100/10 bg-slate-900/70 text-cyan-100 hover:border-cyan-300/40 hover:bg-slate-800/80"}`}
        >
          <span className="sr-only">Close report</span>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M6 6L18 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
};
