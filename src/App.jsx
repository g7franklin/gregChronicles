import { useState, useEffect } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export default function App() {
  const [gmailConnected, setGmailConnected] = useState(false)
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem('openai_api_key') || '')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [emails, setEmails] = useState([])
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/gmail/status`)
      .then((r) => r.json())
      .then((d) => setGmailConnected(d.connected))
      .catch(() => setGmailConnected(false))
  }, [])

  useEffect(() => {
    if (openaiKey) localStorage.setItem('openai_api_key', openaiKey)
  }, [openaiKey])

  const connectGmail = () => {
    window.location.href = `${API_BASE}/auth/gmail`
  }

  const fetchEmails = () => {
    setError('')
    fetch(`${API_BASE}/api/emails`)
      .then((r) => {
        if (!r.ok) throw new Error('Not connected or token expired')
        return r.json()
      })
      .then((d) => setEmails(d.emails || []))
      .catch((e) => setError(e.message))
  }

  const askAgent = async (e) => {
    e.preventDefault()
    if (!question.trim()) return
    setError('')
    setAnswer('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          openaiApiKey: openaiKey || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setAnswer(data.answer)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Gmail + Email Agent</h1>
        <p className="subtitle">Connect Gmail, then ask questions about your email.</p>
      </header>

      <section className="card settings-card">
        <h2>Settings</h2>
        <div className="setting">
          <label>OpenAI API key</label>
          <div className="input-row">
            <input
              type={showKey ? 'text' : 'password'}
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
              className="input"
            />
            <button type="button" onClick={() => setShowKey(!showKey)} className="btn btn-ghost">
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="hint">Stored in this browser only. Used to answer questions about your email.</p>
        </div>
        <div className="setting">
          <label>Gmail</label>
          {gmailConnected ? (
            <p className="status connected">Connected</p>
          ) : (
            <button type="button" onClick={connectGmail} className="btn btn-primary">
              Connect Gmail
            </button>
          )}
        </div>
      </section>

      {gmailConnected && (
        <section className="card">
          <h2>Recent emails</h2>
          <button type="button" onClick={fetchEmails} className="btn btn-ghost">
            Refresh list
          </button>
          {emails.length > 0 && (
            <ul className="email-list">
              {emails.slice(0, 10).map((e) => (
                <li key={e.id}>
                  <strong>{e.subject || '(no subject)'}</strong> — {e.from} — {e.date}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card ask-card">
        <h2>Ask about your email</h2>
        <form onSubmit={askAgent}>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What did Sarah reply about the meeting?"
            className="input ask-input"
            disabled={loading}
          />
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Asking…' : 'Ask'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {answer && (
          <div className="answer-box">
            <strong>Agent:</strong>
            <p className="answer-text">{answer}</p>
          </div>
        )}
      </section>
    </div>
  )
}
