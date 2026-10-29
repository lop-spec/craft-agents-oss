import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SessionStatusMenu } from "@/components/ui/session-status-menu"
import { getStateIcon, getStateIconStyle } from "@/config/session-status-config"
import { useSessionListContext } from "@/context/SessionListContext"
import type { SessionMeta } from "@/atoms/sessions"
import { getSessionStatus } from "@/utils/session"
import { useHoverPopover } from "@/hooks/useHoverPopover"

interface SessionStatusIconProps {
  item: SessionMeta
}

/**
 * The row's status glyph: resting the pointer on it floats the status picker out; picking a status
 * (or moving away) tucks it back in. A click pins it open (keyboard and touch use that path).
 */
export function SessionStatusIcon({ item }: SessionStatusIconProps) {
  const { t } = useTranslation()
  const ctx = useSessionListContext()
  const popover = useHoverPopover({ openDelay: 220, closeDelay: 180 })
  const status = getSessionStatus(item)
  const close = () => popover.onOpenChange(false)

  const handleSelect = (state: import("@/config/session-status-config").SessionStatusId) => {
    close()
    ctx.onSessionStatusChange(item.id, state)
  }

  return (
    <Popover open={popover.open} onOpenChange={popover.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          {...popover.triggerProps}
          type="button"
          className={cn(
            // 16px glyph (spec §2.4) in a 24px button box (36px in the compact/touch shell), padded around
            // the glyph with a matching negative margin so the row's layout doesn't change
            "relative !size-6 -m-1 p-1 flex items-center justify-center rounded-full cursor-pointer",
            "@max-mobile/shell:!size-9 @max-mobile/shell:-m-2.5 @max-mobile/shell:p-2.5",
            "before:absolute before:inset-0 before:rounded-full before:content-[''] hover:before:bg-fill-hover",
            "[&>svg]:w-full [&>svg]:h-full [&>img]:w-full [&>img]:h-full [&>span]:text-label",
          )}
          style={getStateIconStyle(status, ctx.sessionStatuses)}
          aria-haspopup="menu"
          aria-expanded={popover.open}
          aria-label={t("status.change")}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {getStateIcon(status, ctx.sessionStatuses)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        {...popover.contentProps}
        className="w-auto p-0 border-0 shadow-none bg-transparent"
        align="start"
        side="bottom"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <SessionStatusMenu
          activeState={status}
          onSelect={handleSelect}
          states={ctx.sessionStatuses}
          filterable={false}
          isArchived={item.isArchived}
          onArchive={ctx.onArchive ? () => { close(); ctx.onArchive!(item.id) } : undefined}
          onUnarchive={ctx.onUnarchive ? () => { close(); ctx.onUnarchive!(item.id) } : undefined}
        />
      </PopoverContent>
    </Popover>
  )
}
