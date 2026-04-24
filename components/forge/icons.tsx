"use client";

import React from "react";

type IconProps = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
} & Omit<React.SVGProps<SVGSVGElement>, "children">;

const defaultStroke: Partial<React.SVGProps<SVGSVGElement>> = {
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
};

export const PlayIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    className={className}
    style={style}
    {...props}
  >
    <path d="M6 4l14 8-14 8V4z" />
  </svg>
);

export const StopIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    className={className}
    style={style}
    {...props}
  >
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);

export const PauseIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    className={className}
    style={style}
    {...props}
  >
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

export const XIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);

export const FolderIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
  </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const GitIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <path d="M6 8.5v7" />
    <path d="M18 8.5v2a4 4 0 01-4 4H8" />
  </svg>
);

export const ChatIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <path d="M21 12a7 7 0 01-7 7H8l-4 3V12a7 7 0 017-7h2a7 7 0 017 7z" />
  </svg>
);

export const DiffIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <path d="M8 3v12" />
    <path d="M5 12l3 3 3-3" />
    <path d="M16 21V9" />
    <path d="M19 12l-3-3-3 3" />
  </svg>
);

export const SunIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="M4.93 4.93l1.41 1.41" />
    <path d="M17.66 17.66l1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="M6.34 17.66l-1.41 1.41" />
    <path d="M19.07 4.93l-1.41 1.41" />
  </svg>
);

export const MoonIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
  </svg>
);

export const KeyboardIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="6" cy="10" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="10" cy="10" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="14" cy="10" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="18" cy="10" r="0.5" fill="currentColor" stroke="none" />
    <line x1="7" y1="14" x2="17" y2="14" />
  </svg>
);

export const ActivityIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

export const TerminalIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <polyline points="4,17 10,11 4,5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

export const SettingsIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <polyline points="6,9 12,15 18,9" />
  </svg>
);

export const PanelLeftIcon: React.FC<IconProps> = ({ size = 16, className, style, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    style={style}
    {...defaultStroke}
    {...props}
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
  </svg>
);
