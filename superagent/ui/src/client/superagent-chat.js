import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { call } from './api.js'
import { ChatRows } from './cells.js'
import { PendingQuestion } from './questions.js'
import { ArrowUpIcon } from './icons.js'
import { EMPTY_ROSTER } from './sources.js'
import { createFeed } from './feed.js'
import { t } from './i18n.js'

const roster = { ...EMPTY_ROSTER, ready: true }

function Evidence({ item }) {
  const [pages, setPages] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    setError(null)
    try {
      const after = pages.at(-1)?.pagination.cursor
      const page = await call('evidence', { ticketId: item.ticketId, ref: item.evidence, ...(after ? { after } : {}) })
      setPages(current => [...current, page])
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  return h('details', { onToggle: event => { if (event.currentTarget.open && pages.length === 0 && !busy) void load() } },
    h('summary', null, t('Evidence')),
    pages.map((page, index) => h('pre', { key: index, className: 'bt-q-detail' }, page.text)),
    error ? h('p', { role: 'alert' }, error) : null,
    pages.at(-1)?.pagination.truncated || error ? h('button', { type: 'button', className: 'bt-soft', disabled: busy, onClick: () => { void load() } }, error ? t('Retry') : t('Read more')) : null)
}

function Composer({ onSend, disabled }) {
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const field = useRef(null)
  const pending = useRef(null)
  const sending = useRef(false)
  useLayoutEffect(() => {
    const node = field.current
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [text])
  const submit = async () => {
    const value = text.trim()
    if (value === '' || disabled || sending.current) return
    sending.current = true
    setError(null)
    if (pending.current?.text !== value) pending.current = { requestId: crypto.randomUUID(), text: value }
    try {
      await onSend(pending.current)
      pending.current = null
      setText('')
    } catch (failure) { setError(failure.message) } finally { sending.current = false }
  }
  return h('div', { className: 'dsb-composer-wrap' },
    error ? h('p', { className: 'dsb-composer-error', role: 'alert' }, error) : null,
    h('div', { className: 'dsb-composer', 'data-composer-card': '', 'data-multiline': text.includes('\n') || undefined },
      h('div', { className: 'dsb-composer-input', 'data-input-scroll': '' },
        h('textarea', {
          ref: field, rows: 1, value: text, disabled, placeholder: t('Message Super-agent'), 'aria-label': t('Message Super-agent'), 'data-composer-input': '',
          onChange: event => setText(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
          },
        })),
      h('div', { className: 'dsb-composer-trailing' },
        h('button', { type: 'button', className: 'dsb-send', disabled: disabled || text.trim() === '', 'aria-label': t('Send message'), title: t('Send message'), onClick: () => { void submit() } }, h(ArrowUpIcon)))))
}

export function SuperagentChat() {
  const [view, setView] = useState({ items: [], tickets: [] })
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const feed = useMemo(() => createFeed(call, setView), [])
  const commands = useRef(new Map())
  const scroller = useRef(null)
  const follow = useRef(true)
  useEffect(() => {
    const controller = new AbortController()
    let timer
    const refresh = async () => {
      try { await feed.refresh(controller.signal); setError(null); setReady(true) }
      catch (failure) { if (!controller.signal.aborted) setError(failure.message) }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 1000)
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [feed])
  useLayoutEffect(() => {
    if (follow.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [view])
  const command = async (endpoint, payload) => {
    setBusy(true)
    const key = JSON.stringify([endpoint, payload])
    if (!commands.current.has(key)) commands.current.set(key, crypto.randomUUID())
    try {
      await call(endpoint, { ...payload, requestId: commands.current.get(key) })
      commands.current.delete(key)
      await feed.refresh()
    } catch (failure) { setError(failure.message); throw failure } finally { setBusy(false) }
  }
  const actions = {
    answerQuestion: (_sessionId, attentionId, answer) => {
      const ticket = view.tickets.find(item => item.attention?.id === attentionId)
      return command('answer', { ticketId: ticket.ticketId, attentionId, text: [...answer.selected, answer.custom].filter(Boolean).join('\n') })
    },
  }
  return h('main', { className: 'dsb-main dsb-superagent' },
    h('div', { className: 'dsb-head' }, h('div', { className: 'bt-head' }, h('div', { className: 'bt-pill' }, h('span', { className: 'bt-pill-name' }, 'Super-agent')))),
    h('div', { className: 'dsb-chat' },
      h('div', { ref: scroller, className: 'dsb-scroll', 'data-conversation-scroll': '', onScroll: () => {
        const node = scroller.current
        follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
      } }, h('div', { className: 'dsb-column' },
        h('div', { className: 'dsb-flow', 'data-chat-flow': '', role: 'feed', 'aria-label': t('Super-agent conversation') },
          view.items.map(item => h('div', { key: item.id, 'data-message-id': item.id },
            h(ChatRows, { items: [item], roster, actions }),
            item.evidence ? h(Evidence, { item }) : null)),
          view.tickets.map(ticket => h('section', { key: ticket.ticketId, 'aria-label': t('Work status') },
            h('p', { className: 'bt-q-detail', role: 'status' }, t(ticket.status)),
            ticket.attention ? h(PendingQuestion, { key: ticket.attention.id, sessionId: ticket.ticketId, inline: true,
              question: { id: ticket.attention.id, question: ticket.attention.question, options: ticket.attention.options, allowCustom: true }, actions }) : null,
            ticket.canStop || ticket.canResume ? h('button', { type: 'button', className: 'bt-soft', disabled: busy,
              onClick: () => { void command(ticket.canResume ? 'resume' : 'stop', { ticketId: ticket.ticketId }).catch(() => {}) } }, ticket.canResume ? t('Resume') : t('Stop')) : null)),
          error ? h('p', { role: 'alert', className: 'dsb-composer-error' }, error) : null))),
      h('div', { className: 'dsb-composer-root' }, h(Composer, { disabled: !ready || busy, onSend: async payload => {
        await call('send', payload)
        await feed.refresh()
      } }))))
}

export const CHAT_CSS = `
.dsb-main{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bt-main);--dsh-chat-content-width:min(960px,100%)}
.dsb-superagent{height:100%;width:100%;color:var(--bt-ink)}
.dsb-head{position:absolute;top:0;left:0;right:0;z-index:8;display:flex;justify-content:center;padding:4px 0 0;pointer-events:none}
.dsb-head .bt-head{flex:1 1 auto;width:100%}
.dsb-chat{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.dsb-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;scrollbar-gutter:stable;margin-right:2px;padding:60px 11px 16px 16px}
.dsb-column{max-width:min(960px,100%);margin:0 auto}
.dsb-flow{display:flex;flex-direction:column;gap:6px}
.dsb-composer-root{display:flex;flex-direction:column;align-items:center;padding:0 11px 13px 16px}
.dsb-composer-wrap{width:100%;max-width:min(992px,100%)}
.dsb-composer{position:relative}
.dsb-composer[data-multiline]{border-radius:18px!important}
.dsb-composer-input{display:flex;flex:1 1 0;min-width:0;padding:0 8px}
.dsb-composer-input textarea{flex:1;width:100%;max-height:168px;margin:0;border:0;outline:0;resize:none;background:none;color:var(--bt-ink);font:inherit;font-size:14px;line-height:24px;overflow-y:auto}
.dsb-composer-input textarea:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px;border-radius:4px}
.dsb-composer-input textarea::placeholder{color:color-mix(in srgb,var(--bt-ink) 36%,transparent)}
.dsb-composer-trailing{order:3;display:flex;flex:none;align-self:flex-end;align-items:center;gap:8px}
.dsb-send{flex:none;width:28px;height:28px;padding:0;border:0;border-radius:50%;display:inline-grid;place-items:center;background:var(--bt-accent);color:var(--bt-accent-ink);cursor:pointer;transition:opacity .15s ease}
.dsb-send:hover{opacity:.9}
.dsb-send svg{width:14px;height:14px}
.dsb-send:disabled{visibility:hidden}
.dsb-composer-error{margin:0 0 6px 4px;font-size:12px;line-height:16px;color:var(--bt-danger)}
.dsb-superagent pre{white-space:pre-wrap;overflow-wrap:anywhere}
`
