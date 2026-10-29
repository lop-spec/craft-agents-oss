import { describe, it, expect } from 'bun:test'
import {
  buildCollapsedGroupsScopeSuffix,
  serializeSessionFilterForScope,
} from '../session-list-collapse'

describe('serializeSessionFilterForScope', () => {
  it('serializes filter kinds', () => {
    expect(serializeSessionFilterForScope({ kind: 'allSessions' })).toBe('allSessions')
    expect(serializeSessionFilterForScope({ kind: 'archived' })).toBe('archived')
    expect(serializeSessionFilterForScope(undefined)).toBe('allSessions')
  })
})

describe('buildCollapsedGroupsScopeSuffix', () => {
  it('creates different keys for different filters and grouping modes', () => {
    const activeProject = buildCollapsedGroupsScopeSuffix({
      workspaceId: 'ws-1',
      currentFilter: { kind: 'allSessions' },
      groupingMode: 'project',
    })

    const activeStatus = buildCollapsedGroupsScopeSuffix({
      workspaceId: 'ws-1',
      currentFilter: { kind: 'allSessions' },
      groupingMode: 'status',
    })

    const archivedDate = buildCollapsedGroupsScopeSuffix({
      workspaceId: 'ws-1',
      currentFilter: { kind: 'archived' },
      groupingMode: 'date',
    })

    expect(activeProject).not.toBe(activeStatus)
    expect(activeProject).not.toBe(archivedDate)
  })

  it('creates different keys across workspaces', () => {
    const ws1 = buildCollapsedGroupsScopeSuffix({
      workspaceId: 'workspace-one',
      currentFilter: { kind: 'allSessions' },
      groupingMode: 'date',
    })

    const ws2 = buildCollapsedGroupsScopeSuffix({
      workspaceId: 'workspace-two',
      currentFilter: { kind: 'allSessions' },
      groupingMode: 'date',
    })

    expect(ws1).not.toBe(ws2)
  })
})
