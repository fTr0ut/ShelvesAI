import { useState } from 'react'
import axios from 'axios'
import './App.css'

export default function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(null)

  const handleLogin = async (e) => {
    e.preventDefault()
    try {
      // In dev, consider a Vite proxy or use relative path if your Express serves the same origin in prod
      const res = await axios.post('http://localhost:5000/api/login', {
        username,
        password,
      })
      setMessage(`Logged in as ${res.data?.user ?? username}`)
    } catch (err) {
      setMessage(err.response?.data?.error || 'Login failed')
      console.error(err)
    }
  }

  return (
    <div className="app">
      <h1>Login</h1>
      <form onSubmit={handleLogin}>
        <input
          value={username}
          placeholder="Username"
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          value={password}
          type="password"
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit">Login</button>
      </form>
      {message && <p>{message}</p>}
    </div>
  )
}

