import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import { useSetAtom } from "jotai"
import { isToday, isYesterday, format, startOfDay } from "date-fns"
import { getDateLocale } from "@craft-agent/shared/i18n"
import { useAction } from "@/actions"
import { Inbox, Archive, Folder, Plus, Settings2 } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@craft-agent/ui"

import { getSessionStatus } from "@/utils/session"
import * as storage from "@/lib/local-storage"
import { KEYS } from "@/lib/local-storage"
import type { LabelConfig } from "@craft-agent/shared/labels"
import { flattenLabels } from "@craft-agent/shared/labels"
import * as MultiSelect from "@/hooks/useMultiSelect"
import { Spinner } from "@craft-agent/ui"
import { EntityListEmptyScreen } from "@/components/ui/entity-list-empty"
import { EntityList, type EntityListGroup } from "@/components/ui/entity-list"
import { RenameDialog } from "@/components/ui/rename-dialog"
import { SessionSearchHeader } from "./SessionSearchHeader"
import { SessionItem } from "./SessionItem"
import { SessionListProvider, type SessionListContextValue } from "@/context/SessionListContext"
import { useSessionSelection, useSessionSelectionStore } from "@/hooks/useSession"
import { useSessionSearch } from "@/hooks/useSessionSearch"
import { useSessionActions } from "@/hooks/useSessionActions"
import { useEntityListInteractions } from "@/hooks/useEntityListInteractions"
import { useFocusZone } from "@/hooks/keyboard"
import { useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useNavigation, useNavigationState, routes, isSessionsNavigation } from "@/contexts/NavigationContext"
import { useFocusContext } from "@/context/FocusContext"
import { sendToWorkspaceAtom, type SessionMeta } from "@/atoms/sessions"
import type { SessionStatusId, SessionStatus } from "@/config/session-status-config"
import { buildCollapsedGroupsScopeSuffix } from "@/utils/session-list-collapse"
import { FlipOnChange, SPRING } from "@craft-agent/ui/motion"
import { useListReorderFlip } from "@/hooks/useListReorderFlip"

export interface SessionListRow {
  item: SessionMeta
}

/** Grouping mode for chat list */
export type ChatGroupingMode = 'date' | 'status' | 'project'

/** Rows per project/status group before "show all" (pi-web shows five). */
const GROUP_PREVIEW_LIMIT = 5

interface SessionListProps {
  items: SessionMeta[]
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onSessionStatusChange: (sessionId: string, state: SessionStatusId) => void
  onRename: (sessionId: string, name: string) => void
  /** Called when Enter is pressed to focus chat input for a specific session */
  onFocusChatInput?: (sessionId?: string) => void
  /** Called when a session is selected */
  onSessionSelect?: (session: SessionMeta) => void
  /** Called when user wants to open a session in a new window */
  onOpenInNewWindow?: (session: SessionMeta) => void
  /** Unified session options per session (real-time state) */
  sessionOptions?: Map<string, import('../../hooks/useSessionOptions').SessionOptions>
  /** Whether search mode is active */
  searchActive?: boolean
  /** Current search query */
  searchQuery?: string
  /** Called when search query changes */
  onSearchChange?: (query: string) => void
  /** Called when search is closed */
  onSearchClose?: () => void
  /** Dynamic todo states from workspace config */
  sessionStatuses?: SessionStatus[]
  /** Label configs for resolving session label IDs to display info */
  labels?: LabelConfig[]
  /** Callback when session labels are toggled (for labels submenu in SessionMenu) */
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  /** Workspace projects (project groups, and the Projects submenu in SessionMenu) */
  projects?: Array<{ id: string; slug: string; name: string; color?: string }>
  /** Callback to bind/unbind a session to a project (null = unbind) */
  onSetProjectId?: (sessionId: string, projectId: string | null) => void
  /** How to group sessions */
  groupingMode?: ChatGroupingMode
  /** New session bound to a project (project group header) */
  onNewSessionInProject?: (projectId: string) => void
  /** Open a project's settings page (project group header) */
  onOpenProject?: (projectSlug: string) => void
  /** Workspace ID for content search (optional - if not provided, content search is disabled) */
  workspaceId?: string
  /** Override which session is highlighted (for multi-panel focused panel tracking) */
  focusedSessionId?: string | null
  /** Override navigation target (for multi-panel: focuses existing panel or navigates focused panel) */
  onNavigateToSession?: (sessionId: string) => void
  /** Session-level pending prompt marker (permission/admin approval) */
  hasPendingPrompt?: (sessionId: string) => boolean
  /** DOM-verified match info for the active session (from ChatDisplay) */
  activeChatMatchInfo?: { sessionId: string | null; count: number; isHighlighting?: boolean }
}

// Re-export SessionStatusId for use by parent components
export type { SessionStatusId }

// Note: uses date-fns format for non-today/yesterday dates; Today/Yesterday translated at render time
function formatDateGroupLabel(date: Date, t: (key: string) => string, lang: string): string {
  if (isToday(date)) return t('common.today')
  if (isYesterday(date)) return t('common.yesterday')
  return format(date, 'MMM d', { locale: getDateLocale(lang) })
}

function GroupHeaderAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => { e.stopPropagation(); onClick() }}
          className="inline-flex size-6 items-center justify-center rounded-sm text-secondary hover:bg-fill-pressed hover:text-foreground"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * SessionList - Scrollable list of session cards with keyboard navigation
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate and select sessions (immediate selection)
 * - Arrow Right: Move to the chat
 * - Enter: Focus chat input
 * - Home/End: Jump to first/last session
 */
export function SessionList({
  items,
  onDelete,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onSessionStatusChange,
  onRename,
  onFocusChatInput,
  onOpenInNewWindow,
  sessionOptions,
  searchActive,
  searchQuery = '',
  onSearchChange,
  onSearchClose,
  sessionStatuses = [],
  labels = [],
  onLabelsChange,
  projects,
  onSetProjectId,
  groupingMode = 'date',
  onNewSessionInProject,
  onOpenProject,
  workspaceId,
  focusedSessionId,
  onNavigateToSession,
  hasPendingPrompt,
  activeChatMatchInfo,
}: SessionListProps) {
  const { t, i18n } = useTranslation()
  const setSendToWorkspace = useSetAtom(sendToWorkspaceAtom)

  // --- Selection (atom-backed, shared with ChatDisplay + BatchActionPanel) ---
  const {
    select: selectSession,
    toggle: toggleSession,
    selectRange,
    isMultiSelectActive,
  } = useSessionSelection()
  const selectionStore = useSessionSelectionStore()

  const { navigate, navigateToSession: navigateToSessionPrimary } = useNavigation()
  const navigateToSession = onNavigateToSession ?? navigateToSessionPrimary
  const navState = useNavigationState()
  const { showEscapeOverlay } = useEscapeInterrupt()

  // Pre-flatten label tree once for efficient ID lookups in each SessionItem
  const flatLabels = useMemo(() => flattenLabels(labels), [labels])

  // Get current filter from navigation state (active / archived)
  const currentFilter = isSessionsNavigation(navState) ? navState.filter : undefined

  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  // Track if search input has actual DOM focus (for proper keyboard navigation gating)
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false)

  // Collapsed group keys (for collapsible group headers) — persisted per workspace/filter/grouping context
  const collapseScopeSuffix = useMemo(() => {
    return buildCollapsedGroupsScopeSuffix({
      workspaceId,
      currentFilter,
      groupingMode,
    })
  }, [workspaceId, groupingMode, currentFilter?.kind])

  const readCollapsedGroupsForScope = useCallback((scopeSuffix: string): Set<string> => {
    const scopedRaw = storage.getRaw(KEYS.collapsedSessionGroups, scopeSuffix)
    if (scopedRaw === null) return new Set()
    try {
      const parsed = JSON.parse(scopedRaw)
      return new Set(Array.isArray(parsed) ? parsed : [])
    } catch {
      return new Set()
    }
  }, [])

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => readCollapsedGroupsForScope(collapseScopeSuffix))
  const collapseScopeRef = useRef(collapseScopeSuffix)

  useEffect(() => {
    if (collapseScopeRef.current === collapseScopeSuffix) return
    setCollapsedGroups(readCollapsedGroupsForScope(collapseScopeSuffix))
    collapseScopeRef.current = collapseScopeSuffix
  }, [collapseScopeSuffix, readCollapsedGroupsForScope])

  useEffect(() => {
    // Avoid writing stale groups from a previous scope during context switches.
    if (collapseScopeRef.current !== collapseScopeSuffix) return
    storage.set(KEYS.collapsedSessionGroups, Array.from(collapsedGroups), collapseScopeSuffix)
  }, [collapsedGroups, collapseScopeSuffix])

  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  // Groups opened in full past the preview cap (session-local, like pi-web's "show all")
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const toggleGroupExpanded = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  const capsGroups = groupingMode === 'status' || groupingMode === 'project'

  // --- Data pipeline (search, filtering, pagination, grouping) ---
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  const {
    isSearchMode,
    highlightQuery,
    isSearchingContent,
    isSearchUnavailable,
    contentSearchResults,
    matchingFilterItems,
    otherResultItems,
    exceededSearchLimit,
    flatItems,
    hasMore,
    collapsedGroupsMeta,
    groupTotals,
    searchInputRef,
  } = useSessionSearch({
    items,
    searchActive: searchActive ?? false,
    searchQuery,
    workspaceId,
    currentFilter,
    collapsedGroups,
    groupingMode,
    groupLimit: capsGroups ? GROUP_PREVIEW_LIMIT : undefined,
    expandedGroups,
    scrollViewportRef,
  })

  // "Show all N" / "Show less" under a capped group
  const groupFooter = useCallback((key: string, shown: number) => {
    const total = groupTotals.get(key) ?? shown
    if (!capsGroups || total <= GROUP_PREVIEW_LIMIT) return undefined
    const expanded = expandedGroups.has(key)
    return (
      <button
        type="button"
        onClick={() => toggleGroupExpanded(key)}
        className="flex h-7 w-full items-center pl-9 text-left text-label-sm text-tertiary hover:text-foreground"
      >
        {expanded ? t('sidebar.showLess') : t('sidebar.showAllInGroup', { count: total })}
      </button>
    )
  }, [capsGroups, expandedGroups, groupTotals, t, toggleGroupExpanded])

  const rowData = useMemo(() => {
    if (isSearchMode) {
      const matchingRows: SessionListRow[] = matchingFilterItems.map(item => ({ item }))
      const otherRows: SessionListRow[] = otherResultItems.map(item => ({ item }))

      const groups: EntityListGroup<SessionListRow>[] = []
      if (matchingRows.length > 0) {
        groups.push({ key: 'matching', label: t("session.inCurrentView"), items: matchingRows })
      }
      if (otherRows.length > 0) {
        groups.push({ key: 'other', label: t("session.otherConversations"), items: otherRows })
      }

      return {
        rows: [...matchingRows, ...otherRows],
        groups,
      }
    }

    // flatItems only contains visible (expanded + paginated) items.
    // collapsedGroupsMeta provides key + count for collapsed groups so we
    // can insert header-only placeholder groups in the correct position.
    const rows: SessionListRow[] = flatItems.map(item => ({ item }))

    if (groupingMode === 'status') {
      const statusOrder = new Map<string, number>()
      sessionStatuses.forEach((state, index) => statusOrder.set(state.id, index))

      // Build groups from visible items
      // Every status gets a group (empty ones too): the column is where statuses are managed
      const groupsByKey = new Map<string, { rows: SessionListRow[], statusId: string }>()
      for (const state of sessionStatuses) groupsByKey.set(`status-${state.id}`, { rows: [], statusId: state.id })
      for (const row of rows) {
        const statusId = getSessionStatus(row.item)
        const key = `status-${statusId}`
        if (!groupsByKey.has(key)) groupsByKey.set(key, { rows: [], statusId })
        groupsByKey.get(key)!.rows.push(row)
      }

      // Insert collapsed placeholder groups
      for (const meta of collapsedGroupsMeta) {
        if (!groupsByKey.has(meta.key)) {
          groupsByKey.set(meta.key, { rows: [], statusId: meta.key.replace('status-', '') })
        }
      }

      const orderedGroups: EntityListGroup<SessionListRow>[] = []
      for (const [key, { rows: groupRows, statusId }] of groupsByKey) {
        const state = sessionStatuses.find(s => s.id === statusId)
        if (!state) continue
        groupRows.sort((a, b) => (b.item.lastMessageAt || 0) - (a.item.lastMessageAt || 0))
        const collapsedMeta = collapsedGroupsMeta.find(m => m.key === key)
        orderedGroups.push({
          key,
          label: t(`status.${state.id}`, state.label),
          items: groupRows,
          collapsible: true,
          icon: (
            <span className="flex size-3.5 items-center justify-center [&>svg]:size-3.5" style={state.iconColorable ? { color: state.resolvedColor } : undefined}>
              {state.icon}
            </span>
          ),
          count: groupTotals.get(key) ?? collapsedMeta?.count ?? 0,
          footer: groupFooter(key, groupRows.length),
          ...(collapsedMeta ? { collapsedCount: collapsedMeta.count } : {}),
        })
      }
      orderedGroups.sort((a, b) => {
        const aOrder = statusOrder.get(a.key.replace('status-', '')) ?? 999
        const bOrder = statusOrder.get(b.key.replace('status-', '')) ?? 999
        return aOrder - bOrder
      })

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    if (groupingMode === 'project') {
      // Every project gets a group (empty ones too, so a new project can start its first
      // session from its header). Sessions without a known project go to the "no project"
      // bucket so they're never silently dropped from the list.
      const projectOrder = new Map<string, number>()
      ;(projects ?? []).forEach((p, index) => projectOrder.set(p.id, index))
      const projectById = new Map<string, { id: string; slug: string; name: string }>()
      ;(projects ?? []).forEach(p => projectById.set(p.id, p))

      const groupsByKey = new Map<string, { rows: SessionListRow[], projectId: string | null }>()
      for (const p of projects ?? []) groupsByKey.set(`project-${p.id}`, { rows: [], projectId: p.id })
      for (const row of rows) {
        const rawProjectId = (row.item as { projectId?: string }).projectId
        const resolvedProjectId = rawProjectId && projectById.has(rawProjectId) ? rawProjectId : null
        const key = resolvedProjectId ? `project-${resolvedProjectId}` : 'project-__none__'
        if (!groupsByKey.has(key)) groupsByKey.set(key, { rows: [], projectId: resolvedProjectId })
        groupsByKey.get(key)!.rows.push(row)
      }

      // Insert collapsed placeholder groups (header-only, items: [])
      for (const meta of collapsedGroupsMeta) {
        if (!groupsByKey.has(meta.key)) {
          const idPart = meta.key.replace('project-', '')
          groupsByKey.set(meta.key, { rows: [], projectId: idPart === '__none__' ? null : idPart })
        }
      }

      const orderedGroups: EntityListGroup<SessionListRow>[] = []
      for (const [key, { rows: groupRows, projectId }] of groupsByKey) {
        groupRows.sort((a, b) => (b.item.lastMessageAt || 0) - (a.item.lastMessageAt || 0))
        const collapsedMeta = collapsedGroupsMeta.find(m => m.key === key)
        const project = projectId ? projectById.get(projectId) : undefined
        if (!project && groupRows.length === 0 && !collapsedMeta) continue
        const label = project?.name ?? t('sidebar.noProject', { defaultValue: 'No project' })
        orderedGroups.push({
          key,
          label,
          items: groupRows,
          collapsible: true,
          icon: <Folder className="size-3.5" />,
          count: groupTotals.get(key) ?? collapsedMeta?.count ?? 0,
          actions: project ? (
            <>
              {onNewSessionInProject && (
                <GroupHeaderAction label={t('sidebar.newSessionInProject')} icon={<Plus className="size-3.5" />} onClick={() => onNewSessionInProject(project.id)} />
              )}
              {onOpenProject && (
                <GroupHeaderAction label={t('sidebar.projectSettings')} icon={<Settings2 className="size-3.5" />} onClick={() => onOpenProject(project.slug)} />
              )}
            </>
          ) : undefined,
          footer: groupFooter(key, groupRows.length),
          ...(collapsedMeta ? { collapsedCount: collapsedMeta.count } : {}),
        })
      }
      orderedGroups.sort((a, b) => {
        // No-project bucket sinks to the bottom, configured projects in registration order
        if (a.key === 'project-__none__') return 1
        if (b.key === 'project-__none__') return -1
        const aOrder = projectOrder.get(a.key.replace('project-', '')) ?? 999
        const bOrder = projectOrder.get(b.key.replace('project-', '')) ?? 999
        return aOrder - bOrder
      })

      return {
        rows: orderedGroups.flatMap(g => g.items),
        groups: orderedGroups,
      }
    }

    // Archived list: group by date
    const groupsByKey = new Map<string, EntityListGroup<SessionListRow>>()
    const groupDates = new Map<string, Date>()

    for (const row of rows) {
      const day = startOfDay(new Date(row.item.lastMessageAt || 0))
      const groupKey = day.toISOString()

      if (!groupsByKey.has(groupKey)) {
        groupsByKey.set(groupKey, {
          key: groupKey,
          label: formatDateGroupLabel(day, t, i18n.resolvedLanguage ?? 'en'),
          items: [],
          collapsible: true,
        })
        groupDates.set(groupKey, day)
      }
      groupsByKey.get(groupKey)!.items.push(row)
    }

    // Insert collapsed placeholder groups (header-only, items: [])
    for (const meta of collapsedGroupsMeta) {
      if (!groupsByKey.has(meta.key)) {
        const date = new Date(meta.key)
        groupsByKey.set(meta.key, {
          key: meta.key,
          label: formatDateGroupLabel(date, t, i18n.resolvedLanguage ?? 'en'),
          items: [],
          collapsible: true,
          collapsedCount: meta.count,
        })
        groupDates.set(meta.key, date)
      }
    }

    // Sort all groups by date descending
    const orderedKeys = Array.from(groupDates.entries())
      .sort(([, a], [, b]) => b.getTime() - a.getTime())
      .map(([key]) => key)

    const orderedGroups = orderedKeys.map(key => groupsByKey.get(key)!)

    // If only one group exists, disable collapsing — there's nothing to collapse into
    if (orderedGroups.length === 1) {
      orderedGroups[0].collapsible = false
    }

    return {
      rows,
      groups: orderedGroups,
    }
  }, [isSearchMode, matchingFilterItems, otherResultItems, flatItems, groupingMode, sessionStatuses, projects, collapsedGroupsMeta, groupTotals, groupFooter, onNewSessionInProject, onOpenProject, t, i18n.resolvedLanguage])

  const flatRows = rowData.rows

  const collapseAllGroups = useCallback(() => {
    setCollapsedGroups(new Set(rowData.groups.map(g => g.key)))
  }, [rowData.groups])
  const expandAllGroups = useCallback(() => {
    setCollapsedGroups(new Set())
  }, [])

  const rowIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    flatRows.forEach((row, index) => {
      map.set(row.item.id, index)
    })
    return map
  }, [flatRows])

  // --- Action handlers with toast feedback ---
  const {
    handleFlagWithToast,
    handleUnflagWithToast,
    handleArchiveWithToast,
    handleUnarchiveWithToast,
    handleDeleteWithToast,
  } = useSessionActions({ onFlag, onUnflag, onArchive, onUnarchive, onDelete })

  // --- Focus zone ---
  const { focusZone } = useFocusContext()
  const { zoneRef, isFocused, shouldMoveDOMFocus } = useFocusZone({ zoneId: 'navigator' })

  // Keyboard eligibility: zone-focused OR search input focused (for arrow navigation)
  const isKeyboardEligible = isFocused || (searchActive && isSearchInputFocused)

  // --- Interactions (keyboard navigation + selection via shared atom) ---
  const interactions = useEntityListInteractions<SessionListRow>({
    items: flatRows,
    getId: (row) => row.item.id,
    keyboard: {
      onNavigate: useCallback((row: SessionListRow) => {
        navigateToSession(row.item.id)
      }, [navigateToSession]),
      onActivate: useCallback((row: SessionListRow) => {
        // Only navigate when not in multi-select (matches original behavior)
        if (!MultiSelect.isMultiSelectActive(selectionStore.state)) {
          navigateToSession(row.item.id)
        }
        onFocusChatInput?.(row.item.id)
      }, [selectionStore.state, navigateToSession, onFocusChatInput]),
      enabled: isKeyboardEligible,
      virtualFocus: searchActive ?? false,
    },
    multiSelect: true,
    selectionStore,
    selectedIdOverride: focusedSessionId,
  })

  // Sync activeIndex when selection changes externally (e.g. from ChatDisplay)
  useEffect(() => {
    const newIndex = flatRows.findIndex(row => row.item.id === selectionStore.state.selected)
    if (newIndex >= 0 && newIndex !== interactions.keyboard.activeIndex) {
      interactions.keyboard.setActiveIndex(newIndex)
    }
  }, [selectionStore.state.selected, flatRows, interactions.keyboard])

  // Focus active item when zone gains keyboard focus
  useEffect(() => {
    if (shouldMoveDOMFocus && flatRows.length > 0 && !(searchActive ?? false)) {
      interactions.keyboard.focusActiveItem()
    }
  }, [shouldMoveDOMFocus, flatRows.length, searchActive, interactions.keyboard])

  // --- Global keyboard shortcuts ---
  const isFocusWithinZone = () => zoneRef.current?.contains(document.activeElement) ?? false

  useAction('navigator.selectAll', () => {
    interactions.selection.selectAll()
  }, {
    enabled: isFocusWithinZone,
  }, [interactions.selection])

  useAction('navigator.clearSelection', () => {
    const selectedId = selectionStore.state.selected
    interactions.selection.clear()
    if (selectedId) navigateToSession(selectedId)
  }, {
    enabled: () => isMultiSelectActive && !showEscapeOverlay,
  }, [isMultiSelectActive, showEscapeOverlay, interactions.selection, selectionStore.state.selected, navigateToSession])

  // --- Click handlers ---
  const handleSelectSession = useCallback((row: SessionListRow, index: number) => {
    selectSession(row.item.id, index)
    navigateToSession(row.item.id)
  }, [selectSession, navigateToSession])

  const handleSelectSessionById = useCallback((sessionId: string) => {
    const index = rowIndexMap.get(sessionId) ?? -1
    if (index >= 0) {
      selectSession(sessionId, index)
    } else {
      selectSession(sessionId, 0)
    }
    navigateToSession(sessionId)
  }, [rowIndexMap, selectSession, navigateToSession])

  const handleToggleSelect = useCallback((row: SessionListRow, index: number) => {
    focusZone('navigator', { intent: 'click', moveFocus: false })
    toggleSession(row.item.id, index)
  }, [focusZone, toggleSession])

  const handleRangeSelect = useCallback((toIndex: number) => {
    focusZone('navigator', { intent: 'click', moveFocus: false })
    const allIds = flatRows.map(row => row.item.id)
    selectRange(toIndex, allIds)
  }, [focusZone, flatRows, selectRange])

  // Arrow right moves to the chat (the column is the leftmost zone)
  const handleKeyDown = useCallback((e: React.KeyboardEvent, _item: SessionMeta) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusZone('chat', { intent: 'keyboard' })
    }
  }, [focusZone])

  // --- Rename dialog ---
  const handleRenameClick = useCallback((sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId)
    setRenameName(currentName)
    requestAnimationFrame(() => {
      setRenameDialogOpen(true)
    })
  }, [])

  const handleRenameSubmit = () => {
    if (renameSessionId && renameName.trim()) {
      onRename(renameSessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
    setRenameSessionId(null)
    setRenameName("")
  }

  // --- Search input key handler ---
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      searchInputRef.current?.blur()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      onFocusChatInput?.(selectionStore.state.selected ?? undefined)
      return
    }
    // Forward arrow keys via interactions
    interactions.searchInputProps.onKeyDown(e)
  }, [searchInputRef, onFocusChatInput, interactions.searchInputProps, selectionStore.state.selected])

  // --- Context value (shared across all SessionItems) ---
  const handleFocusZone = useCallback(() => focusZone('navigator', { intent: 'click', moveFocus: false }), [focusZone])
  const handleOpenInNewWindow = useCallback((item: SessionMeta) => onOpenInNewWindow?.(item), [onOpenInNewWindow])
  const resolvedSearchQuery = isSearchMode ? highlightQuery : searchQuery

  const listContext = useMemo((): SessionListContextValue => ({
    onRenameClick: handleRenameClick,
    onSessionStatusChange,
    onFlag: onFlag ? handleFlagWithToast : undefined,
    onUnflag: onUnflag ? handleUnflagWithToast : undefined,
    onArchive: onArchive ? handleArchiveWithToast : undefined,
    onUnarchive: onUnarchive ? handleUnarchiveWithToast : undefined,
    onMarkUnread,
    onDelete: handleDeleteWithToast,
    onLabelsChange,
    projects,
    onSetProjectId,
    onSelectSessionById: handleSelectSessionById,
    onOpenInNewWindow: handleOpenInNewWindow,
    onSendToWorkspace: (ids: string[]) => setSendToWorkspace(ids),
    onFocusZone: handleFocusZone,
    onKeyDown: handleKeyDown,
    sessionStatuses,
    flatLabels,
    labels,
    searchQuery: resolvedSearchQuery,
    selectedSessionId: focusedSessionId !== undefined ? focusedSessionId : selectionStore.state.selected,
    isMultiSelectActive,
    sessionOptions,
    contentSearchResults,
    activeChatMatchInfo,
    hasPendingPrompt,
  }), [
    handleRenameClick, onSessionStatusChange,
    onFlag, handleFlagWithToast, onUnflag, handleUnflagWithToast,
    onArchive, handleArchiveWithToast, onUnarchive, handleUnarchiveWithToast,
    onMarkUnread, handleDeleteWithToast, onLabelsChange,
    projects, onSetProjectId,
    handleSelectSessionById, handleOpenInNewWindow, setSendToWorkspace, handleFocusZone, handleKeyDown,
    sessionStatuses, flatLabels, labels, resolvedSearchQuery,
    focusedSessionId, selectionStore.state.selected, isMultiSelectActive,
    sessionOptions, contentSearchResults, activeChatMatchInfo, hasPendingPrompt,
  ])

  // Rows glide to their new place when activity reorders the list (a pure reorder only)
  const reorderGroups = useMemo(
    () => rowData.groups.map(group => ({ key: group.key, ids: group.items.map(row => row.item.id) })),
    [rowData.groups]
  )
  const reorderFlip = useListReorderFlip({
    groups: reorderGroups,
    container: zoneRef,
    viewport: scrollViewportRef,
    rowKeyAttribute: 'data-session-id',
  })

  // --- Empty state (non-search) — render before EntityList ---
  // Don't show empty state when there are collapsed groups with content
  if (flatRows.length === 0 && rowData.groups.length === 0 && !searchActive) {
    if (currentFilter?.kind === 'archived') {
      return (
        <EntityListEmptyScreen
          icon={<Archive />}
          title={t("session.noArchivedSessions")}
          description={t("session.noArchivedSessionsDesc")}
          className="h-full"
        />
      )
    }

    return (
      <EntityListEmptyScreen
        icon={<Inbox />}
        title={t("session.noSessionsYet")}
        description={t("session.noSessionsYetDesc")}
        className="h-full"
      >
        <Button variant="secondary" onClick={() => navigate(routes.action.newSession())}>
          {t("session.newSession")}
        </Button>
      </EntityListEmptyScreen>
    )
  }

  // --- Render ---
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SessionListProvider value={listContext}>
      <FlipOnChange value={reorderFlip.value} enabled={reorderFlip.enabled} getTargets={reorderFlip.getTargets} keyOf={reorderFlip.keyOf} spring={SPRING.base} axis="y">
      <EntityList<SessionListRow>
        groups={rowData.groups}
        getKey={(row) => row.item.id}
        renderItem={(row, _indexInGroup, isFirstInGroup) => {
          const flatIndex = rowIndexMap.get(row.item.id) ?? 0
          const rowProps = interactions.getRowProps(row, flatIndex)
          return (
            <SessionItem
              item={row.item}
              index={flatIndex}
              itemProps={rowProps.buttonProps as Record<string, unknown>}
              isSelected={rowProps.isSelected}
              isFirstInGroup={isFirstInGroup}
              isInMultiSelect={rowProps.isInMultiSelect ?? false}
              hideProjectName={groupingMode === 'project' && !isSearchMode}
              onSelect={() => handleSelectSession(row, flatIndex)}
              onToggleSelect={() => handleToggleSelect(row, flatIndex)}
              onRangeSelect={() => handleRangeSelect(flatIndex)}
            />
          )
        }}
        header={
          <>
            {searchActive && (
              <SessionSearchHeader
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                onSearchClose={onSearchClose}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setIsSearchInputFocused(true)}
                onBlur={() => setIsSearchInputFocused(false)}
                isSearching={isSearchingContent}
                isUnavailable={isSearchUnavailable}
                resultCount={matchingFilterItems.length + otherResultItems.length}
                exceededLimit={exceededSearchLimit}
                inputRef={searchInputRef}
              />
            )}
            {isSearchMode && matchingFilterItems.length === 0 && otherResultItems.length > 0 && (
              <div className="px-4 py-3 text-label text-tertiary">
                {t("session.noResultsInFilter")}
              </div>
            )}
          </>
        }
        emptyState={
          isSearchMode && !isSearchingContent ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-label text-secondary">{t("session.noSessionsFound")}</p>
              <p className="text-label-sm text-tertiary mt-0.5">
                {t("session.noSessionsFoundDesc")}
              </p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => onSearchChange?.('')}>
                {t("session.clearSearch")}
              </Button>
            </div>
          ) : undefined
        }
        footer={
          hasMore ? (
            <div className="flex justify-center py-4">
              <Spinner className="text-tertiary" />
            </div>
          ) : undefined
        }
        viewportRef={scrollViewportRef}
        containerRef={zoneRef}
        containerProps={{
          'data-focus-zone': 'navigator',
          'data-list-role': 'sessions',
          role: 'listbox',
          'aria-label': 'Sessions',
        }}
        scrollAreaClassName="select-none mask-fade-top-short"
        collapsedGroups={collapsedGroups}
        onToggleCollapse={toggleGroupCollapse}
        onCollapseAll={collapseAllGroups}
        onExpandAll={expandAllGroups}
      />
      </FlipOnChange>
      </SessionListProvider>

      {/* Rename Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title={t("session.renameSession")}
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
        placeholder={t("session.enterSessionName")}
      />
    </div>
  )
}
