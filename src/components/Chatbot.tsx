import { useEffect, useMemo, useRef, useState } from 'react'
import { getChatbotOptions, propertySearch, sendChat } from '../services/api'
function log(...args: any[]) { console.log('[ui]', ...args) }

type QuickButton = { label: string; value: string }

type Message = {
  id: string
  sender: 'Bot' | 'You'
  text: string
  html?: string | null
  buttons?: QuickButton[] | null
  dropdown?: QuickButton[] | null
}

type SearchState = {
  price?: number
  intBeds?: number
  city?: string
}

type Props = {
  visible: boolean
  onClose: () => void
}

export function Chatbot({ visible, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [options, setOptions] = useState<{ prices: number[]; beds: number[]; cities: string[] } | null>(null)
  const [searchState, setSearchState] = useState<SearchState>(() => {
    try {
      const saved = localStorage.getItem('chatbot_search_state')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  const [pagination, setPagination] = useState({ currentPage: 1, itemsPerPage: 3 })
  const allPropertiesRef = useRef<any[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const userIdRef = useRef<string>('')

  const bootedRef = useRef(false)
  useEffect(() => {
    if (!visible || bootedRef.current) return
    bootedRef.current = true
    log('Booting chatbot UI')
    appendBot("Hi")
    getChatbotOptions()
      .then((o) => { setOptions(o); log('Loaded options', o) })
      .catch((e) => { console.warn('[ui] options error', e); setOptions(null) })
    // Kick off onboarding without requiring user input
    void sendPrompt('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  useEffect(() => {
    try {
      localStorage.setItem('chatbot_search_state', JSON.stringify(searchState))
      log('Saved searchState', searchState)
    } catch {}
  }, [searchState])

  // Ensure we have a persistent user id for the authenticated Python API
  useEffect(() => {
    const key = 'chatbot_user_id'
    let uid = localStorage.getItem(key) || ''
    if (!uid) {
      uid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `user_${Date.now()}`
      try { localStorage.setItem(key, uid) } catch {}
    }
    userIdRef.current = uid
    log('User ID ready', { userId: uid })
  }, [])

  

  const bedButtons = useMemo(() => {
    if (!options?.beds) return null
    return options.beds.map((b) => (
      <button key={b} className="chatbot-step-btn" onClick={() => selectBeds(b)}>{b} Bed</button>
    ))
  }, [options])

  const cityButtons = useMemo(() => {
    if (!options?.cities) return null
    return options.cities.map((c) => (
      <button key={c} className="chatbot-step-btn" onClick={() => selectCity(c)}>{c}</button>
    ))
  }, [options])

  function append(sender: Message['sender'], text: string, html?: string | null, buttons?: QuickButton[] | null, dropdown?: QuickButton[] | null) {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), sender, text, html: html || null, buttons: buttons || null, dropdown: dropdown || null }])
    requestAnimationFrame(() => {
      const el = containerRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  function appendBot(text: string, html?: string | null, buttons?: QuickButton[] | null, dropdown?: QuickButton[] | null) {
    append('Bot', text, html, buttons, dropdown)
  }

  function appendYou(text: string) {
    append('You', text)
  }

  

  function selectBeds(intBeds: number) {
    log('Select beds', intBeds)
    setSearchState((s) => ({ ...s, intBeds }))
    appendYou(`${intBeds} bedroom`)
    setTimeout(() => {
      appendBot('Which city are you interested in?')
    }, 400)
  }

  function selectCity(city: string) {
    log('Select city', city)
    setSearchState((s) => ({ ...s, city }))
    appendYou(city)
    runPropertySearch()
  }

  function runPropertySearch() {
    log('Run property search with state', searchState)
    const params: Record<string, string | number> = {}
    if (searchState.price) params.price = searchState.price
    if (searchState.intBeds) params.intBeds = searchState.intBeds
    if (searchState.city) params.location = searchState.city

    appendBot(
      `Searching properties${
        searchState.price ? ` under CI$${(searchState.price / 100000).toFixed(1)}M` : ''
      }${searchState.intBeds ? `, ${searchState.intBeds} bedroom(s)` : ''}${
        searchState.city ? ` in ${searchState.city}` : ''
      }...`
    )

    propertySearch(params)
      .then((data) => {
        const list = Array.isArray(data?.properties) ? data.properties : []
        log('Search response', { count: list.length })
        allPropertiesRef.current = list
        setPagination((p) => ({ ...p, currentPage: 1 }))
        if (list.length === 0) {
          appendBot('No properties found for your criteria.')
          return
        }
        const count = list.length
        const html = renderProperties(list.slice(0, 3), count > 3 ? count - 3 : 0)
        appendBot(`Found ${count} ${count === 1 ? 'property' : 'properties'} for your criteria:`, html)
      })
      .catch((err) => { console.error('[ui] propertySearch error', err); appendBot('Failed to fetch property listings.') })
  }

  function showMore() {
    log('Show more clicked')
    const { currentPage, itemsPerPage } = pagination
    const nextPage = currentPage + 1
    const start = (nextPage - 1) * itemsPerPage
    const end = Math.min(start + itemsPerPage, allPropertiesRef.current.length)
    const next = allPropertiesRef.current.slice(start, end)
    if (next.length === 0) return

    const remaining = allPropertiesRef.current.length - end
    const html = renderProperties(next, remaining)
    appendBot('', html)
    setPagination((p) => ({ ...p, currentPage: nextPage }))
  }

  function renderProperties(items: any[], remaining: number) {
    log('Render properties', { items: items.length, remaining })
    const cards = items
      .map((item) => {
        const title = item.varTitle || item.title || item.name || 'No Title'
        const priceVal = item.decPrice ?? item.price ?? item.listPrice ?? null
        const price = priceVal !== null ? Number(priceVal) : null
        const priceStr = price !== null ? `CI$${price.toLocaleString()}` : 'N/A'
        const beds = item.intBeds?? ''
        const baths = item.intBaths ?? ''
        const city = item.city_name ?? item.city ?? item.location ?? item.address ?? ''
        const img = item.image_url || item.image || item.thumbnail_url || item.thumbnail || ''
        const descRaw = item.details || item.description || ''
        const desc = typeof descRaw === 'string' ? descRaw.slice(0, 140) : ''
        const mls = item.varMLS || ''

        return `
          <div class="property-listing-card">
            <div class="property-thumb">${img ? `<img src="${img}" alt="${title}" />` : ''}</div>
            <div>
              <div class="property-title">${title}</div>
              <div class="property-price">${priceStr}</div>
              <div class="property-meta">
                ${mls ? `<span>MLS: ${mls}</span>` : ''}
                ${beds ? `<span>🛏️  ${beds} bed</span>` : ''}
                ${baths ? `<span>🚿  ${baths} bath</span>` : ''}
                ${city ? `<span class="property-city">📍  ${city}</span>` : ''}
              </div>
              ${desc ? `<div class="property-details">${desc}...</div>` : ''}
  
            </div>
          </div>
        `
      })
      .join('')

    const button =
      remaining > 0
        ? `<div style="text-align:center; margin:12px 0;"><button id="chatbot-show-more" class="chatbot-step-btn">Show More Properties (${remaining} more)</button></div>`
        : ''

    // Bind after insert from useEffect in MessageList
    setTimeout(() => {
      const btn = document.getElementById('chatbot-show-more')
      if (btn) btn.onclick = () => showMore()
    }, 50)

    return `<div>${cards}${button}</div>`
  }

  function sendPrompt(text: string) {
    // Call authenticated Python /chatbot endpoint with user_id, prompt, and current search context
    return sendChat({
      user_id: userIdRef.current,
      prompt: text,
      property_data: {
        ...(searchState.price !== undefined ? { price: searchState.price } : {}),
        ...(searchState.intBeds !== undefined ? { intBeds: searchState.intBeds } : {}),
        ...(searchState.city ? { location: searchState.city } : {})
      }
    })
      .then((resp) => {
        log('sendChat response', { hasResult: !!resp?.result, props: Array.isArray(resp?.properties) ? resp.properties.length : 0 })
        // Render message depending on reply type
        const replyType = typeof resp?.type === 'string' ? resp.type.toLowerCase() : ''
        const responseUi = typeof resp?.response_type === 'string' ? resp.response_type.toLowerCase() : ''

        // Normalize option arrays from various possible backend fields
        const normalizeOptions = (arr: any[]): QuickButton[] => {
          if (!Array.isArray(arr)) return []
          if (arr.length > 0 && typeof arr[0] === 'string') {
            return arr.map((s: string) => ({ label: String(s), value: String(s) }))
          }
          return arr.map((o: any) => ({
            label: String(o?.label ?? o?.text ?? o?.name ?? o?.title ?? o?.value ?? o?.id ?? ''),
            value: String(o?.value ?? o?.id ?? o?.label ?? o?.text ?? o?.name ?? '')
          }))
        }

        const rawButtons = Array.isArray((resp as any)?.buttons)
          ? (resp as any).buttons
          : (Array.isArray((resp as any)?.options) ? (resp as any).options : (Array.isArray((resp as any)?.choices) ? (resp as any).choices : null))
        const rawDropdown = Array.isArray((resp as any)?.dropdown)
          ? (resp as any).dropdown
          : (Array.isArray((resp as any)?.select_options) ? (resp as any).select_options : null)

        const buttons = rawButtons ? normalizeOptions(rawButtons) : null
        const dropdown = rawDropdown ? normalizeOptions(rawDropdown) : null

        const isDropdown = ['dropdown', 'select', 'list', 'menu'].includes(responseUi)
        const isButtons = ['buttons', 'button', 'quick_replies', 'options', 'chips'].includes(responseUi)
        if (replyType === 'onboarding') {
          // For 'onboarding', prefer HTML content and avoid duplicating plain text
          if (isDropdown && dropdown && dropdown.length > 0) {
            // For onboarding dropdown, show only the control (no lead text)
            appendBot('', null, null, dropdown)
          } else if (isButtons && buttons && buttons.length > 0) {
            // For onboarding buttons, show only the controls (no lead text)
            appendBot('', null, buttons, null)
          } else if (resp?.html && resp.html.trim().length > 0) {
            appendBot('', resp.html, buttons, null)
          } else if (typeof resp?.result === 'string' && resp.result.trim().length > 0) {
            // Fallback to normal text if no HTML provided
            appendBot(resp.result.trim(), null, buttons, null)
          }
        } else {
          // Default behavior for other categories
          if (typeof resp?.result === 'string' && resp.result.trim().length > 0) {
            if (isButtons && buttons && buttons.length > 0) {
              // Only attach buttons when backend explicitly asks for them
              appendBot(resp.result.trim(), resp?.html || null, buttons, null)
            } else {
              // Plain message without accidental buttons
              appendBot(resp.result.trim(), resp?.html || null, null, null)
            }
          }
        }

        // Render properties if provided
        const list = Array.isArray(resp?.properties) ? resp.properties : []
        allPropertiesRef.current = list
        setPagination((p) => ({ ...p, currentPage: 1 }))

        if (list.length > 0) {
          const count = list.length
          const html = renderProperties(list.slice(0, 3), count > 3 ? count - 3 : 0)
          appendBot(`Found ${count} ${count === 1 ? 'property' : 'properties'}:`, html)
        }
      })
      .catch((err: unknown) => {
        console.error('[ui] sendChat error', err)
        const msg = err instanceof Error ? err.message : 'Failed to contact assistant.'
        appendBot(msg)
      })
  }

  function onSend() {
    const text = input.trim()
    if (!text) return
    log('User send', { text })
    appendYou(text)
    setInput('')
    void sendPrompt(text)
  }

  function onQuick(value: string) {
    const text = String(value)
    appendYou(text)
    void sendPrompt(text)
  }

  if (!visible) return null

  return (
    <div className="chatbot-container">
      <div className="chatbot-modal">
        <div className="chatbot-header">
          <div className="chatbot-title">Crighton Properties</div>
          <div className="chatbot-subtitle">AI PROPERTY ASSISTAN</div>
          <button className="chatbot-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div ref={containerRef} className="chatbot-messages">
          {messages.map((m) => (
            <div key={m.id} className={m.sender === 'Bot' ? 'bot-message' : 'user-message'}>
              {m.text && <div className="message-text">{m.text}</div>}
              {m.html && <div className="message-html" dangerouslySetInnerHTML={{ __html: m.html }} />}
              {Array.isArray(m.buttons) && m.buttons.length > 0 && (
                <div className="message-actions" style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {m.buttons.map((b, idx) => (
                    <button key={idx} className="chatbot-step-btn" onClick={() => onQuick(b.value)}>{b.label}</button>
                  ))}
                </div>
              )}
              {Array.isArray(m.dropdown) && m.dropdown.length > 0 && (
                <div className="message-actions" style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select id={`chatbot-dropdown-${m.id}`} className="chatbot-select">
                    {m.dropdown.map((opt, idx) => (
                      <option key={idx} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button className="chatbot-step-btn" onClick={() => {
                    const el = document.getElementById(`chatbot-dropdown-${m.id}`) as HTMLSelectElement | null
                    const val = el?.value || ''
                    if (val) onQuick(val)
                  }}>Submit</button>
                </div>
              )}
            </div>
          ))}
        
          {searchState.price !== undefined && searchState.intBeds === undefined && (
            <div className="option-group">
              <div className="label">Select bedroom size:</div>
              <div className="options-row">{bedButtons}</div>
            </div>
          )}
          {searchState.intBeds !== undefined && searchState.city === undefined && (
            <div className="option-group">
              <div className="label">Select city:</div>
              <div className="options-row">{cityButtons}</div>
            </div>
          )}
        </div>
        <div className="chat-input-area">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSend() }}
            placeholder="Type your property search request..."
            maxLength={500}
          />
          <button onClick={onSend} aria-label="Send">→</button>
        </div>
      </div>
      <div className="chatbot-fab" style={{ display: 'none' }}>💬</div>
    </div>
  )
}


