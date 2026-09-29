/**
 * Session-header preset picker for a blank session, and a label after it starts.
*/

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { AgentPresetSettingsState } from './settings-store.ts'
import type { AgentPresetSeatState } from './seat-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetLabel.module.css'

/** Registration-side business face for the header label. */
export interface AgentPresetLabelInjected {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
    /** Session-bound choice; the host accepts changes while the session is blank. */
    agentPresetSeat: SnapshotStore<AgentPresetSeatState>
  }
  /** Read the roster, so the label can show a name rather than an id. */
  load: () => Promise<void>
  /** Select a preset on this still-blank session. */
  select: (id: string) => Promise<string | undefined>
}

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/**
 * Render this session's agent-preset name beside its title.
 * @param props - composed slot props.
 * @returns the label, or null when the session records no preset.
 */
export function AgentPresetLabel({
  sessionId, useSessions, useAgentPresets, useAgentPresetSeat, load, select, t,
}: AgentPresetLabelProps) {
  const session = useSessions(state => state.byId[sessionId])
  const value = session?.projectionValues?.agentPreset
  const preset = typeof value === 'string' ? value : undefined
  const options = useAgentPresets(state => state.options)
  const seat = useAgentPresetSeat(state => state)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Deployments that compose no presets never label anything, so the roster
    // is only worth a request once a session reports one.
    if (preset !== undefined) void load()
  }, [preset, load])

  if (preset === undefined) return null

  const option = options.find(entry => entry.id === preset)
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  const label = text?.name ?? preset
  if (session?.blank !== true) {
    return <span className={css.label} title={text?.description ?? t('headerHint')}><IconAgentPresetOutlineRegular size={14} className={css.icon} />{label}</span>
  }

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={options.map((option) => {
        const display = presetDisplayText(option, t)
        return { id: option.id, label: <span className={css.item}><span className={css.itemName}>{display.name}</span><span className={css.itemDesc}>{display.description ?? t('noDescription')}</span></span> }
      })}
      selectedId={seat.current || preset}
      onSelect={(id) => { setOpen(false); void select(id) }}
      align="start"
      portal
      className={css.menuAnchor}
      anchor={(
        <button type="button" className={css.label} aria-haspopup="menu" aria-expanded={open} title={text?.description ?? t('seatHint')} disabled={seat.busy} onClick={() => { setOpen(value => !value) }}>
          <IconAgentPresetOutlineRegular size={14} className={css.icon} />{label}<IconChevronDownOutlineRegular className={css.chevron} />
        </button>
      )}
    />
  )
}
