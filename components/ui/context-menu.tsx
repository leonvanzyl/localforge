"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Position = { x: number; y: number };

type ContextMenuState = {
  open: boolean;
  position: Position;
};

type ContextMenuProps = {
  state: ContextMenuState;
  onClose: () => void;
  children: React.ReactNode;
};

export function useContextMenu() {
  const [state, setState] = React.useState<ContextMenuState>({
    open: false,
    position: { x: 0, y: 0 },
  });

  const open = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ open: true, position: { x: e.clientX, y: e.clientY } });
  }, []);

  const close = React.useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  return { state, open, close };
}

export function ContextMenu({ state, onClose, children }: ContextMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!state.open) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [state.open, onClose]);

  React.useEffect(() => {
    if (!state.open || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) {
      menu.style.left = `${state.position.x - rect.width}px`;
    }
    if (rect.bottom > vh) {
      menu.style.top = `${state.position.y - rect.height}px`;
    }
  }, [state.open, state.position]);

  if (!state.open) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      className={cn(
        "fixed z-50 min-w-[160px] rounded-md border border-border bg-card py-1 shadow-lg",
      )}
      style={{ top: state.position.y, left: state.position.x }}
    >
      {children}
    </div>
  );
}

type ContextMenuItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "destructive";
};

export function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: ContextMenuItemProps) {
  return (
    <button
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-sm outline-none transition-colors",
        "hover:bg-accent/10 focus-visible:bg-accent/10",
        variant === "destructive" && "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10",
        className,
      )}
      {...props}
    />
  );
}
