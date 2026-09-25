// The screen and route map (SPEC §9.4).
import { useEffect } from 'react'
import { Route, Switch, useLocation } from 'wouter'
import { NotFound, Placeholder } from '@/components/layout/placeholder'
import { Home } from '@/features/safes/home'
import { isSetupDone, setReturnTo } from '@/features/setup/return-to'
import { SetupScreen } from '@/features/setup/setup-screen'
import { useLoadedSettings } from '@/queries/settings'

const SAFE = '/safe/:chainId/:address'

/** Routes that work before setup is done: setup itself, opening a shared link, and Verify. */
export const openBeforeSetup = (location: string) =>
  location === '/setup' ||
  location === '/import' ||
  location.startsWith('/import/') ||
  location === '/verify'

export function Routes() {
  const settings = useLoadedSettings()
  const [location, navigate] = useLocation()
  const gated = !isSetupDone(settings) && !openBeforeSetup(location)

  useEffect(() => {
    if (gated) {
      // A plain first visit goes on to Add a Safe after setup (SPEC §3.1), not back home.
      if (location !== '/') setReturnTo(location)
      navigate('/setup', { replace: true })
    }
  }, [gated, location, navigate])
  if (gated) return null

  return (
    <Switch>
      <Route path="/setup">
        <SetupScreen settings={settings} />
      </Route>
      <Route path="/" component={Home} />
      <Route path="/add">
        <Placeholder title="Add a Safe" step={3} />
      </Route>
      <Route path={SAFE}>
        <Placeholder title="Safe" step={3} />
      </Route>
      <Route path={`${SAFE}/queue`}>
        <Placeholder title="Queue" step={10} />
      </Route>
      <Route path={`${SAFE}/history`}>
        <Placeholder title="History" step={10} />
      </Route>
      <Route path={`${SAFE}/new`}>
        <Placeholder title="New transaction" step={4} />
      </Route>
      <Route path={`${SAFE}/new/:preset`}>
        <Placeholder title="New transaction" step={4} />
      </Route>
      <Route path={`${SAFE}/review`}>
        <Placeholder title="Review" step={5} />
      </Route>
      <Route path={`${SAFE}/tx/:safeTxHash`}>
        <Placeholder title="Review" step={5} />
      </Route>
      <Route path="/import">
        <Placeholder title="Import" step={6} />
      </Route>
      <Route path="/import/:payload">
        <Placeholder title="Import" step={6} />
      </Route>
      <Route path="/verify">
        <Placeholder title="Verify" step={13} />
      </Route>
      <Route path="/settings">
        <Placeholder title="Settings" step={14} />
      </Route>
      <Route path="/settings/:section">
        <Placeholder title="Settings" step={14} />
      </Route>
      <Route component={NotFound} />
    </Switch>
  )
}
