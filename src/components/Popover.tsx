import { useEffect, useRef, useState, type ReactNode } from 'react'

interface PopoverProps {
  trigger: (opts: { open: boolean; toggle: () => void }) => ReactNode
  children: ReactNode | ((opts: { close: () => void }) => ReactNode)
  align?: 'left' | 'right'
}

export default function Popover({ trigger, children, align = 'left' }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className="plm-menu"
          style={{
            position: 'absolute',
            top: '100%',
            marginTop: 4,
            zIndex: 20,
            ...(align === 'left' ? { left: 0 } : { right: 0 }),
          }}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  )
}
