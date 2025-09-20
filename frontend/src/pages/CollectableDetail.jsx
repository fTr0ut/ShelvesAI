import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

export default function CollectableDetail({ apiBase = '' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const token = useMemo(() => localStorage.getItem('token') || '', [])
  const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  const base = apiBase || envBase

  const [collectable, setCollectable] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      navigate('/')
      return
    }
    const fetchCollectable = async () => {
      try {
        setLoading(true)
        const res = await fetch(`${base}/api/collectables/${id}`, { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Collectable not found')
        setCollectable(data.collectable)
        setError('')
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchCollectable()
  }, [base, id, navigate, token])

  if (loading) return <div className="app"><div className="message info">Loading collectable...</div></div>
  if (error) return <div className="app"><div className="message error">{error}</div><p><Link className="btn" to="/shelves">Back to shelves</Link></p></div>
  if (!collectable) return <div className="app"><div className="message error">Collectable not found</div><p><Link className="btn" to="/shelves">Back to shelves</Link></p></div>

  const rows = [
    { label: 'Type', value: collectable.type },
    { label: 'Author / Creator', value: collectable.author },
    { label: 'Format', value: collectable.format },
    { label: 'Publisher', value: collectable.publisher },
    { label: 'Year', value: collectable.year },
    { label: 'Description / Notes', value: collectable.description },
  ].filter((row) => row.value)

  return (
    <div className="app">
      <div className="hero">
        <h1>{collectable.name}</h1>
        <p className="label">Detailed metadata for this catalog entry.</p>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
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
      </div>

      <p style={{ marginTop: 16 }}>
        <Link className="btn" to="/shelves">Back to shelves</Link>
      </p>
    </div>
  )
}

