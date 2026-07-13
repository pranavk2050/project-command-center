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
- **AI Assistant** — agentic chat that can answer questions about your data AND take real actions (create_project, create_task, create_log, create_milestone, update_task_status) via native tool-calling
- **Whizible timesheet export** — projects can carry an optional `jobCode` and log entries an optional `taskCode` (matching the company Whizible timesheet's dropdown values). The Daily Log tab has a collapsible "📤 Export for Whizible" panel: pick a date range, it generates a formatted Job/Task/Hours/Description block per day (with an 8.5hr daily-total check), ready to copy and hand to Claude in Chrome (a separate browsing-agent product) along with the user's own Whizible process notes to auto-fill the actual timesheet site. This dashboard only prepares the data — it can't drive the Whizible website itself, since that requires real browser automation outside this chat's tool access.

## Data storage architecture

- **Projects/Tasks/Logs/Milestones** → stored in `data.json` in this repo, read/written via the GitHub Contents API (`gh.load()` / `gh.save()` in the code). Requires a GitHub **classic** Personal Access Token with `repo` scope, entered once per browser and stored in `localStorage` under `gh_token`.
- **Save queue** — to avoid race conditions when multiple changes happen quickly (e.g. the AI adding 3 tasks in one turn), saves are **debounced (500ms)** and **queued** (only one save in flight at a time; a pending flag triggers one more save after the current one finishes). All state mutations use functional `setState` updates to avoid stale-closure bugs. This was a real bug we hit and fixed — see "Known gotchas" below.
- **AI chat history** → stored in `localStorage` under `ai_chat_history` (per-browser only, not synced to GitHub)
- **AI provider + API key** → stored in `localStorage` under `ai_provider` / `ai_key` (and `ai_ollama_model` for Ollama). Per-browser, never committed to the repo.

## AI Assistant — how it works

This is a genuine **agentic tool-calling** setup, not text parsing:

- Defined tools (see `AGENT_TOOLS` in the code): `create_project`, `create_task`, `create_log`, `create_milestone`, `update_task_status`, `delete_project`, `delete_task`, `delete_log`, `delete_milestone`, `restore_deleted_item`, `set_project_value`
- `restore_deleted_item` is the agent-native version of the manual recovery done earlier: it fetches the last 50 commits of `data.json` via the GitHub API (using the same `gh_token` from `localStorage`), walks backward through each commit's raw content until it finds a matching project/task/log/milestone, and re-adds the *original* object (same id, same fields) rather than creating a lookalike. For a project restore, it also pulls back that project's associated tasks/logs/milestones from the same historical snapshot. This makes `executeTool` async — all four `run*Agent` loops call it with `await` in a sequential `for...of` (not `.map`/`.forEach`, which don't properly await inside callbacks).

## Business value tracking

Each project can carry an optional value record: `valueCategory` (one of five presets — Cost Savings/Efficiency, Risk/Compliance, Revenue/Client Impact, Process Improvement, Capability Building), `valueStatement` (1-2 plain sentences for leadership), and `valueImpact` (optional rough estimate). These show up as a "💡 Value delivered to the organization" card on the Overview dashboard, above the project grid — a running list leadership can skim without opening individual projects.

The AI Assistant can draft these for you: ask it to "draft the business value for [project]" — the system prompt instructs it to look at that project's existing tasks/milestones/logs (already in its data context) and propose a category + statement + rough impact in its reply, without saving anything yet. Once you approve (or hand it your own wording), it calls `set_project_value` to actually save it. This two-step "propose, then save on approval" pattern is intentional — it keeps the AI from writing leadership-facing claims about your work without you signing off first.
- Delete tools match by text (project/task/milestone name, or log activity text + optional date) rather than by ID, since the user speaks in names not IDs. If a match is ambiguous (multiple hits), the tool refuses and asks the AI to get a more specific match from the user rather than guessing and deleting the wrong thing. `delete_project` cascades — it also removes that project's tasks, logs, and milestones. The system prompt explicitly instructs the model to only call delete tools on clear, explicit user request — never proactively or as a side effect.
- Each provider gets the same tools translated to its native schema:
  - **Anthropic** — `tools` param with `input_schema`, response `tool_use` blocks
  - **Groq** (OpenAI-compatible) — `tools` param with `function.parameters`, response `tool_calls`
  - **Gemini** — `function_declarations`, response `functionCall` parts
  - **Ollama** (local) — same OpenAI-compatible format as Groq, hits `http://localhost:11434/v1/chat/completions`
- Each `run*Agent()` function runs a loop of up to 6 steps: call the model → if it requests tool(s), execute them locally via `executeTool()` and feed results back → repeat until the model returns plain text. This lets it chain multiple actions per turn (e.g. "create a project and add 3 tasks to it").
- Live trace bubbles (🔧 orange) show each tool call as it happens, for transparency — **this is the reliable signal that an action actually happened**. If a reply claims success with no trace bubble above it, don't trust it (see "Known gotchas" #5 below).
- **Context sent per message is capped to control token usage**: last 8 chat messages (not the full growing thread) + last 8 activity log entries (not all of them). Full task/project/milestone data is still always included since that's usually small. This was tightened after hitting Groq's free daily quota (100k TPD) — resending the entire conversation history on every single message was the main cost driver, since cost compounds as a conversation grows.

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

**Flow in words:** every message rebuilds the full data context + tool schemas from scratch (no persistent server-side memory), sends it to whichever provider is connected, and loops — execute tool → feed result back → call model again — until the model has nothing left to do and returns plain text. This is what makes it "agentic" rather than single-shot Q&A: the model can chain multiple real actions (create a project, then several tasks under it, then a milestone) within one user turn, observing each result before deciding the next step.

### Provider options (user picks one, stored per-browser)
| Provider | Cost | Notes |
|---|---|---|
| Groq (Llama 3.3 70B) | Free | Recommended default; has a daily token cap (~100k TPD on free tier) |
| Ollama (local) | Free, unlimited | Requires Ollama running locally with `OLLAMA_ORIGINS=*`; only works on the same machine |
| Google Gemini | Free | Some Google accounts hit "limit: 0" until the free tier is manually activated via aistudio.google.com |
| Anthropic Claude | Paid | Highest quality, requires billing set up |

## Known gotchas / bugs already fixed (don't reintroduce these)

1. **React crash from `useEffect(scrollToBottom, [messages])`** — an arrow function used directly as an effect implicitly returns `scrollIntoView()`'s return value, which React tries to call as a cleanup function → `"c is not a function"` crash. Fix: wrap in a full function body with no return value.
2. **AI action race condition** — multiple rapid state changes (e.g. AI adding 3 tasks) each triggering an immediate GitHub save caused conflicting writes and data loss on reload. Fixed via functional `setState` + debounced/queued single save (see Data storage architecture above). **Do not** go back to computing `[...tasks, newItem]` from a closure variable — always use the functional updater form.
3. **AI output format inconsistency** — different models (especially Groq/Llama) don't reliably follow custom XML-tag instructions for "actions." This is why we moved to **native tool-calling APIs** instead of asking the model to output `<action>{...}</action>` text — much more reliable.
4. **Gemini quota "limit: 0"** — not a bug in our code; means the Google account's free tier isn't activated. Fix on the user's end: visit aistudio.google.com and send one message there first.
5. **AI narrating a fake success without calling the tool** — smaller/free models (seen on Groq/Llama) sometimes write convincing confirmation text ("Project X has been created, ID: ...") without actually invoking the tool. The tell: no 🔧 trace bubble appears before the claim. Fixed two ways: (a) system prompt now has an explicit rule forbidding claiming an action without a real tool call behind it, and (b) client-side safety net in `sendMessage()` — a `toolCallCount` is tracked per turn, and if the final reply matches "claims an action" language (regex for phrases like "has been created/added/updated") while `toolCallCount === 0`, the app appends a warning telling the user nothing was actually saved. Don't remove this check even if it seems redundant with the prompt rule — the prompt rule alone isn't 100% reliable on weaker models.
6. **Token quota burned fast from resending full chat history** — because AI chat history persists (see "Data storage architecture"), sending the *entire* thread on every message meant token cost grew with every turn of a conversation, not just with data size. Fixed by capping history to the last 8 messages and recent logs to the last 8 entries before building each request (see `sendMessage()` and `buildSystemPrompt()`). If usage-per-message needs to shrink further, this is the first place to trim more aggressively.

## For a future Claude conversation

If you're picking this up in a new chat, paste this README (or just the repo link) and say what you want to change. Claude can `view` the live `index.html` in the repo, or you can re-upload/re-paste it. The deployment flow is:

1. Edit `/home/claude/index.html` (or wherever it's staged)
2. Validate JSX syntax with `@babel/core`'s `transformSync` before deploying (catches syntax errors before they hit production)
3. Get current file SHA via GitHub API, base64-encode the file, PUT to `https://api.github.com/repos/pranavk2050/project-command-center/contents/index.html` with a GitHub **classic** PAT (`repo` scope) — use `--data-binary @payload.json` (not inline `-d`) since the base64 payload is too large for a shell argument
4. GitHub Pages auto-rebuilds within ~1 minute

## Security notes

- Two categories of secrets exist, both stored only in `localStorage` (per-browser, never in the repo): the GitHub PAT (`gh_token`) and the AI provider key (`ai_key`)
- Rotate/delete tokens from github.com/settings/tokens and console.groq.com / aistudio.google.com / console.anthropic.com if ever exposed
