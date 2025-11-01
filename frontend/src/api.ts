import type { AskResponse } from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string

export async function ask(question: string, channel: string): Promise<AskResponse> {
  if (!API_BASE_URL) {
    console.error('VITE_API_BASE_URL is not set!')
    throw new Error('API URL not configured')
  }
  
  const res = await fetch(`${API_BASE_URL}/chat/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, channel })
  })
  
  if (!res.ok) {
    const errorText = await res.text()
    console.error('API error:', res.status, errorText)
    throw new Error(`API error: ${res.status} - ${errorText}`)
  }
  
  const data = await res.json()
  console.log('API response data:', data) // Debug: see what we actually get
  
  // Handle case where API Gateway returns raw Lambda response
  if (data.body) {
    // API Gateway didn't unwrap - parse the body
    const parsedBody = typeof data.body === 'string' ? JSON.parse(data.body) : data.body
    console.log('Parsed body:', parsedBody)
    return parsedBody
  }
  
  return data
}


