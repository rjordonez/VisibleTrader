# Polymarket US account connection

## Recommendation

Build a guided, one-time credential connection for existing Polymarket US accounts when the backend is ready. Use two plainly labeled fields, a direct link to the official developer portal, immediate connection verification, and visible controls to disconnect or replace credentials. Treat a provider-supported authorization handoff as the preferred future upgrade, not a capability currently established by public documentation.

For the current implementation, show **Polymarket US · Coming soon** and an explanatory preview. Do not accept, persist, validate, or transmit real US credentials. Do not show simulated connection success. International wallet connection and US account connection are separate integrations.

The strongest way to make this feel safe is to give users accurate information and effective controls. A lock icon cannot compensate for an unexplained credential request or an unsupported claim that a key is read-only.

## Verified capabilities and unresolved questions

The official retail flow requires an approved account, then sign-in at `https://polymarket.us/developer` using the same Apple, Google, or email method as the app. Creating a key produces a Key ID and Secret Key; the secret is displayed once. Keys can be revoked in that portal. Public market data needs no credentials, but private portfolio and trading access does. The authentication guide documents request signing, not consumer OAuth, retail permission scopes, or automatic retail key creation.[^1]

The official Python SDK identifies the Key ID as a UUID and the secret as a Base64-encoded Ed25519 private key. This is a real signing credential, even though the product labels it an API secret. Format checks can help detect mistakes; successful authenticated requests establish validity.[^2]

The institutional API does have an OAuth token endpoint and scopes including `read:positions`, `read:orders`, and `write:orders`. Its documented flow exchanges a firm-generated RSA assertion for a token after onboarding. That is application authentication, not evidence of an existing customer login-and-consent flow. Institutional scopes must not be represented as selectable permissions for retail keys.[^3]

The ISV program explicitly addresses retail trading interfaces and requires agreements. Its published integration path includes KYC and funding. Participant documentation describes provisioning an account after KYC and listing the participants a firm can act for. It does not establish a self-service way to attach an existing consumer account, its balance, and its history.[^4][^5]

| Question | Evidence status | Product consequence |
| --- | --- | --- |
| Can users connect existing US accounts with keys? | Official SDK plus multiple connector catalogs support this pattern. | Feasible baseline for a future implementation. |
| Is consumer OAuth available? | No documented retail authorization flow found in the reviewed materials. | Do not advertise one-click login. |
| Can a retail key be restricted to read-only? | Not established by reviewed retail docs. | Distinguish our usage setting from exchange-enforced permissions. |
| Are retail key IP allowlists, expirations, or scope introspection available? | Not established. | Ask the provider; omit unsupported setup steps. |
| Does disconnecting our app revoke the provider key? | Provider-side programmatic revocation not established. | Explain local deletion and provider revocation separately. |
| Is commercial storage of customer retail credentials approved? | Products advertise it; their agreements are not public evidence. | Resolve with Polymarket before activating US credential collection. |

## What other products actually document

These are public documentation observations, not authenticated product tests or independent security audits. Several connector catalogs appear to describe the same underlying Composio integration, so they should not be counted as independent demonstrations of three different authorization technologies.

| Product | Published flow | What to borrow | Evidence limits |
| --- | --- | --- | --- |
| Composio, Polymarket US toolkit | API-key authentication; portfolio, balance, activity, order preview, placement, and cancellation tools. | Keep private account operations behind an explicit connection boundary. | Catalog confirms the method and tools, not consumer onboarding quality or vendor agreements.[^6] |
| FlyMyAI, Polymarket US | On first use, obtain credentials from the provider and paste them. Its table explicitly names Secret Key and Key ID. | Offer connection when the user first needs their portfolio, with the two exact field labels. | Another Composio-based catalog; no evidence of an OAuth shortcut.[^7] |
| Switchy, Polymarket US | Integrations panel → Connect → paste key → authorize → verify using account balances. | Immediate balance validation and a persistent active status. | Instructions describe a generic Settings/API Keys path and trading-permission selection, which the official retail guide does not establish. Do not copy these instructions literally.[^8] |
| CoinStats, Gemini connection | Illustrated provider setup, select Auditor permission, enter key and secret; mobile also supports QR. | Provider-specific screenshots, readable labels, explain one-time secret display. | Gemini's Auditor permission and QR cannot be assumed to exist on Polymarket US.[^9] |
| CoinStats, MEXC connection | Select read permissions and IP restrictions; paste key and secret on web or scan QR on mobile. | State precise permissions and give an immediate portfolio result. | This demonstrates a pattern on another exchange, not supported US features.[^10] |
| 3Commas, Binance Fast Connect | Choose Fast Connect, log into Binance, confirm; named API keys are created and IP whitelisting is applied automatically. Manual keys remain an alternative. | The correct model for a future seamless connection: a provider-hosted authorization step that creates restricted credentials. | Requires exchange cooperation; it is not UI wrapping around a manual key form.[^11] |

Source reliability matters here. Composio and FlyMyAI currently print a `/developers` URL; the official guide uses `/developer`. Use the official singular URL. A search result also suggested an Optiqal US API-key flow, but opening its current page showed an international Polygon-wallet flow. It should not be cited as a verified US example.[^12]

## Proposed future user experience

### 1. Start with the purpose

The venue picker should offer **Polymarket International** and **Polymarket US**, with the relevant connection method beneath each. For US, the opening screen should explain the benefit before showing credential fields:

> Connect Polymarket US
>
> Bring your positions and trading activity into your portfolio.
>
> You'll create an API key on Polymarket US, then paste it here.

Provide **Open Polymarket US** and **I already have a key**. Open the official portal in another tab and retain the current step when the user returns. Do not ask for a Polymarket login password, MFA code, or session cookie. A separate provider window should remain clearly recognizable as the provider's site.

### 2. Guide the two-field handoff

Keep instructions adjacent to the form rather than sending people to a long help article. Use the labels **Key ID** and **Secret Key**, with paste support, a masked secret, and an accessible reveal control. Recommend a dedicated connection key and a recognizable label such as Venter only if the current portal supports labels.

Do not silently inspect the clipboard. A user-triggered paste action is reasonable, with ordinary keyboard paste as the fallback. A short inline illustration can show which value belongs in which field, but screenshots must contain dummy values and be refreshed when the provider changes its UI.

Retain the nonsensitive step and venue across navigation. Do not retain secrets in localStorage, URL parameters, analytics, or session replay. Do not display an active form in the current UI-only release.

### 3. Confirm connection using a read operation

Use a private portfolio or balance request when the backend is implemented. Display **Checking connection…**, then an actual account summary and **Syncing activity…**. Empty accounts should succeed and show a useful empty state. Connection success does not establish historical import completion or permission to execute orders.

Use errors that suggest a next action without exposing raw credentials or upstream response bodies:

| State | Suggested message |
| --- | --- |
| Missing value | Enter both the Key ID and Secret Key. |
| Malformed value | This doesn't look like the expected key format. Check that you copied the complete value. |
| Authentication rejected | We couldn't verify these credentials. Check that both values came from the same API key. |
| Provider temporarily unavailable | Polymarket US is temporarily unavailable. Your connection hasn't been verified yet. |
| Import in progress | Connected. We're importing your activity. |
| Previously valid key rejected | Reconnect Polymarket US to resume syncing. |

Avoid promising a numerical setup time until usability testing establishes it. Do not require a funded balance, trial order, deposit, or cancellation to validate account access.

### 4. Make access understandable

For future tracking mode, use **Trading disabled in Venter** rather than **Read-only API key** unless the exchange verifies the latter. The app can enforce an allowlist of read endpoints, but a broadly privileged stolen credential could still be used elsewhere.

If trading is later supported, ask users to enable it explicitly after connection and show an order review before each user-directed order. Describe this as application behavior, not a cryptographic limitation on the credential. Do not say the API key “cannot withdraw funds” until the provider has confirmed the precise retail capability and scope; the absence of a listed withdrawal endpoint is not sufficient proof.

### 5. Keep disconnection easy

The connected-account row should show the venue, a nonsensitive connection label, last successful sync, and actions to **Replace key**, **Disconnect**, and **Manage keys on Polymarket US**.

Disconnect should immediately disable new work and remove the app's usable credential. Tell users whether historical imported records remain and offer the applicable deletion choice. Explain that removing the app connection does not itself invalidate a credential at the exchange. Replacing credentials should preserve portfolio history and deduplication identifiers.

## Security claims and implementation requirements

Publish only controls that exist and have been verified. Avoid “bank-level security,” “100% safe,” unearned compliance badges, or “we never access your key” when the server must decrypt it for signing.

OWASP recommends least-privilege secret access, centralized lifecycle management, encrypted transport, auditable use, and rotation/revocation procedures. Its logging guidance excludes authentication secrets and encryption keys from ordinary logs.[^13][^14]

Recommended architecture for this product:

- Use a dedicated server-side credential service with encryption keys managed separately from the application database. Bind encrypted records to the user and venue; authorize every operation against the authenticated user.
- Make the signer accept a narrow set of operations. Do not expose a generic client-controlled URL/path signing proxy.
- Exclude credential bodies from error monitoring, replay tools, request logs, analytics, support exports, and agent/chat context. Test those exclusions with synthetic secrets.
- Keep the secret out of browser persistence and API read responses. Return connection metadata only after verification.
- Record connection creation, replacement, failed authentication, consent changes, and deletion without logging credential material. Restrict operator access and audit exceptional access.
- Treat account recovery, deletion, backups, and reconnection as part of the credential lifecycle. Local disconnect should cancel queued work and prevent restored backups from silently reactivating deleted connections.

Plain-language copy such as “Your key is encrypted when stored” should ship only after the architecture supports it. A details link can explain what is stored, who can use it, and how to stop access without crowding the primary flow.

## Making it more seamless over time

| Option | User effort | Assessment |
| --- | --- | --- |
| Guided two-field paste | One provider visit and two copied values. | Best documented baseline. |
| Provider-generated QR or structured credential export | Potentially one scan/import. | Useful precedent exists; no verified US export format found. Do not assume support or embed secrets into shareable links. |
| Composio-hosted key collection | Still a manual provider-key step. | Can outsource connection infrastructure but introduces another processor; does not remove the fundamental handoff. |
| Browser extension that automates provider setup | Installation plus elevated browser trust. | Poor default for a simple web product; extra risk and maintenance outweigh the saved paste steps. |
| Provider-hosted authorization / automatic named key provisioning | Login and approval. | Best target, subject to Polymarket support and agreements. |
| Full ISV participant onboarding | Identity and account setup. | May enable an embedded trading product; existing-account continuity remains unresolved. |

The focused provider inquiry is: can Venter register as an application so an existing verified customer authorizes access to their current account, with read-only and trading permissions separated, without redoing KYC or moving funds? Request details on callbacks, account identity, scopes, key creation, revocation, IP restrictions, expiration, sandbox testing, commercial terms, and incident responsibilities. No provider contact has been made.

## Implementation sequence and success criteria

1. **Current scope:** ship US venue UI and an honest coming-soon explanation. No real credentials or US requests.
2. **Before enabling US:** resolve the existing-account integration agreement and exact retail key capabilities; inspect the live portal with an authorized account; implement credential handling and connection lifecycle controls.
3. **Initial US release:** guided key setup, authenticated read validation, activity/position sync, replace/disconnect controls, and actionable failure states. Keep trading off until its separate workflow is ready.
4. **Later:** test a provider-supported authorization handoff while retaining manual setup for recovery and unsupported accounts.

Measure completion from venue selection to first private portfolio response, abandonment at the provider handoff, credential validation failure categories, time to first imported trade, reconnection success, and disconnect completion. Events should record steps and error classes, never pasted values or financial balances. Test desktop tab switching, mobile app/browser switching, empty accounts, slow upstream responses, invalid/revoked credentials, and account replacement. These observations will show whether setup is becoming easier without disguising what access is granted.

## Sources

Public materials reviewed September 10, 2026. Undated pages are identified by publisher and title; relative crawler dates are not treated as publication dates. No authenticated connection or live trade was performed.

[^1]: Polymarket US, [Authentication](https://docs.polymarket.us/api-reference/authentication), undated.
[^2]: Polymarket, [Official Polymarket US Python SDK](https://github.com/Polymarket/polymarket-us-python), repository documentation, undated.
[^3]: Polymarket US, [Registration: institutional authentication and scopes](https://docs.polymarket.us/trader-guide/authentication), undated.
[^4]: Polymarket US, [Independent Software Vendors](https://docs.polymarket.us/partners/partner-types/isvs), undated.
[^5]: Polymarket US, [Participants](https://docs.polymarket.us/partners/onboarding/users), undated.
[^6]: Composio, [Polymarket US toolkit](https://docs.composio.dev/toolkits/polymarket_us), undated.
[^7]: FlyMyAI, [Polymarket US](https://docs.flymy.ai/mcp/apps/polymarket_us/), undated.
[^8]: Switchy, [Polymarket US MCP: tools and setup](https://switchy.build/directory/mcps/polymarket), undated.
[^9]: CoinStats, [How to connect your Gemini account](https://help.coinstats.app/en/articles/3548698-how-to-connect-your-gemini-account-to-coinstats), undated.
[^10]: CoinStats, [How to connect your MEXC account](https://help.coinstats.app/en/articles/13790955-how-to-connect-your-mexc-account-to-coinstats), May 13, 2026.
[^11]: 3Commas, [Binance: connect or update via Fast Connect](https://help.3commas.io/en/articles/3109051-binance-connect-or-update-via-fast-connect), July 31, 2026.
[^12]: Optiqal, [Auto-Trade](https://www.optiqal.io/documentation/bots/auto-trade), undated; current page describes international wallet execution.
[^13]: OWASP, [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), undated.
[^14]: OWASP, [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html), undated.
