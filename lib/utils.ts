import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn-style class name merger. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
