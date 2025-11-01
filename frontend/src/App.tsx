import React, { useRef, useState, useEffect } from 'react'
import { ask } from './api'
import type { ChatMessage } from './types'

const DEFAULT_CHANNEL = (import.meta.env.VITE_DEFAULT_CHANNEL as string) || 'theaicoderbot'

export default function App() {
  const [channel, setChannel] = useState(DEFAULT_CHANNEL)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const initialHeightRef = useRef<number | null>(null)
  const [allowGrow, setAllowGrow] = useState(false)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const [showToBottom, setShowToBottom] = useState(false)

  const scrollToBottom = () => {
    const el = transcriptRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }

  const scrollToBottomSmooth = () => {
    const el = transcriptRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const autoSize = () => {
    const el = textareaRef.current
    if (!el) return
    if (!allowGrow) return
    el.style.height = 'auto'
    const max = 200 // px
    el.style.height = Math.min(max, el.scrollHeight) + 'px'
  }

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (initialHeightRef.current == null) {
      // Capture the natural one-line height once and lock it
      initialHeightRef.current = el.clientHeight
      el.style.height = initialHeightRef.current + 'px'
    }
  }, [])

  useEffect(() => { scrollToBottom() }, [messages])

  // Toggle the to-bottom button based on how far from bottom the user has scrolled
  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowToBottom(distance > 24)
    }
    el.addEventListener('scroll', onScroll)
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const typeOutAnswer = async (text: string, speedMs = 28) => {
    // append placeholder assistant message
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
    await new Promise<void>((resolve) => {
      let i = 0
      const timer = setInterval(() => {
        i += 1
        setMessages((prev) => {
          const next = [...prev]
          const last = next.length - 1
          if (last >= 0) {
            next[last] = { ...next[last], content: text.slice(0, i) }
          }
          return next
        })
        scrollToBottom()
        if (i >= text.length) {
          clearInterval(timer)
          resolve()
        }
      }, speedMs)
    })
  }

  const resetSize = () => {
    const el = textareaRef.current
    if (!el) return
    const baseline = initialHeightRef.current || 40
    el.style.height = baseline + 'px'
    setAllowGrow(false)
  }

  const send = async () => {
    const q = input.trim()
    if (!q) return
    setMessages((m) => [...m, { role: 'user', content: q }])
    setInput('')
    resetSize()
    setLoading(true)
    try {
      const { answer } = await ask(q, channel)
      await typeOutAnswer(answer)
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Error fetching answer.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="layout">
      <header className="header">
        <h2 className="title"><span className="title-bubble">Twitch Streamer Assistant</span></h2>
        <div className="channel">
          <label htmlFor="channel-input">Channel</label>
          <input id="channel-input" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="twitch_channel" />
        </div>
      </header>

      <section className="panel">
        <div className="transcript" ref={transcriptRef}>
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>{m.content}</div>
          ))}
          {loading && <div className="msg assistant thinking">Thinking…</div>}
        </div>

        {showToBottom && (
          <button className="to-bottom" onClick={scrollToBottomSmooth} aria-label="Scroll to bottom">
            <span className="arrow">⬇️</span>
            New messages
          </button>
        )}

        <div className="composer">
          <div className="input-wrap">
            <textarea
              ref={textareaRef}
              className="input"
              value={input}
              onChange={(e) => {
                const val = e.target.value
                setInput(val)
                // Enable growth when user adds a newline
                const hasNewline = val.includes('\n')
                if (hasNewline && !allowGrow) setAllowGrow(true)
                if (allowGrow) {
                  autoSize()
                } else {
                  // Keep fixed at baseline
                  const el = textareaRef.current
                  if (el && initialHeightRef.current != null) {
                    el.style.height = initialHeightRef.current + 'px'
                  }
                }
              }}
              onInput={() => { if (allowGrow) autoSize() }}
              placeholder="Ask your chat anything… (Enter to send, Shift+Enter for new line)"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.shiftKey) {
                  // Explicitly allow growth on Shift+Enter then autosize
                  if (!allowGrow) {
                    setAllowGrow(true)
                    setTimeout(autoSize, 0)
                  }
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button className="send-embedded" onClick={send} disabled={loading}>Send</button>
          </div>
        </div>
      </section>

      <footer className="footer">Powered by DynamoDB + OpenAI · Session-based analysis · Created by nathanhadi</footer>
    </div>
  )
}


