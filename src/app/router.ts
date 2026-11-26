import { useEffect, useState } from 'react'

// A hash router: `#/groups/g-1` is ["groups", "g-1"]. Enough for a studio served as static files, and it adds no dependency.
const parse = (hash: string): string[] => hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)

export function useRoute(): string[] {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/** `go('groups/g-1')` */
export function go(path: string) {
  window.location.hash = `#/${path.replace(/^\//, '')}`
}

export const href = (path: string) => `#/${path.replace(/^\//, '')}`
