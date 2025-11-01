import type { AskResponse } from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string

export async function ask(question: string, channel: string): Promise<AskResponse> {
  const res = await fetch(`${API_BASE_URL}/chat/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, channel })
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}


