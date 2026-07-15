# Project Command Center — Pranav Kulkarni

A personal, cloud-synced project & task tracking dashboard with an AI assistant, built for showing leadership clear, real-time visibility into ongoing work across multiple projects.

**Live site:** https://pranavk2050.github.io/project-command-center/
**Repo:** https://github.com/pranavk2050/project-command-center

---

## What this is

A single self-contained `index.html` file (React + Babel loaded via CDN, no build step) deployed on GitHub Pages. It has no backend server — all data lives in a `data.json` file inside this same repo, and the browser talks to it directly using a GitHub Personal Access Token.

## Core features

- **Projects** — create/edit/delete, each with owner/stakeholder, color tag, start/end dates
- **Tasks** — per project: title, priority, status, deadline, assigned-by, source, remarks
- **Daily Log** — activity entries with category (Meeting, Task Progress, Review, etc.), duration, outcome — includes smart quick-fill templates per category
- **Milestones** — progress-tracked deliverables per project
- **Time Distribution dashboard** — donut chart by category + daily bar chart, computed from log durations
- **Interactive Mind Map** — expandable/collapsible tree view (drag to pan, scroll to zoom) for both the whole portfolio ("Journey Map") and individual projects
- **AI Assistant** — agentic chat across 4 providers (Groq/Gemini/Anthropic/Ollama) that can answer questions about your data and take real actions (create/update projects, tasks, logs, milestones, look up records via `search_data`) via native tool-calling. Destructive actions (delete a project/task/log/milestone) require an explicit **Confirm** click in the chat before anything is actually removed.
- **Daily Briefing** — a scheduled GitHub Action reads the data once a day, drafts a short status summary (overdue/due-soon/stale tasks) via Groq, and posts it as a card on the Overview tab — a morning read without opening the chat.
- **Whizible timesheet export** — projects can carry an optional `jobCode` and log entries an optional `taskCode` (matching the company Whizible timesheet's dropdown values). The Daily Log tab has a collapsible "📤 Export for Whizible" panel: pick a date range, it generates a formatted Job/Task/Hours/Description block per day (with an 8.5hr daily-total check), ready to copy and hand to Claude in Chrome (a separate browsing-agent product) along with the user's own Whizible process notes to auto-fill the actual timesheet site. This dashboard only prepares the data — it can't drive the Whizible website itself, since that requires real browser automation outside this chat's tool access.

## Data storage architecture

- **Projects/Tasks/Logs/Milestones** → stored in `data.json` in this repo, read/written via the GitHub Contents API (`gh.load()` / `gh.save()` in the code). Requires a GitHub **classic** Personal Access Token with `repo` scope, entered once per browser and stored in `localStorage` under `gh_token`.
- **Save queue** — to avoid race conditions when multiple changes happen quickly (e.g. the AI adding 3 tasks in one turn), saves are **debounced (500ms)** and **queued** (only one save in flight at a time; a pending flag triggers one more save after the current one finishes). All state mutations use functional `setState` updates to avoid stale-closure bugs. This was a real bug we hit and fixed — see "Known gotchas" below.
- **Audit-trail commit messages** — every mutation handler (both manual UI edits and AI-driven ones) pushes a short description onto a `changeLogRef` accumulator; `flushSave()` drains it right before calling `gh.save()` and uses it as the commit message (e.g. `created task 'X'; updated task 'Y' (via AI)` instead of a bare `Sync: <timestamp>`). AI-driven changes are tagged `(via AI)` so git history distinguishes them from manual edits. `gh.save(data, sha, message)` falls back to a generic `Sync` message if none is passed.
- **AI chat history** → stored in `localStorage` under `ai_chat_history` (per-browser only, not synced to GitHub)
- **AI provider + API key** → stored in `localStorage` under `ai_provider` / `ai_key` (and `ai_ollama_model` for Ollama). Per-browser, never committed to the repo.

## AI Assistant — how it works

This is a genuine **agentic tool-calling** setup, not text parsing:

- Defined tools (see `AGENT_TOOLS` in the code): `create_project`, `create_task`, `create_log`, `create_milestone`, `update_task_status`, `delete_project`, `delete_task`, `delete_log`, `delete_milestone`, `restore_deleted_item`, `search_data`, `set_project_value`
- `search_data` is a read-only lookup tool (keyword + optional itemType) so the AI can pull full details on demand instead of always needing everything pre-loaded into context. It pairs with `buildSystemPrompt()`'s size threshold (`CONTEXT_SUMMARY_THRESHOLD`, currently 30): below it, the prompt still gets the full projects/tasks/milestones dump exactly as before (today's dataset is far under this); above it, the prompt switches to a compact summary (names/ids/%done + overdue/in-progress only) and tells the model to call `search_data` for anything else. This keeps prompt size from growing unbounded as the dataset grows, without changing behavior at today's scale.
- `restore_deleted_item` is the agent-native version of the manual recovery done earlier: it fetches the last 50 commits of `data.json` via the GitHub API (using the same `gh_token` from `localStorage`), walks backward through each commit's raw content until it finds a matching project/task/log/milestone, and re-adds the *original* object (same id, same fields) rather than creating a lookalike. For a project restore, it also pulls back that project's associated tasks/logs/milestones from the same historical snapshot. This makes `executeTool` async — `runAgentLoop` calls it with `await` in a sequential `for...of` (not `.map`/`.forEach`, which don't properly await inside callbacks).

## Business value tracking

Each project can carry an optional value record: `valueCategory` (one of five presets — Cost Savings/Efficiency, Risk/Compliance, Revenue/Client Impact, Process Improvement, Capability Building), `valueStatement` (1-2 plain sentences for leadership), and `valueImpact` (optional rough estimate). These show up as a "💡 Value delivered to the organization" card on the Overview dashboard, above the project grid — a running list leadership can skim without opening individual projects.

The AI Assistant can draft these for you: ask it to "draft the business value for [project]" — the system prompt instructs it to look at that project's existing tasks/milestones/logs (already in its data context) and propose a category + statement + rough impact in its reply, without saving anything yet. Once you approve (or hand it your own wording), it calls `set_project_value` to actually save it. This two-step "propose, then save on approval" pattern is intentional — it keeps the AI from writing leadership-facing claims about your work without you signing off first.
- Delete tools match by text (project/task/milestone name, or log activity text + optional date) rather than by ID, since the user speaks in names not IDs. If a match is ambiguous (multiple hits), the tool refuses and asks the AI to get a more specific match from the user rather than guessing and deleting the wrong thing. `delete_project` cascades — it also removes that project's tasks, logs, and milestones.
- **Destructive tools require a UI confirmation, not just a prompt instruction.** On an unambiguous match, `delete_project`/`delete_task`/`delete_log`/`delete_milestone` don't mutate anything — `executeTool` returns `{ needsConfirmation: true, action: {...} }`, which stops the agent loop for that turn (no further model call happens). The chat shows the AI's own text replaced with our own confirmation prompt plus **Confirm / Cancel** buttons; the actual delete only runs when the user clicks Confirm, which calls the mutation directly (bypassing re-matching) using the already-resolved id. The system prompt still tells the model to only call delete tools on clear, explicit request, but this is the code-level backstop — even a hallucinated or over-eager delete call can't remove anything without a human click.
- Each provider gets the same tools translated to its native schema:
  - **Anthropic** — `tools` param with `input_schema`, response `tool_use` blocks
  - **Groq** (OpenAI-compatible) — `tools` param with `function.parameters`, response `tool_calls`
  - **Gemini** — `function_declarations`, response `functionCall` parts
  - **Ollama** (local) — same OpenAI-compatible format as Groq, hits `http://localhost:11434/v1/chat/completions`
- All four providers run through **one shared `runAgentLoop()`** (up to 6 steps: call the model → if it requests tool(s), execute them locally via `executeTool()` and feed results back → repeat until the model returns plain text or a delete needs confirmation). The provider-specific quirks (message shape, request format, response parsing) live entirely in a `PROVIDER_ADAPTERS` map — there used to be four near-duplicate `run*Agent()` functions; they were collapsed into this one loop + four small adapters so a new tool or provider only needs to be added once, not four times.
- Live trace bubbles (🔧 orange) show each tool call as it happens, for transparency — **this is the reliable signal that an action actually happened**. If a reply claims success with no trace bubble above it, don't trust it (see "Known gotchas" #5 below). A pending delete confirmation is deliberately *not* shown as a trace bubble — only the actual Confirm click gets one, so the "trace bubble = real action happened" rule stays literally true.
- **Context sent per message is capped to control token usage**: last 8 chat messages (not the full growing thread) + last 8 activity log entries (not all of them). Full task/project/milestone data is still included by default since that's usually small — see the `search_data` / `CONTEXT_SUMMARY_THRESHOLD` note above for how this scales once the dataset grows. This was tightened after hitting Groq's free daily quota (100k TPD) — resending the entire conversation history on every single message was the main cost driver, since cost compounds as a conversation grows.

### Architecture diagram

```
                 ┌────────────────────┐
                 │    User message    │
                 └──────────┬─────────┘
                            │
                            ▼
                 ┌────────────────────────────┐
                 │    Agent orchestrator       │
                 │  Loads data + tool schemas  │
                 └──────────┬─────────────────┘
                            │
                            ▼
                 ┌────────────────────────────────┐
                 │      LLM provider call          │
                 │ Groq · Gemini · Anthropic ·     │
                 │           Ollama                │
                 └──────────┬─────────────────────┘
                            │
                            ▼
                 ┌────────────────────────┐
                 │  Tool call requested?  │
                 └──────┬───────────┬─────┘
                    yes │           │ no
                        ▼           ▼
           ┌────────────────────┐ ┌──────────────────┐
           │   Execute tool      │ │   Final answer    │
           │ Updates dashboard   │ │  Shown in chat     │
           │      data           │ └──────────────────┘
           └──────────┬──────────┘
                      │
                      │ tool result feeds back
                      └──────────────► (loop back to "LLM provider call",
                                        up to 6 iterations per turn)
```

**Flow in words:** every message rebuilds the data context + tool schemas from scratch (no persistent server-side memory), sends it to whichever provider is connected, and loops — execute tool → feed result back → call model again — until the model has nothing left to do and returns plain text. This is what makes it "agentic" rather than single-shot Q&A: the model can chain multiple real actions (create a project, then several tasks under it, then a milestone) within one user turn, observing each result before deciding the next step. The one exception: if a step resolves to a destructive tool (a delete), the loop stops immediately and hands control to the Confirm/Cancel UI instead of continuing — see "Destructive tools require a UI confirmation" above.

### Provider options (user picks one, stored per-browser)
| Provider | Cost | Notes |
|---|---|---|
| Groq (Llama 3.3 70B) | Free | Recommended default; has a daily token cap (~100k TPD on free tier) |
| Ollama (local) | Free, unlimited | Requires Ollama running locally with `OLLAMA_ORIGINS=*`; only works on the same machine |
| Google Gemini | Free | Some Google accounts hit "limit: 0" until the free tier is manually activated via aistudio.google.com |
| Anthropic Claude | Paid | Highest quality, requires billing set up |

## Daily Briefing automation

The only part of this app with no human in the loop — a scheduled process rather than something triggered from the chat.

- **`.github/workflows/daily-briefing.yml`** — runs daily (cron `30 2 * * *` = 08:00 IST) and on manual `workflow_dispatch`. Checks out the repo, runs the script below, and commits `briefing.json` via a plain `git push` using the workflow's default `GITHUB_TOKEN` (needs `permissions: contents: write` since default token permissions are otherwise read-only).
- **`.github/scripts/generate-briefing.js`** — reads `data.json` directly from the checked-out working copy (no GitHub API call needed), computes overdue / due-within-3-days / stale-in-progress (no `updatedAt` change in 5+ days) tasks, and — only if there's actually something to report and a `GROQ_API_KEY` secret is configured — calls Groq for a short 3–5 sentence natural-language briefing, then writes `briefing.json` = `{ generatedAt, briefing, stats }`.
- **Fails soft everywhere**: no `data.json`, nothing to report, no API key, or an LLM/network error all just log a reason and exit cleanly — no thrown error, no partially-written file, no broken workflow run.
- **`briefing.json` is deliberately a separate file from `data.json`** — the CI job's plain `git push` never touches the same blob as the browser's sha-based optimistic-concurrency save, so there's no possible race between the two write paths.
- **`isOverdue()` is hand-ported into the script**, not shared with `index.html` — there's no module system linking the CI script and the browser app, so this is an intentional duplication. If the overdue rule ever changes in one place, update the other.
- **Client side**, a read-only `DailyBriefingCard()` component on the Overview tab fetches `briefing.json` from `raw.githubusercontent.com` (public repo, no `gh_token` needed for this read) and renders it once it exists; it renders nothing before the first successful run.
- **Requires a `GROQ_API_KEY` repository secret** (Settings → Secrets and variables → Actions) — this has to be added through GitHub's web UI; it can't be set up from a chat/code session.

## Known gotchas / bugs already fixed (don't reintroduce these)

1. **React crash from `useEffect(scrollToBottom, [messages])`** — an arrow function used directly as an effect implicitly returns `scrollIntoView()`'s return value, which React tries to call as a cleanup function → `"c is not a function"` crash. Fix: wrap in a full function body with no return value.
2. **AI action race condition** — multiple rapid state changes (e.g. AI adding 3 tasks) each triggering an immediate GitHub save caused conflicting writes and data loss on reload. Fixed via functional `setState` + debounced/queued single save (see Data storage architecture above). **Do not** go back to computing `[...tasks, newItem]` from a closure variable — always use the functional updater form.
3. **AI output format inconsistency** — different models (especially Groq/Llama) don't reliably follow custom XML-tag instructions for "actions." This is why we moved to **native tool-calling APIs** instead of asking the model to output `<action>{...}</action>` text — much more reliable.
4. **Gemini quota "limit: 0"** — not a bug in our code; means the Google account's free tier isn't activated. Fix on the user's end: visit aistudio.google.com and send one message there first.
5. **AI narrating a fake success without calling the tool** — smaller/free models (seen on Groq/Llama) sometimes write convincing confirmation text ("Project X has been created, ID: ...") without actually invoking the tool. The tell: no 🔧 trace bubble appears before the claim. Fixed two ways: (a) system prompt now has an explicit rule forbidding claiming an action without a real tool call behind it, and (b) client-side safety net in `sendMessage()` — a `toolCallCount` is tracked per turn, and if the final reply matches "claims an action" language (regex for phrases like "has been created/added/updated") while `toolCallCount === 0`, the app appends a warning telling the user nothing was actually saved. Don't remove this check even if it seems redundant with the prompt rule — the prompt rule alone isn't 100% reliable on weaker models.
6. **Token quota burned fast from resending full chat history** — because AI chat history persists (see "Data storage architecture"), sending the *entire* thread on every message meant token cost grew with every turn of a conversation, not just with data size. Fixed by capping history to the last 8 messages and recent logs to the last 8 entries before building each request (see `sendMessage()` and `buildSystemPrompt()`). If usage-per-message needs to shrink further, this is the first place to trim more aggressively.
7. **AI copying its own "[id:...]" tags into name arguments, breaking matching** — `buildSystemPrompt()` lists projects like `"Video Analytics [id:mrj3bl7yk558j]"` so the model can reference IDs. Models sometimes echo the whole bracketed tag back into a `projectName`/`taskTitle` argument instead of the plain name, and a strict `.includes()` match then fails to find anything (the item is real, the match just isn't found). Fixed with a shared `fuzzyMatches()` helper (and `cleanMatchText()`) used everywhere a tool matches by name/title/activity text: it strips `[...]` bracket content from both sides and checks inclusion in *either* direction, so `"Video Analytics [id:xyz]"` still matches a project actually named `"Video Analytics"`. The system prompt also now explicitly says never to copy bracket tags into name arguments, but the code-level fix is the one that actually guarantees this — don't rely on the prompt alone.
8. **Pushing changes under `.github/workflows/` gets rejected with a classic `repo`-scope PAT** — GitHub blocks any token without the `workflow` scope from creating/modifying workflow YAML files, even though the same token pushes every other file fine. The fix is on the user's end: github.com/settings/tokens → edit the token → check the `workflow` scope → save (no need to regenerate the token value, just add the scope). Don't waste time debugging this as a git/auth problem — the error message ("refusing to allow a Personal Access Token to create or update workflow ... without `workflow` scope") already says exactly what's wrong.

## For a future Claude conversation

If you're picking this up in a new chat, paste this README (or just the repo link) and say what you want to change. Claude can `view` the live `index.html` in the repo, or you can re-upload/re-paste it. The repo now has more than just `index.html`/`data.json`/`README.md` — there's also `.github/workflows/daily-briefing.yml` and `.github/scripts/generate-briefing.js` (the Tier 3 automation, see "Daily Briefing automation" above) and (once the workflow has run at least once) `briefing.json`. The deployment flow, if working from a git clone with a normal `git push` (rather than the raw Contents API):

1. Edit `index.html` (or the relevant `.github/` file) locally
2. Validate JSX syntax with `@babel/core`'s `transformSync` before deploying (catches syntax errors before they hit production) — for the CI script, just `node .github/scripts/generate-briefing.js` locally without `GROQ_API_KEY` set is a safe smoke test (it reads real `data.json`, computes overdue/upcoming/stale, and cleanly skips before ever calling an LLM or writing a file)
3. Commit and `git push origin main` with a PAT that has **both** `repo` and `workflow` scopes — `workflow` is only needed if you're touching files under `.github/workflows/`, but it's simplest to just always have it (see "Known gotchas" #8)
4. GitHub Pages auto-rebuilds `index.html` within ~1 minute; workflow/script changes take effect on the next scheduled or manually-dispatched Action run

(If working via the raw GitHub Contents API instead of a local clone: get the current file SHA, base64-encode the file, PUT to `https://api.github.com/repos/pranavk2050/project-command-center/contents/<file>` with the same PAT — use `--data-binary @payload.json`, not inline `-d`, since the base64 payload is too large for a shell argument.)

## Security notes

- Three categories of secrets exist:
  - **GitHub PAT (`gh_token`)** and **AI provider key (`ai_key`)** — both stored only in `localStorage` (per-browser, never in the repo)
  - **`GROQ_API_KEY`** — a GitHub Actions repository secret (Settings → Secrets and variables → Actions), used server-side only by `.github/scripts/generate-briefing.js` in CI. Never appears in the browser, `localStorage`, or any committed file.
- Rotate/delete tokens from github.com/settings/tokens and console.groq.com / aistudio.google.com / console.anthropic.com if ever exposed — this applies doubly to any token or key that was ever pasted into a chat session (including with Claude), since chat transcripts should be treated as a place secrets can leak from, not just browser storage or the repo itself.
