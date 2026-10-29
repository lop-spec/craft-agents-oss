/**
 * EntityList — Reusable container for rendering a scrollable list of EntityRow items.
 *
 * Handles:
 * - ScrollArea wrapping with proper padding
 * - Optional grouped layout with section headers
 * - Collapsible groups with chevron toggle and item count
 * - Empty state rendering (centered, outside ScrollArea)
 * - Header (e.g. search bar) and footer (e.g. infinite scroll sentinel) slots
 *
 * Domain-specific logic (filtering, keyboard nav, multi-select) lives in the consumer.
 */

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

export interface EntityListGroup<T> {
  /** Unique key for the group */
  key: string
  /** Label shown in the section header */
  label: string
  /** Items in this group (empty array for collapsed groups — items are excluded from the data pipeline) */
  items: T[]
  /** Whether this group supports collapse/expand (default: false) */
  collapsible?: boolean
  /** Number of hidden items when collapsed. Present on collapsed placeholder groups (items will be []). */
  collapsedCount?: number
  /** Leading glyph of the header (project folder, status icon) */
  icon?: React.ReactNode
  /** Total count shown right-aligned in the header, collapsed or not */
  count?: number
  /** Header actions, revealed on hover (e.g. new session in this project) */
  actions?: React.ReactNode
  /** Row after the group's items (e.g. "show all N") */
  footer?: React.ReactNode
}

export interface EntityListProps<T> {
  /** Flat item list (used when not grouped) */
  items?: T[]
  /** Grouped items with section headers (takes precedence over items) */
  groups?: EntityListGroup<T>[]
  /** Render function for each item */
  renderItem: (item: T, index: number, isFirstInGroup: boolean) => React.ReactNode
  /** Unique key extractor */
  getKey: (item: T) => string
  /** Empty state content — rendered centered, outside ScrollArea */
  emptyState?: React.ReactNode
  /** Header content above the list (e.g. search bar) — rendered outside ScrollArea */
  header?: React.ReactNode
  /** Footer content after all items (e.g. infinite scroll sentinel) — inside ScrollArea */
  footer?: React.ReactNode
  /** Ref for the inner list container (for keyboard navigation zones) */
  containerRef?: React.Ref<HTMLDivElement>
  /** Props spread on the inner list container (role, aria-label, data-focus-zone) */
  containerProps?: Record<string, string>
  /** Ref to the ScrollArea viewport element (for scroll-based pagination) */
  viewportRef?: React.RefObject<HTMLDivElement>
  /** Additional ScrollArea class */
  scrollAreaClassName?: string
  className?: string
  /** Set of collapsed group keys (for collapsible groups) */
  collapsedGroups?: Set<string>
  /** Called when a collapsible group header is clicked */
  onToggleCollapse?: (groupKey: string) => void
  /** Collapse all collapsible groups */
  onCollapseAll?: () => void
  /** Expand all collapsible groups */
  onExpandAll?: () => void
}

// ============================================================================
// Section Header
// ============================================================================

/** Space above every group but the first: a header sits closer to its own rows than to the group above. */
const GROUP_GAP = 'mt-2'

/**
 * Group header (spec §7.2): 12px medium tertiary, sticky over the rows it heads. The label is centered
 * in its 32px box because the box can show: the hover fill, the sticky band over scrolled rows, the
 * frost on scenic themes. The space that ties a header to its own rows sits outside the box, as the
 * gap between groups (GROUP_GAP).
 */
function SectionHeader({ label }: { label: string }) {
  return (
    <div data-slot="list-group-header" className="sticky top-0 z-sticky flex h-8 items-center px-gutter bg-paper">
      <span className="text-label-sm font-medium text-tertiary truncate">
        {label}
      </span>
    </div>
  )
}

/** Collapsible group header with chevron toggle and item count when collapsed */
function CollapsibleGroupHeader({
  label,
  isCollapsed,
  itemCount,
  icon,
  count,
  actions,
  onToggle,
  onCollapseAll,
  onExpandAll,
}: {
  label: string
  isCollapsed: boolean
  itemCount: number
  icon?: React.ReactNode
  count?: number
  actions?: React.ReactNode
  onToggle: () => void
  onCollapseAll?: () => void
  onExpandAll?: () => void
}) {
  // With a leading glyph (project/status groups) the header reads like a tree row: chevron,
  // glyph, name, then the count and the hover actions on the right edge.
  if (icon) {
    return (
      <ContextMenu modal>
        <ContextMenuTrigger asChild>
          <div
            data-slot="list-group-header"
            className="sticky top-0 z-sticky flex h-8 w-full items-center bg-paper pr-2 group/header"
          >
            <div className="absolute inset-0 pointer-events-none transition-[background-color] duration-micro ease-out-subtle group-hover/header:bg-fill-hover group-hover/header:duration-instant" />
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!isCollapsed}
              className="relative flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3 text-left -outline-offset-2"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 text-tertiary transition-transform duration-(--spring-snap-dur) ease-(--spring-snap)",
                  !isCollapsed && "rotate-90"
                )}
              />
              <span className="flex size-4 shrink-0 items-center justify-center text-secondary">{icon}</span>
              <span className="min-w-0 truncate text-label font-medium text-foreground">{label}</span>
            </button>
            {actions && (
              <div className="relative flex shrink-0 items-center opacity-0 transition-opacity duration-micro group-hover/header:opacity-100 focus-within:opacity-100">
                {actions}
              </div>
            )}
            <span className="relative ml-1 shrink-0 text-label-sm tabular-nums text-tertiary">{count ?? itemCount}</span>
          </div>
        </ContextMenuTrigger>
        <StyledContextMenuContent>
          <StyledContextMenuItem onClick={onToggle}>
            {isCollapsed ? 'Expand' : 'Collapse'}
          </StyledContextMenuItem>
          <StyledContextMenuSeparator />
          <StyledContextMenuItem onClick={onCollapseAll}>
            Collapse All
          </StyledContextMenuItem>
          <StyledContextMenuItem onClick={onExpandAll}>
            Expand All
          </StyledContextMenuItem>
        </StyledContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <ContextMenu modal>
      <ContextMenuTrigger asChild>
        <button
          onClick={onToggle}
          aria-expanded={!isCollapsed}
          data-slot="list-group-header"
          // z-sticky: the header covers the full row width while rows (and their project stripes) scroll under it
          className="sticky top-0 z-sticky w-full h-8 px-gutter flex items-center gap-1 cursor-pointer group/header bg-paper -outline-offset-2"
        >
          <div className="absolute inset-0 transition-[background-color] duration-micro ease-out-subtle group-hover/header:bg-fill-hover group-hover/header:duration-instant pointer-events-none" />
          {/* The label starts on the panel gutter, like the panel title and the row glyphs; the
              disclosure chevron trails it (pointing down while expanded, right while collapsed). */}
          <span className="relative text-label-sm font-medium text-tertiary truncate">
            {label}{isCollapsed && <span className="tabular-nums"> · {itemCount}</span>}
          </span>
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "relative size-3 shrink-0 text-tertiary transition-transform duration-(--spring-snap-dur) ease-(--spring-snap)",
              !isCollapsed && "rotate-90"
            )}
          />
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={onToggle}>
          {isCollapsed ? 'Expand' : 'Collapse'}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem onClick={onCollapseAll}>
          Collapse All
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={onExpandAll}>
          Expand All
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

// ============================================================================
// Component
// ============================================================================

export function EntityList<T>({
  items,
  groups,
  renderItem,
  getKey,
  emptyState,
  header,
  footer,
  containerRef,
  containerProps,
  viewportRef,
  scrollAreaClassName,
  className,
  collapsedGroups,
  onToggleCollapse,
  onCollapseAll,
  onExpandAll,
}: EntityListProps<T>) {
  // Determine if we have content
  const hasGroups = groups && groups.length > 0
  const hasItems = items && items.length > 0
  const isEmpty = !hasGroups && !hasItems

  // Empty state — rendered outside everything for proper centering
  if (isEmpty && emptyState) {
    return (
      <div className={cn('flex flex-col flex-1', className)}>
        {header}
        {emptyState}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {header}
      <ScrollArea className={cn('flex-1', scrollAreaClassName)} viewportRef={viewportRef}>
        <div
          ref={containerRef}
          className="flex flex-col pb-2"
          {...containerProps}
        >
          <div className="pt-1">
            {hasGroups
              ? groups!.map((group, groupIndex) => {
                  const isCollapsed = group.collapsible && collapsedGroups?.has(group.key)

                  return (
                    <div key={group.key} className={groupIndex > 0 ? GROUP_GAP : undefined}>
                      {group.collapsible && onToggleCollapse ? (
                        <CollapsibleGroupHeader
                          label={group.label}
                          isCollapsed={!!isCollapsed}
                          itemCount={isCollapsed ? (group.collapsedCount ?? 0) : group.items.length}
                          icon={group.icon}
                          count={group.count}
                          actions={group.actions}
                          onToggle={() => onToggleCollapse(group.key)}
                          onCollapseAll={onCollapseAll}
                          onExpandAll={onExpandAll}
                        />
                      ) : (
                        <SectionHeader label={group.label} />
                      )}
                      {group.items.map((item, indexInGroup) =>
                        <React.Fragment key={getKey(item)}>
                          {renderItem(item, indexInGroup, indexInGroup === 0)}
                        </React.Fragment>
                      )}
                      {!isCollapsed && group.footer}
                    </div>
                  )
                })
              : items?.map((item, index) =>
                  <React.Fragment key={getKey(item)}>
                    {renderItem(item, index, index === 0)}
                  </React.Fragment>
                )
            }
          </div>
          {footer}
        </div>
      </ScrollArea>
    </div>
  )
}
