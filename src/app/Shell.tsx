import { useEffect } from 'react'
import { Icon, type IconName } from './icons'
import { go, href, useRoute } from './router'
import { Empty } from './Page'
import { Groups } from '../screens/Groups'
import { GroupDetail } from '../screens/GroupDetail'
import { Streams } from '../screens/Streams'
import { Library } from '../screens/Library'
import { Playlists } from '../screens/Playlists'
import { Outputs } from '../screens/Outputs'
import { SettingsScreen } from '../screens/Settings'
import { Replay } from '../screens/Replay'

const NAV: { path: string; label: string; icon: IconName }[] = [
  { path: 'groups', label: 'Groups', icon: 'groups' },
  { path: 'streams', label: 'Streams', icon: 'streams' },
  { path: 'library', label: 'Library', icon: 'library' },
  { path: 'playlists', label: 'Playlists', icon: 'playlists' },
  { path: 'outputs', label: 'Outputs', icon: 'outputs' },
]

function Screen({ route }: { route: string[] }) {
  const [a, b] = route
  if (!a || (a === 'groups' && !b)) return <Groups />
  if (a === 'groups' && b) return <GroupDetail id={b} />
  if (a === 'streams') return <Streams />
  if (a === 'library') return <Library />
  if (a === 'playlists') return <Playlists />
  if (a === 'outputs') return <Outputs />
  if (a === 'settings') return <SettingsScreen />
  if (a === 'replay') return <Replay groupId={b} />
  return (
    <div className="page">
      <Empty title="That page doesn't exist" action={<a className="btn" href={href('groups')}>Back to groups</a>}>
        Check the address, or start from your groups.
      </Empty>
    </div>
  )
}

/** The rail, then the current screen. */
export function Shell() {
  const route = useRoute()
  const active = !route[0] || route[0] === 'replay' ? 'groups' : route[0]
  useEffect(() => {
    if (!window.location.hash) go('groups')
  }, [])
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <a className="rail-mark" href={href('groups')} aria-label="Open Replay, groups" title="Open Replay">
          OR
        </a>
        {NAV.map((n) => (
          <a key={n.path} className={`rail-item${active === n.path ? ' active' : ''}`} href={href(n.path)} title={n.label} aria-label={n.label} aria-current={active === n.path ? 'page' : undefined}>
            <Icon name={n.icon} size={20} />
            <span>{n.label}</span>
          </a>
        ))}
        <span className="rail-spacer" />
        <a className={`rail-item${active === 'settings' ? ' active' : ''}`} href={href('settings')} title="Settings" aria-label="Settings" aria-current={active === 'settings' ? 'page' : undefined}>
          <Icon name="settings" size={20} />
          <span>Settings</span>
        </a>
      </nav>
      <main className="content">
        <Screen route={route} />
      </main>
    </div>
  )
}
