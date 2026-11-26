# Per My Last Uncle

A drafting tool for replying to cold sales emails on behalf of a growing family business.

Paste a cold email, and the app drafts a sincere, professional reply that engages with the actual pitch while introducing a complication involving your uncles. When the salesperson follows up, paste their reply into the same thread and the story continues. Every thread keeps an **Uncle Registry** (uncles, their roles and authority, disagreements, outstanding requests, established facts), and the registry is treated as canon: an uncle who distrusts subscriptions still distrusts them three emails later.

Replies are drafts. Nothing in this app sends email; you copy the draft into your own mail client.

## What's in it

- **Three-pane workspace.** Saved threads on the left (a labeled sample conversation is preloaded), the email thread in the center with an editable reply draft beneath it, and the Uncle Registry on the right.
- **Absurdity control** with five levels: Minor family involvement, Informal family oversight, Overlapping jurisdictions, Formal family proceedings, Constitutional uncle crisis.
- **Complicate matters** regenerates the draft with a further complication. **Copy** puts it on your clipboard. **Mark as sent** adds it to the thread and makes its registry changes canon. **Add their reply** pastes the salesperson's follow-up into the thread (a pending draft is assumed sent) and drafts the next reply.
- **Persistence.** Threads and registries are saved in your browser's localStorage and survive a refresh.
- **Generation** runs server-side through the Anthropic API (`app/api/reply/route.ts`). The model gets the full thread, the registry as canon, the absurdity level and the turn number, and returns JSON (the reply plus a registry update) that is validated with zod and retried once if unusable.

## Setup

Requires Node 22 or newer (see `.nvmrc`).

```bash
npm install
cp .env.example .env.local
# edit .env.local and set ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. Without `ANTHROPIC_API_KEY` the app still opens and shows the sample thread, with a notice explaining where to put the key; it does not fall back to canned replies.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key, used only on the server. |
| `ANTHROPIC_MODEL` | No | Model id. Defaults to `claude-sonnet-5-5`. |

## Scripts

```bash
npm run dev     # development server
npm test        # unit and API tests (vitest, the model is mocked)
npm run lint    # eslint
npm run build   # production build
npm start       # serve the production build
```

## Layout

- `app/` UI (`app/components/`) and API routes (`app/api/reply`, `app/api/status`)
- `lib/registry.ts` append-only registry merge and the status line
- `lib/escalation.ts` the five absurdity levels
- `lib/prompt.ts` system prompt (the voice and canon rules) and prompt builder
- `lib/generate.ts` model call, JSON extraction, validation and retry
- `lib/storage.ts` versioned localStorage persistence
- `lib/sample.ts` the sample conversation
- `tests/` vitest suites
