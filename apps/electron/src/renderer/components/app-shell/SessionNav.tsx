/**
 * SessionNav — the single left column's chrome (lop): a project/status grouping toggle with the
 * session actions in the header, and a pinned footer for the agent capabilities (MCP, skills,
 * automations, settings). Presentational: AppShell owns the state and handlers.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronLeft, FolderPlus, ListTodo, Search, Settings, Zap } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { SquarePenRounded } from '../icons/SquarePenRounded'
import { McpIcon } from '../icons/McpIcon'

export type SessionGrouping = 'project' | 'status'

export type NavSection = 'sessions' | 'sources' | 'skills' | 'automations' | 'settings'

/** Segmented control: neutral well, the selected segment is raised (same material as the old list/board switch). */
export function GroupingToggle({
  value,
  onChange,
}: {
  value: SessionGrouping
  onChange: (value: SessionGrouping) => void
}) {
  const { t } = useTranslation()
  const options: Array<{ id: SessionGrouping; label: string }> = [
    { id: 'project', label: t('sidebar.groupByProject') },
    { id: 'status', label: t('sidebar.groupByStatus') },
  ]
  return (
    <div role="radiogroup" aria-label={t('sidebar.group')} className="titlebar-no-drag inline-flex items-center gap-0.5 rounded-md bg-fill-hover p-0.5">
      {options.map(option => {
        const active = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            className={cn(
              'h-control-sm rounded-sm px-2.5 text-label-sm font-medium whitespace-nowrap',
              'transition-[background-color,color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
              active ? 'bg-floating text-foreground shadow-elev-1' : 'text-secondary hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function IconAction({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'header-icon-btn titlebar-no-drag inline-flex size-control shrink-0 items-center justify-center rounded-md',
            'transition-[background-color,color] duration-micro ease-out-subtle hover:duration-instant',
            active ? 'bg-fill-selected text-foreground' : 'text-secondary hover:bg-fill-hover hover:text-foreground'
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Session header: grouping toggle on the left; search, archive and new session on the right. */
export function SessionNavHeader({
  grouping,
  onGroupingChange,
  showingArchived,
  archivedCount,
  onToggleArchived,
  searchActive,
  onSearch,
  onNewSession,
  onNewProject,
  newSessionHotkey,
}: {
  grouping: SessionGrouping
  onGroupingChange: (value: SessionGrouping) => void
  showingArchived: boolean
  archivedCount: number
  onToggleArchived: () => void
  searchActive: boolean
  onSearch: () => void
  /** `openInNewWindow` is true for ⌘/Ctrl-click */
  onNewSession: (openInNewWindow: boolean) => void
  /** Shown in project grouping only */
  onNewProject?: () => void
  newSessionHotkey?: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="flex h-[48px] shrink-0 items-center gap-1 pl-3 pr-2 titlebar-drag-region">
      {showingArchived ? (
        <button
          type="button"
          onClick={onToggleArchived}
          className="titlebar-no-drag -ml-1 inline-flex h-control items-center gap-1 rounded-md px-1.5 text-label font-semibold text-foreground hover:bg-fill-hover"
        >
          <ChevronLeft className="size-4 text-secondary" />
          {t('sidebar.archived')}
          <span className="text-label-sm font-normal text-tertiary tabular-nums">{archivedCount}</span>
        </button>
      ) : (
        <GroupingToggle value={grouping} onChange={onGroupingChange} />
      )}
      <div className="flex-1" />
      <IconAction icon={<Search className="size-4" />} label={t('sidebar.search')} active={searchActive} onClick={onSearch} />
      {!showingArchived && (
        <IconAction
          icon={<Archive className="size-4" />}
          label={`${t('sidebar.archived')} ${archivedCount}`}
          onClick={onToggleArchived}
        />
      )}
      {!showingArchived && onNewProject && (
        <IconAction icon={<FolderPlus className="size-4" />} label={t('sidebarMenu.addProject')} onClick={() => onNewProject()} />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-tutorial="new-chat-button"
            onClick={(e) => onNewSession(e.metaKey || e.ctrlKey)}
            className="titlebar-no-drag ml-0.5 inline-flex h-control shrink-0 items-center gap-1 rounded-md border border-separator px-2 text-label text-foreground transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant"
          >
            <SquarePenRounded className="size-3.5 text-secondary" />
            <span className="whitespace-nowrap @max-[17.5rem]/sessioncol:hidden">{t('sidebar.newShort')}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('session.newSession')}{newSessionHotkey ? ` ${newSessionHotkey}` : ''}</TooltipContent>
      </Tooltip>
    </div>
  )
}

/** Header for the capability panels: back to the sessions, the panel title, its add action. */
export function CapabilityNavHeader({
  title,
  onBack,
  actions,
}: {
  title: string
  onBack: () => void
  actions?: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex h-[48px] shrink-0 items-center gap-1 pl-2 pr-2 titlebar-drag-region">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('common.back')}
        className="titlebar-no-drag inline-flex h-control min-w-0 items-center gap-1 rounded-md px-1.5 text-label font-semibold text-foreground hover:bg-fill-hover"
      >
        <ChevronLeft className="size-4 shrink-0 text-secondary" />
        <span className="truncate">{title}</span>
      </button>
      <div className="flex-1" />
      {actions}
    </div>
  )
}

/** Pinned footer: one row of icon + short label, like pi-web's 模型 · 技能 · 设置. */
export function SessionNavFooter({
  active,
  onSelect,
}: {
  active: NavSection
  onSelect: (section: Exclude<NavSection, 'sessions'>) => void
}) {
  const { t } = useTranslation()
  const items: Array<{ id: Exclude<NavSection, 'sessions'>; label: string; icon: React.ReactNode }> = [
    { id: 'sources', label: t('sidebar.mcps'), icon: <McpIcon className="size-3.5" /> },
    { id: 'skills', label: t('sidebar.skills'), icon: <Zap className="size-3.5" /> },
    { id: 'automations', label: t('sidebar.automations'), icon: <ListTodo className="size-3.5" /> },
    { id: 'settings', label: t('sidebar.settings'), icon: <Settings className="size-3.5" /> },
  ]
  return (
    <nav aria-label={t('sidebar.capabilities')} className="shrink-0 border-t border-separator px-1.5 py-1.5">
      <div className="grid grid-cols-4 gap-0.5">
        {items.map(item => {
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              className={cn(
                'inline-flex h-control min-w-0 items-center justify-center gap-1 rounded-md px-1 text-label-sm',
                'transition-[background-color,color] duration-micro ease-out-subtle hover:duration-instant',
                isActive ? 'bg-fill-selected text-foreground' : 'text-secondary hover:bg-fill-hover hover:text-foreground'
              )}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
