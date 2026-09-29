/** Direct Settings launcher for the sidebar footer. */
import { useEffect, useRef, useState } from 'react'
import { IconSettingsOutlineMedium, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { SignInDialog } from './SignInDialog.tsx'
import { AccountNoticeCard } from './AccountNotice.tsx'
import css from './AccountMenu.module.css'

/** Settings trigger composed by the settings shell. */
export type AccountMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.account'> & InjectFace<AccountSectionInjected>

/** @param props - sidebar geometry, settings navigation, and account notices. @returns direct Settings button. */
export function AccountMenu({
  subscribeSessionExpired, subscribeModelSignInRequired, wide, settingsShortcut, openSettings, settingsOpen,
  refreshAccount, showLogin, openOnboarding, start, cancel, bonusNoticeShown, bonusNoticeDismissed,
  readCodexWeeklyQuota, useAccount, useTheme, t,
}: AccountMenuProps) {
  const anchor = useRef<HTMLDivElement>(null)
  const account = useAccount(state => state)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const [signInNotice, setSignInNotice] = useState(0)
  useEffect(() => subscribeModelSignInRequired?.(() => { setSignInNotice(value => value + 1) }), [subscribeModelSignInRequired])
  const [expiryNotice, setExpiryNotice] = useState(false)
  useEffect(() => subscribeSessionExpired?.(() => { setExpiryNotice(true) }), [subscribeSessionExpired])
  const [weeklyQuota, setWeeklyQuota] = useState<{ readonly remainingPercent: number; readonly resetsAt: number | null } | null>(null)
  useEffect(() => {
    if (readCodexWeeklyQuota === undefined) return
    let active = true
    const refresh = () => {
      void readCodexWeeklyQuota().then((value) => {
        if (active) setWeeklyQuota(value)
      }).catch(() => {})
    }
    refresh()
    const interval = window.setInterval(refresh, 5 * 60_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [readCodexWeeklyQuota])
  const signedIn = account.view?.status === 'credential-stored'
  const settingsWasOpen = useRef(false)
  useEffect(() => {
    if (settingsOpen && !settingsWasOpen.current) void refreshAccount()
    settingsWasOpen.current = settingsOpen
  }, [refreshAccount, settingsOpen])
  return <div ref={anchor} className={css.root}>
    {signInNotice > 0 && <Toast key={signInNotice} text={t('modelSignInRequired')} onDone={() => { setSignInNotice(0) }} />}
    {expiryNotice && <Toast text={t('sessionExpired')} onDone={() => { setExpiryNotice(false) }} />}
    {signedIn && account.notice && <AccountNoticeCard key={account.notice.orderId} notice={account.notice}
      anchor={anchor} title={t('bonusNoticeTitle')} closeLabel={t('close')}
      onShown={bonusNoticeShown} onDismiss={bonusNoticeDismissed} />}
    {wide && weeklyQuota !== null && <div className={css.quota}
      title={weeklyQuota.resetsAt === null ? undefined : new Date(weeklyQuota.resetsAt * 1000).toLocaleString()}>
      <span className={css.quotaLabel}>{t('openaiWeeklyUsage')}</span>
      <span className={css.quotaValue}>{weeklyQuota.remainingPercent}% {t('remainingThisWeek')}</span>
    </div>}
    <button type="button" className={css.trigger} data-collapsed={!wide} data-row="true"
      aria-label={t('settings')} aria-keyshortcuts={settingsShortcut?.aria}
      aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={openSettings}>
      <IconSettingsOutlineMedium size={16} />
      {wide && <span className={css.label}>{t('settings')}</span>}
    </button>
    {account.loginVisible && !account.onboarding && <SignInDialog account={account} colorScheme={colorScheme}
      start={start} cancel={cancel} t={t} close={() => { showLogin(false) }}
      useApiKey={() => { showLogin(false); openOnboarding('deepseek-official') }} />}
  </div>
}
