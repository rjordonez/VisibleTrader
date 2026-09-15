# AI Analyzer

The authenticated `/analyzer` page (`/app/analyzer` locally) is a chat-style workspace. Each submitted link or screenshot appears as a user message. While the server works, a scanning market preview and animated connections show market retrieval, position lookup, and analysis. Status labels, retrieved prices, and position counts come from server progress events, not timers. The answer replaces processing immediately with a pick, short evidence, and expandable trader detail. Users can analyze another market in the same session or stop a request. The three-second example uses explicitly fictional data and no analysis requests; real responses have no artificial delay. Motion respects reduced-motion settings.

Requests with `Accept: application/x-ndjson` receive newline-delimited `progress`, `result`, or `error` events. Authentication and entitlement failures are also sent as error events; JSON callers retain the original status codes and payloads. The frontend handles fragmented chunks, cancellation, interrupted streams, and a 90-second timeout.

## Live service setup

Deploy `supabase/functions/analyze-market` to the intended environment after setting its server-side `OPENAI_API_KEY` secret. `OPENAI_ANALYZER_MODEL` optionally overrides `gpt-4.1-mini`. Never put the key in a Vite variable. No database migration is required. The function authenticates the caller and requires an active/trialing subscription; position reads use the caller's RLS permissions.

The service accepts a Polymarket market link and/or a PNG/JPEG/WebP data URL (4 MB image maximum), retrieves market metadata and up to 60 recent tracked position rows, then makes one OpenAI Responses request with structured output. Multi-market event links require a specific market. Screenshots are sent to OpenAI, not persisted by this feature; response storage is disabled. Only server-retrieved URLs and prices are returned as market sources. Every completed analysis selects one outcome to buy; limited or unverified evidence is disclosed in the reasoning rather than converted into a PASS result.

This version does not retrieve news, injuries, sportsbook odds, or an independent probability estimate. Screenshot-only input can select a displayed outcome but cannot verify its live price. Missing evidence must not be fabricated. Quoted prices are snapshots, not executable prices. The trader trail shows the most recent sampled entry for each of up to three wallets, not aggregate cost basis or a claim about first arrival across the whole market.

Before public launch, add a durable per-user usage quota suited to the pricing plan; current protection is subscription authorization and a bounded request size/output. Live API behavior needs an integration check in an environment with configured secrets. No deployment is performed by adding these files.
