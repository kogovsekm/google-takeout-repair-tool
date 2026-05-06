import * as AccordionPrimitive from "@radix-ui/react-accordion";
import type { ReactNode } from "react";

type AccordionProps = {
  children: ReactNode;
  defaultValue?: string;
  theme?: "dark" | "light";
};

type AccordionItemProps = {
  value: string;
  title: string;
  children: ReactNode;
  theme?: "dark" | "light";
};

/**
 * @description Shadcn-style accordion wrapper used to group report sections.
 * @param children Rendered accordion items.
 * @param defaultValue Initially expanded section value.
 * @returns Styled accordion root.
 */
export const Accordion = ({ children, defaultValue }: AccordionProps) => {
  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      {...(defaultValue ? { defaultValue } : {})}
      className="space-y-3"
    >
      {children}
    </AccordionPrimitive.Root>
  );
};

/**
 * @description Styled accordion item with trigger and content area.
 * @param value Stable section identifier.
 * @param title Visible accordion header label.
 * @param children Section body content.
 * @returns Styled accordion item.
 */
export const AccordionItem = ({
  value,
  title,
  children,
  theme = "dark",
}: AccordionItemProps) => {
  const isLightTheme = theme === "light";

  return (
    <AccordionPrimitive.Item
      value={value}
      className={`overflow-visible rounded-2xl border ${isLightTheme ? "border-[#5f8dbf]/30 bg-[#f7faff]/92" : "border-[#61afef]/25 bg-[#1b202c]/75"}`}
    >
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger
          className={`group flex w-full items-center justify-between px-4 py-3 text-left font-display text-lg transition ${isLightTheme ? "text-[#2f3f56] hover:bg-[#edf3ff]" : "text-[#d7deea] hover:bg-[#252b38]/75"}`}
        >
          <span>{title}</span>
          <span
            className={`transition group-data-[state=open]:rotate-180 ${isLightTheme ? "text-[#6d67bc]" : "text-[#c678dd]"}`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M6 9L12 15L18 9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="accordion-content">
        <div
          className={`border-t px-4 py-4 text-sm ${isLightTheme ? "border-[#5f8dbf]/25 text-[#445873]" : "border-[#61afef]/25 text-[#c8d0dd]/90"}`}
        >
          {children}
        </div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
};
