import { collectSources, linkEvidence, readSSE, researchMarket } from './research.ts'

function assert(value: unknown, message: string) { if (!value) throw new Error(message) }

Deno.test('source IDs remain stable and only provider citations support findings', () => {
  const discovered = collectSources([{ action: { sources: [{ url: 'https://news.example/story#top' }, { url: 'javascript:alert(1)' }, { url: 'https://user:password@news.example/private' }] } }])
  assert(discovered.length === 1 && !discovered[0].cited, 'Unsafe or uncited URL mishandled')
  const sources = collectSources([{ content: [{ annotations: [{ type: 'url_citation', url: 'https://news.example/story', title: 'An actual source title' }] }] }], discovered)
  assert(sources.length === 1 && sources[0].id === 1 && sources[0].cited, 'Citation must upgrade an existing source')
  assert(sources[0].title === 'An actual source title', 'Citation title missing')
  const [valid, invalid] = linkEvidence([
    { title: 'Valid', detail: 'Supported finding', basis: 'web', source_ids: [1, 1, 999] },
    { title: 'Invented', detail: 'Unsupported finding', basis: 'web', source_ids: [999] },
  ], sources)
  assert(valid.source_ids.join() === '1', 'IDs must be deduplicated and validated')
  assert(invalid.basis === 'uncertain' && !invalid.detail.includes('Unsupported finding'), 'Unlinked web claims must be replaced')
})

Deno.test('SSE handles byte-fragmented UTF-8, CRLF and a final unterminated event', async () => {
  const bytes = new TextEncoder().encode('event: response\r\ndata: {"title":"Café"}\r\n\r\ndata: {"done":true}')
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close() } })
  const events = []
  for await (const event of readSSE(stream)) events.push(event)
  assert(events.length === 2 && events[0].title === 'Café' && events[1].done, 'Fragmented event lost or corrupted')
})

Deno.test('web research emits provider sources, counts searches and returns cited context', async () => {
  const originalFetch = globalThis.fetch
  const progress: Record<string, unknown>[] = []
  const search = { id: 'search_1', type: 'web_search_call', action: { type: 'search', sources: [{ url: 'https://news.example/report' }] } }
  const message = { type: 'message', content: [{ type: 'output_text', text: 'A dated event update.', annotations: [{ type: 'url_citation', url: 'https://news.example/report', title: 'Event update' }] }] }
  const events = [{ type: 'response.output_item.done', item: search }, { type: 'response.output_item.done', item: search }, { type: 'response.completed', response: { status: 'completed', output: [search, message] } }]
  globalThis.fetch = (_input, init) => {
    const payload = JSON.parse(String(init?.body))
    assert(payload.tools[0].type === 'web_search' && payload.tool_choice === 'required', 'Search must actually be requested')
    assert(payload.store === false && payload.stream === true, 'Expected non-stored streaming request')
    return Promise.resolve(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }))
  }
  try {
    const result = await researchMarket({ key: 'test-only', model: 'gpt-4.1-mini', title: 'Exact event', description: 'Rules', image: null, signal: new AbortController().signal, progress: e => progress.push(e) })
    assert(result.status === 'complete' && result.searches === 1, 'Duplicate events should not inflate work counts')
    assert(result.sources[0].cited && result.summary.includes('dated event'), 'Cited context missing')
    assert(progress.some(e => (e.sources as unknown[])?.length === 1), 'Source discovery was not emitted')
  } finally { globalThis.fetch = originalFetch }
})

Deno.test('research without citations cannot become evidence', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve(new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'An uncited assertion' }] }] } }) + '\n\n'))
  try {
    const result = await researchMarket({ key: 'test-only', model: 'gpt-4.1-mini', title: 'Event', description: '', image: null, signal: new AbortController().signal, progress: () => {} })
    assert(result.status === 'no_sources' && result.summary === '', 'Uncited research must not reach the decision model')
  } finally { globalThis.fetch = originalFetch }
})
