import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as core from '../dist/index.js'

const json = body => ({ ok: true, status: 200, json: async () => body })
const message = (overrides = {}) => ({ message_id: 'om_1', chat_id: 'oc_group', msg_type: 'text',
  create_time: '1700000000000', update_time: '1700000000000', deleted: false, updated: false,
  sender: { id: 'ou_alice', id_type: 'open_id', sender_type: 'user' }, body: { content: '{"text":"Please review"}' }, ...overrides })

test('the Feishu transport maps chats, messages, mentions, edits, recalls and pagination', async () => {
  const calls = []
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ path: parsed.pathname, query: parsed.searchParams, auth: init.headers?.Authorization })
    if (parsed.pathname === '/open-apis/auth/v3/tenant_access_token/internal') return json({ code: 0, tenant_access_token: 't-1', expire: 7200 })
    if (parsed.pathname === '/open-apis/im/v1/chats/oc_group') return json({ code: 0, data: { chat_mode: 'group', name: 'Team' } })
    if (parsed.pathname === '/open-apis/im/v1/chats/oc_p2p') return json({ code: 0, data: { chat_mode: 'p2p' } })
    if (parsed.pathname === '/open-apis/im/v1/messages') {
      const chat = parsed.searchParams.get('container_id')
      if (chat === 'oc_group' && parsed.searchParams.get('page_token') === 'p2') return json({ code: 0, data: { items: [], has_more: false } })
      if (chat === 'oc_group') return json({ code: 0, data: { has_more: true, page_token: 'p2', items: [
        message({ message_id: 'om_1', mentions: [{ id: 'ou_bot', name: 'Bot' }] }),
        message({ message_id: 'om_2', msg_type: 'post', create_time: '1700000005000', update_time: '1700000005000', updated: true,
          body: { content: '{"zh_cn":{"title":"Report","content":[[{"tag":"text","text":"first line"}],[{"tag":"text","text":"second line"}]]}}' } }),
        message({ message_id: 'om_3', deleted: true, create_time: '1700000001000', update_time: '1700000001000', body: undefined }),
        message({ message_id: 'om_4', sender: undefined }),
      ] } })
      return json({ code: 0, data: { items: [message({ message_id: 'om_5', chat_id: 'oc_p2p' })], has_more: false } })
    }
    throw new Error(`Unexpected Feishu path ${parsed.pathname}`)
  }
  const transport = new core.FeishuOpenApi({ appId: 'cli_test', appSecret: 'secret', fetch, now: () => 1000 })
  const first = await transport.listEvents({ tenantKey: 'tenant', chatIds: ['oc_group', 'oc_p2p'], signal: new AbortController().signal })
  assert.equal(first.malformed, 1)
  const group = first.events.filter(event => event.chatId === 'oc_group')
  const p2p = first.events.filter(event => event.chatId === 'oc_p2p')
  assert.deepEqual(group.map(event => event.messageId), ['om_1', 'om_3', 'om_2'])
  assert.equal(group[0].text, 'Please review')
  assert.deepEqual(group[0].mentionIds, ['ou_bot'])
  assert.equal(group[0].chatType, 'group')
  assert.equal(group[2].text, 'Report\nfirst line\nsecond line')
  assert.equal(group[2].edited, true)
  assert.equal(group[1].deleted, true)
  assert.equal(group[1].text, undefined)
  assert.match(group[1].deletionEvidence, /recalled/u)
  assert.equal(p2p[0].chatType, 'p2p')
  const cursors = first.events.map(event => event.cursor)
  assert.deepEqual(cursors, cursors.slice().sort())

  const lastCursor = first.events.at(-1).cursor
  const second = await transport.listEvents({ tenantKey: 'tenant', chatIds: ['oc_group', 'oc_p2p'], cursor: lastCursor, signal: new AbortController().signal })
  assert.deepEqual(second.events.map(event => event.messageId), ['om_5'], 'a lookback replay is left to the source duplicate check')
  const groupRequest = calls.filter(call => call.path === '/open-apis/im/v1/messages' && call.query.get('container_id') === 'oc_group').at(-1)
  assert.equal(groupRequest.query.get('page_token'), 'p2')
  const p2pRequest = calls.filter(call => call.path === '/open-apis/im/v1/messages' && call.query.get('container_id') === 'oc_p2p').at(-1)
  assert.equal(p2pRequest.query.get('start_time'), String(Math.floor(Number(lastCursor.split(':')[0]) / 1000) - 600))
})

test('a tenant token rejected mid-poll is refreshed once and the request is retried', async () => {
  let tokens = 0
  let messageCalls = 0
  const fetch = async url => {
    const parsed = new URL(url)
    if (parsed.pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
      tokens++
      return json({ code: 0, tenant_access_token: `t-${tokens}`, expire: 7200 })
    }
    if (parsed.pathname === '/open-apis/im/v1/chats/oc_group') return json({ code: 0, data: { chat_mode: 'group' } })
    if (parsed.pathname === '/open-apis/im/v1/messages') {
      messageCalls++
      if (messageCalls === 1) return json({ code: 99991663, msg: 'tenant token invalid' })
      return json({ code: 0, data: { items: [], has_more: false } })
    }
    throw new Error(`Unexpected Feishu path ${parsed.pathname}`)
  }
  const transport = new core.FeishuOpenApi({ appId: 'cli_test', appSecret: 'secret', fetch, now: () => 1000 })
  const page = await transport.listEvents({ tenantKey: 'tenant', chatIds: ['oc_group'], signal: new AbortController().signal })
  assert.deepEqual(page.events, [])
  assert.equal(tokens, 2)
  assert.equal(messageCalls, 2)
})

test('the Feishu transport pages members, deduplicates native identities and bounds the budget', async () => {
  let memberCalls = 0
  const fetch = async url => {
    const parsed = new URL(url)
    if (parsed.pathname === '/open-apis/auth/v3/tenant_access_token/internal') return json({ code: 0, tenant_access_token: 't-1', expire: 7200 })
    if (parsed.pathname === '/open-apis/im/v1/chats/oc_group/members') {
      memberCalls++
      if (memberCalls === 1) return json({ code: 0, data: { has_more: true, page_token: 'm2', items: [
        { member_id: 'ou_a', name: 'Ada', member_id_type: 'open_id' },
        { member_id: 'ou_b', name: 'Bob', member_id_type: 'open_id' },
      ] } })
      return json({ code: 0, data: { has_more: false, items: [{ member_id: 'ou_a', name: 'Ada', member_id_type: 'open_id' }] } })
    }
    throw new Error(`Unexpected Feishu path ${parsed.pathname}`)
  }
  const transport = new core.FeishuOpenApi({ appId: 'cli_test', appSecret: 'secret', fetch, now: () => 1000 })
  const members = await transport.listMembers({ chatId: 'oc_group', signal: new AbortController().signal })
  assert.deepEqual(members.map(member => member.nativeActorId), ['ou_a', 'ou_b'])
  assert.equal(members[0].displayName, 'Ada')
  assert.ok(members.every(member => member.kind === 'human' && member.active))

  const bounded = new core.FeishuOpenApi({ appId: 'cli_test', appSecret: 'secret', now: () => 1000, maxMemberPages: 1,
    fetch: async url => {
      const parsed = new URL(url)
      if (parsed.pathname === '/open-apis/auth/v3/tenant_access_token/internal') return json({ code: 0, tenant_access_token: 't-1', expire: 7200 })
      return json({ code: 0, data: { has_more: true, page_token: 'more', items: [] } })
    } })
  await assert.rejects(bounded.listMembers({ chatId: 'oc_group', signal: new AbortController().signal }), { code: 'SOURCE_BUDGET' })
})

test('the Feishu setup check resolves the reachable chat types', async () => {
  const fetch = async url => {
    const parsed = new URL(url)
    if (parsed.pathname === '/open-apis/auth/v3/tenant_access_token/internal') return json({ code: 0, tenant_access_token: 't-1', expire: 7200 })
    if (parsed.pathname === '/open-apis/im/v1/chats/oc_group') return json({ code: 0, data: { chat_mode: 'group', name: 'Team' } })
    throw new Error(`Unexpected Feishu path ${parsed.pathname}`)
  }
  const transport = new core.FeishuOpenApi({ appId: 'cli_test', appSecret: 'secret', fetch, now: () => 1000 })
  assert.deepEqual(await transport.check(['oc_group'], new AbortController().signal), [{ chatId: 'oc_group', chatType: 'group', name: 'Team' }])
})

test('the Feishu reply transport posts text in place with a bounded uuid', async () => {
  const calls = []
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ path: parsed.pathname, method: init.method, body: init.body, auth: init.headers?.Authorization })
    if (parsed.pathname === '/open-apis/auth/v3/tenant_access_token/internal') return json({ code: 0, tenant_access_token: 't-1', expire: 7200 })
    if (parsed.pathname === '/open-apis/im/v1/messages/om_q/reply') return json({ code: 0, data: { message_id: 'om_reply' } })
    throw new Error(`Unexpected Feishu path ${parsed.pathname}`)
  }
  const transport = new core.FeishuOpenApi({ appId: 'cli_test', appSecret: 'secret', fetch, now: () => 1000 })
  const uuid = 'a'.repeat(32)
  assert.deepEqual(await transport.replyMessage({ messageId: 'om_q', text: 'Use blue.', uuid, signal: new AbortController().signal }),
    { messageId: 'om_reply' })
  const call = calls.at(-1)
  assert.equal(call.method, 'POST')
  assert.deepEqual(JSON.parse(call.body), { content: '{"text":"Use blue."}', msg_type: 'text', uuid })
  assert.equal(call.auth, 'Bearer t-1')
  await assert.rejects(transport.replyMessage({ messageId: 'om_q', text: '', uuid, signal: new AbortController().signal }), { code: 'INVALID_INPUT' })
  await assert.rejects(transport.replyMessage({ messageId: 'om_q', text: 'x', uuid: 'a'.repeat(51), signal: new AbortController().signal }), { code: 'INVALID_INPUT' })
})
