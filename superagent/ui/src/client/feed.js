export function mergePage(current, page) {
  const items = new Map(current.items.map(item => [item.id, item]))
  for (const item of page.items) items.set(item.id, item)
  return { ...page, items: [...items.values()].sort((left, right) => (left.time ?? 0) - (right.time ?? 0) || left.id.localeCompare(right.id)) }
}

export function createFeed(call, changed) {
  let snapshot = { items: [], tickets: [] }
  let pending
  return {
    snapshot: () => snapshot,
    refresh(signal) {
      if (pending) return pending
      pending = (async () => {
        let page
        do {
          page = await call('state', snapshot.cursor ? { cursor: snapshot.cursor } : {}, signal)
          snapshot = mergePage(snapshot, page)
          changed(snapshot)
        } while (page.hasMore)
      })().finally(() => { pending = undefined })
      return pending
    },
  }
}
