import type { SessionFilter } from '../../shared/types'

export interface CollapsedGroupScopeOptions {
  workspaceId?: string
  currentFilter?: SessionFilter
  groupingMode: 'date' | 'status' | 'project'
}

export function serializeSessionFilterForScope(filter?: SessionFilter): string {
  return filter?.kind ?? 'allSessions'
}

/**
 * Build a deterministic scope suffix for collapsed group persistence.
 * This prevents collapse state from bleeding across workspaces, filters, and grouping modes.
 */
export function buildCollapsedGroupsScopeSuffix({
  workspaceId,
  currentFilter,
  groupingMode,
}: CollapsedGroupScopeOptions): string {
  const workspaceSegment = workspaceId ? encodeURIComponent(workspaceId) : 'global'
  const filterSegment = serializeSessionFilterForScope(currentFilter)
  return `ws=${workspaceSegment}|filter=${filterSegment}|group=${groupingMode}`
}
