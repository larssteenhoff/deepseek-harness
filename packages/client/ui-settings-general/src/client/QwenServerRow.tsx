/** Desktop General Settings controls for the local Qwen server. */
import { useEffect, useRef, useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QwenServerBridge, QwenServerPreferences, QwenServerState } from '../types.ts'
import css from './QwenServerRow.module.css'

/** @param state - Current server state. @returns only the persisted preferences, without status fields. */
function preferences(state: QwenServerState): QwenServerPreferences {
  return { autoStart: state.autoStart, stopOnExit: state.stopOnExit, raiseGpuLimit: state.raiseGpuLimit }
}

/** @param props - Desktop server operations and localized copy. @returns server controls. */
export function QwenServerRow({ bridge, t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & { bridge: QwenServerBridge }) {
  const [state, setState] = useState<QwenServerState>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(false)
  const revision = useRef(0)
  useEffect(() => {
    mounted.current = true
    let reading = false
    const refresh = async (): Promise<void> => {
      if (reading) return
      reading = true
      const version = revision.current
      try { const next = await bridge.status(); if (mounted.current && version === revision.current) setState(next) }
      catch (_error) { if (mounted.current && version === revision.current) setFailed(true) }
      finally { reading = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2000)
    return () => { mounted.current = false; window.clearInterval(timer) }
  }, [bridge])
  const run = (operation: () => Promise<QwenServerState>): void => {
    revision.current++
    setBusy(true)
    setFailed(false)
    void operation().then((next) => { if (mounted.current) setState(next) })
      .catch((_error: unknown) => { if (mounted.current) setFailed(true) })
      .finally(() => { if (mounted.current) setBusy(false) })
  }
  const running = state?.phase === 'running'
  const disabled = busy || state === undefined || state.phase === 'starting' || state.phase === 'stopping'
  return <div className={css.root}>
    <div className={css.row}>
      <div><div className={css.title}>{t('qwen.title')}</div>
        <div className={css.description} role="status">{state === undefined ? t('qwen.loading') : t(`qwen.${state.phase}`)}</div>
      </div>
      <Button variant="outline" disabled={disabled || state.phase === 'external'}
        onClick={() => { run(() => running ? bridge.stop() : bridge.start()) }}>
        {busy ? t('qwen.loading') : running ? t('qwen.stop') : t('qwen.start')}
      </Button>
    </div>
    {(failed || state?.failure !== undefined) && <div role="alert">{t(state?.failure === 'settings' ? 'qwen.settingsError' : 'qwen.error')}</div>}
    {state !== undefined && <>
      <label className={css.row}><span>{t('qwen.autoStart')}</span><Switch label={t('qwen.autoStart')}
        checked={state.autoStart} disabled={disabled}
        onChange={(autoStart) => { run(() => bridge.configure({ ...preferences(state), autoStart })) }} /></label>
      <label className={css.row}><span>{t('qwen.stopOnExit')}</span><Switch label={t('qwen.stopOnExit')}
        checked={state.stopOnExit} disabled={disabled}
        onChange={(stopOnExit) => { run(() => bridge.configure({ ...preferences(state), stopOnExit })) }} /></label>
      <label className={css.row}><span>{t('qwen.raiseGpuLimit')}</span><Switch label={t('qwen.raiseGpuLimit')}
        checked={state.raiseGpuLimit} disabled={disabled}
        onChange={(raiseGpuLimit) => { run(() => bridge.configure({ ...preferences(state), raiseGpuLimit })) }} /></label>
      <div className={css.description} role={state.gpuLimit === 'error' ? 'alert' : undefined}>
        {t(`qwen.gpuLimit.${state.gpuLimit}`, { mb: state.gpuLimitMb })}
      </div>
    </>}
  </div>
}
