"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { FeatureCard, type FeatureCardData } from "./feature-card";

/**
 * Sortable wrapper around {@link FeatureCard} for the kanban drag-and-drop
 * implementation (Feature #47 - between columns, Feature #48 - within column).
 *
 * Why a wrapper? `FeatureCard` is rendered as a `<button>` and we don't want
 * pointer-down on the button to swallow click activation. By putting the
 * draggable listeners on a wrapping `<div>` we can use a distance-based
 * activation constraint (configured on the DndContext sensors) so a small
 * pointer-down still fires `onClick` and opens the detail modal, while a
 * meaningful drag movement starts the drag.
 *
 * `touch-none` disables the browser's native touch-scroll on this element so
 * dnd-kit's pointer/touch sensor receives the move events.
 */
export function SortableFeatureCard({
  feature,
  onOpen,
}: {
  feature: FeatureCardData;
  onOpen?: (id: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: feature.id,
    data: { feature },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`sortable-feature-card-${feature.id}`}
      data-dragging={isDragging ? "true" : "false"}
      // Feature #52: the dependency-lines overlay uses this attribute to
      // resolve each card's DOM node for measuring connector endpoints.
      data-feature-card-anchor={feature.id}
      className="touch-none"
      {...attributes}
      {...listeners}
    >
      <FeatureCard feature={feature} onOpen={onOpen} />
    </div>
  );
}
