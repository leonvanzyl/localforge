"use client";

import * as React from "react";

import type { FeatureCardData } from "./feature-card";

/**
 * SVG overlay that draws connector lines between dependent feature cards
 * on the kanban board (Feature #52).
 *
 * For every feature `A` that depends on feature `B`, a line is drawn from
 * the right edge of `B`'s card to the left edge of `A`'s card. Lines are
 * positioned relative to `containerRef` so they scroll and resize with the
 * board itself.
 *
 * The component:
 *   - Observes the board container and every card with a ResizeObserver
 *     so lines redraw when cards move (drag-and-drop) or the viewport is
 *     resized.
 *   - Listens for scroll events on the board (the kanban is horizontally
 *     scrollable on narrow screens) and recomputes endpoints.
 *   - Also redraws on a `window` resize so global layout changes (sidebar
 *     toggle, devtools open) are picked up.
 *
 * The SVG is `pointer-events: none` so lines never intercept card clicks
 * or drag gestures.
 */

type Props = {
  containerRef: React.RefObject<HTMLElement | null>;
  features: FeatureCardData[];
  /**
   * Optional: ID of the feature currently being dragged. While dragging we
   * skip recomputation for that card's transform to avoid flicker - the
   * lines briefly stale out until dragEnd, which is visually smoother than
   * chasing the transient CSS transform.
   */
  draggingId?: number | null;
};

type Edge = {
  key: string;
  fromId: number;
  toId: number;
};

type EdgeGeometry = {
  key: string;
  fromId: number;
  toId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * Collect every (prereq -> dependent) edge in the project. Drops edges
 * whose endpoints aren't both present in the feature list (e.g. deleted
 * features or filtered views) so stale rows don't produce orphan lines.
 */
function collectEdges(features: FeatureCardData[]): Edge[] {
  const ids = new Set(features.map((f) => f.id));
  const edges: Edge[] = [];
  for (const f of features) {
    const deps = f.dependsOn;
    if (!deps || deps.length === 0) continue;
    for (const prereqId of deps) {
      if (!ids.has(prereqId)) continue;
      edges.push({
        key: `${prereqId}->${f.id}`,
        fromId: prereqId,
        toId: f.id,
      });
    }
  }
  return edges;
}

export function DependencyLines({
  containerRef,
  features,
  draggingId = null,
}: Props) {
  const [geometry, setGeometry] = React.useState<EdgeGeometry[]>([]);
  const [size, setSize] = React.useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const rafRef = React.useRef<number | null>(null);

  const edges = React.useMemo(() => collectEdges(features), [features]);
  const edgesKey = React.useMemo(
    () => edges.map((e) => e.key).join(","),
    [edges],
  );

  const recompute = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const nextGeometry: EdgeGeometry[] = [];

    for (const edge of edges) {
      const fromEl = container.querySelector<HTMLElement>(
        `[data-feature-card-anchor="${edge.fromId}"]`,
      );
      const toEl = container.querySelector<HTMLElement>(
        `[data-feature-card-anchor="${edge.toId}"]`,
      );
      if (!fromEl || !toEl) continue;
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      // Prerequisite on the right edge; dependent on the left edge. If the
      // two cards happen to share an x-range (same column, e.g. both in
      // backlog), fall back to connecting bottom-of-prereq to top-of-
      // dependent so the line doesn't collapse to a horizontal stub.
      const horizontal = Math.abs(fromRect.left - toRect.left) > 40;
      let x1: number;
      let y1: number;
      let x2: number;
      let y2: number;
      if (horizontal) {
        x1 = fromRect.right - cRect.left + container.scrollLeft;
        y1 = fromRect.top + fromRect.height / 2 - cRect.top + container.scrollTop;
        x2 = toRect.left - cRect.left + container.scrollLeft;
        y2 = toRect.top + toRect.height / 2 - cRect.top + container.scrollTop;
      } else {
        x1 = fromRect.left + fromRect.width / 2 - cRect.left + container.scrollLeft;
        y1 = fromRect.bottom - cRect.top + container.scrollTop;
        x2 = toRect.left + toRect.width / 2 - cRect.left + container.scrollLeft;
        y2 = toRect.top - cRect.top + container.scrollTop;
      }

      nextGeometry.push({
        key: edge.key,
        fromId: edge.fromId,
        toId: edge.toId,
        x1,
        y1,
        x2,
        y2,
      });
    }

    // Size the SVG to the scrollable content area so lines never get clipped
    // when the board scrolls.
    const width = Math.max(container.scrollWidth, container.clientWidth);
    const height = Math.max(container.scrollHeight, container.clientHeight);
    setGeometry(nextGeometry);
    setSize({ width, height });
  }, [edges, containerRef]);

  const scheduleRecompute = React.useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
    });
  }, [recompute]);

  // Recompute whenever the edge set changes (add/remove dep, card added
  // /removed) or a drag ends (board features array replaced wholesale).
  React.useEffect(() => {
    scheduleRecompute();
  }, [edgesKey, features.length, scheduleRecompute]);

  // Observe the container and every card for layout changes. A single
  // ResizeObserver handles both scroll-width changes and card-height
  // adjustments.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      scheduleRecompute();
    });
    ro.observe(container);
    const cards =
      container.querySelectorAll<HTMLElement>("[data-feature-card-anchor]");
    cards.forEach((c) => ro.observe(c));

    const onScroll = () => scheduleRecompute();
    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      ro.disconnect();
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [containerRef, scheduleRecompute, edgesKey, features.length]);

  // While a drag is in progress, dnd-kit mutates CSS transforms which we
  // deliberately don't chase (would jitter the line during the drag). On
  // draggingId transition, schedule one extra recompute so the line snaps
  // to the new position as soon as the drag ends.
  React.useEffect(() => {
    if (draggingId == null) scheduleRecompute();
  }, [draggingId, scheduleRecompute]);

  if (edges.length === 0 || size.width === 0 || size.height === 0) {
    return (
      <svg
        data-testid="kanban-dependency-lines"
        data-edge-count={edges.length}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-0 w-0"
      />
    );
  }

  return (
    <svg
      data-testid="kanban-dependency-lines"
      data-edge-count={edges.length}
      aria-hidden="true"
      width={size.width}
      height={size.height}
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: size.width, height: size.height }}
    >
      <defs>
        <marker
          id="kanban-dep-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 z"
            className="fill-amber-500/80"
          />
        </marker>
      </defs>
      {geometry.map((g) => {
        // Cubic bezier: control points nudged horizontally so the curve
        // bends gently between columns rather than cutting straight across.
        const dx = Math.abs(g.x2 - g.x1);
        const offset = Math.max(24, Math.min(120, dx * 0.5));
        const isHorizontal = Math.abs(g.x2 - g.x1) > Math.abs(g.y2 - g.y1);
        const c1x = isHorizontal ? g.x1 + offset : g.x1;
        const c1y = isHorizontal ? g.y1 : g.y1 + offset;
        const c2x = isHorizontal ? g.x2 - offset : g.x2;
        const c2y = isHorizontal ? g.y2 : g.y2 - offset;
        const path = `M ${g.x1} ${g.y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${g.x2} ${g.y2}`;
        return (
          <path
            key={g.key}
            data-testid={`dependency-line-${g.fromId}-${g.toId}`}
            data-from={g.fromId}
            data-to={g.toId}
            d={path}
            fill="none"
            strokeWidth={1.75}
            strokeDasharray="4 3"
            markerEnd="url(#kanban-dep-arrow)"
            className="stroke-amber-500/70"
          />
        );
      })}
    </svg>
  );
}
