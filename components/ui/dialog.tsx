"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lightweight shadcn-styled dialog/modal.
 *
 * We intentionally do not depend on @radix-ui/react-dialog because the
 * project only includes the dependencies listed in package.json. This
 * component provides the small slice of functionality LocalForge needs:
 * controlled open state, a dark backdrop, Escape-to-close, click-outside-
 * to-close, and body scroll lock while open.
 */

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Accessible label read to screen readers. */
  "aria-label"?: string;
  /** Id of the element labelling this dialog. */
  labelledBy?: string;
};

export function Dialog({
  open,
  onOpenChange,
  children,
  labelledBy,
  "aria-label": ariaLabel,
}: DialogProps) {
  // Lock body scroll while the dialog is open.
  React.useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // Close on Escape.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        aria-hidden="true"
        data-testid="dialog-backdrop"
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        data-testid="dialog"
        // Cap the panel at viewport-minus-padding and lay the children out
        // as a flex column so the header / footer stay pinned and the
        // (overflow-y-auto) DialogBody becomes the only scroll surface.
        // Without this, tall dialog content grows past the viewport and
        // the user can't reach it: the page itself is scroll-locked while
        // any dialog is open (see body-overflow effect above).
        className={cn(
          "relative z-10 flex w-full max-w-md max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-xl",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col space-y-1.5 border-b border-border px-6 py-4",
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "text-lg font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function DialogBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  // `flex-1 min-h-0` lets the body shrink inside the flex column so
  // `overflow-y-auto` actually engages; without `min-h-0` the body would
  // refuse to be smaller than its content, defeating the scroll cap on
  // the parent dialog panel.
  return (
    <div
      className={cn("flex-1 min-h-0 overflow-y-auto px-6 py-5", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export function DialogCloseButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close dialog"
      data-testid="dialog-close"
      className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
