import type { ReactNode } from 'react'

/** The frame every screen sits in: a title row with optional actions, then the content. */
/** `fill` makes the page exactly as tall as the window, for a screen that must fit without scrolling. */
export function Page({ title, subtitle, actions, children, fill }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; fill?: boolean }) {
  return (
    <section className={`page${fill ? ' page-fill' : ''}`}>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      <div className="page-body">{children}</div>
    </section>
  )
}

export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  )
}
