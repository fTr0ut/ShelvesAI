import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppLayout, Button, Card, Hero } from '../components'
import { LEGACY_BASE_PATH, legacyPath } from '../legacy/constants.js'
import { CollectableProvider, useCollectable } from '../data/CollectableProvider'

function CollectableContent() {
  const { collectable, loading, error } = useCollectable()

  if (loading) return <AppLayout><div className="message info">Loading collectable...</div></AppLayout>
  if (error) return <AppLayout><div className="message error">{error}</div><p><Button as={Link} to={legacyPath('/shelves')}>Back to shelves</Button></p></AppLayout>
  if (!collectable) return <AppLayout><div className="message error">Collectable not found</div><p><Button as={Link} to={legacyPath('/shelves')}>Back to shelves</Button></p></AppLayout>

  const rows = [
    { label: 'Type', value: collectable.type },
    { label: 'Author / Creator', value: collectable.author },
    { label: 'Format', value: collectable.format },
    { label: 'Publisher', value: collectable.publisher },
    { label: 'Year', value: collectable.year },
    { label: 'Description / Notes', value: collectable.description },
  ].filter((row) => row.value)

  return (
    <AppLayout>
      <Hero title={collectable.name} description="Detailed metadata for this catalog entry." />

      <Card style={{ maxWidth: 640 }}>
        <div className="stack" style={{ gap: 14 }}>
          {rows.length ? rows.map((row) => (
            <div key={row.label}>
              <div className="label" style={{ marginBottom: 4 }}>{row.label}</div>
              <div>{row.value}</div>
            </div>
          )) : (
            <div className="message info">No additional metadata available.</div>
          )}
        </div>
      </Card>

      <p style={{ marginTop: 16 }}>
        <Button as={Link} to={legacyPath('/shelves')}>Back to shelves</Button>
      </p>
    </AppLayout>
  )
}

export default function CollectableDetail({ apiBase = '' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const token = useMemo(() => localStorage.getItem('token') || '', [])

  useEffect(() => {
    if (!token) {
      navigate(LEGACY_BASE_PATH)
    }
  }, [navigate, token])

  if (!token) return null

  return (
    <CollectableProvider apiBase={apiBase} token={token} collectableId={id}>
      <CollectableContent />
    </CollectableProvider>
  )
}
