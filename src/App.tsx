import { useEffect, useState } from 'react'
import StructureExplorer from './components/StructureExplorer'
import { loadStructureData } from './data/structure'

type Status = 'loading' | 'ready' | 'error'

export default function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    loadStructureData()
      .then(() => setStatus('ready'))
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })
  }, [])

  if (status === 'loading') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', fontFamily: 'var(--font-body)', color: 'var(--color-text)' }}>
        Loading product structure…
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', fontFamily: 'var(--font-body)', color: 'var(--color-text)' }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 20, marginBottom: 8 }}>
            Couldn't reach the PLM API
          </div>
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 4 }}>{error}</div>
          <div style={{ fontSize: 12.5, opacity: 0.6 }}>
            Is the backend running? See SETUP.md — <code>npm run server</code> (and MySQL must be up and seeded).
          </div>
        </div>
      </div>
    )
  }

  return <StructureExplorer />
}
