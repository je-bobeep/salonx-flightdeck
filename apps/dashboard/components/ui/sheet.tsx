"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

type SheetContentProps = React.ComponentPropsWithoutRef<typeof Dialog.Content> & {
  width?: "md" | "lg" | "xl";
};

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof Dialog.Content>,
  SheetContentProps
>(({ className, width = "lg", children, ...props }, ref) => {
  const widthClass =
    width === "xl"
      ? "w-[720px] max-w-[95vw]"
      : width === "md"
        ? "w-[480px] max-w-[95vw]"
        : "w-[600px] max-w-[95vw]";

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-neutral-900/20 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <Dialog.Content
        ref={ref}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex flex-col border-l border-neutral-200 bg-white shadow-xl outline-none",
          widthClass,
          className
        )}
        {...props}
      >
        <Dialog.Close
          aria-label="Close panel"
          className="absolute right-3 top-3 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <X className="h-4 w-4" />
        </Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
});
SheetContent.displayName = "SheetContent";

export function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-b border-neutral-100 px-6 pb-4 pt-5",
        className
      )}
      {...props}
    />
  );
}

export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;

export function SheetBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex-1 overflow-auto px-6 py-4", className)}
      {...props}
    />
  );
}
