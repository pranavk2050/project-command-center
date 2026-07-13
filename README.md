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

## Data storage architecture

- **Projects/Tasks/Logs/Milestones** → stored in `data.json` in this repo, read/written via the GitHub Contents API (`gh.load()` / `gh.save()` in the code). Requires a GitHub **classic** Personal Access Token with `repo` scope, entered once per browser and stored in `localStorage` under `gh_token`.
- **Save queue** — to avoid race conditions when multiple changes happen quickly (e.g. the AI adding 3 tasks in one turn), saves are **debounced (500ms)** and **queued** (only one save in flight at a time; a pending flag triggers one more save after the current one finishes). All state mutations use functional `setState` updates to avoid stale-closure bugs. This was a real bug we hit and fixed — see "Known gotchas" below.
- **AI chat history** → stored in `localStorage` under `ai_chat_history` (per-browser only, not synced to GitHub)
- **AI provider + API key** → stored in `localStorage` under `ai_provider` / `ai_key` (and `ai_ollama_model` for Ollama). Per-browser, never committed to the repo.

## AI Assistant — how it works

This is a genuine **agentic tool-calling** setup, not text parsing:

- Defined tools (see `AGENT_TOOLS` in the code): `create_project`, `create_task`, `create_log`, `create_milestone`, `update_task_status`
- Each provider gets the same tools translated to its native schema:
  - **Anthropic** — `tools` param with `input_schema`, response `tool_use` blocks
  - **Groq** (OpenAI-compatible) — `tools` param with `function.parameters`, response `tool_calls`
  - **Gemini** — `function_declarations`, response `functionCall` parts
  - **Ollama** (local) — same OpenAI-compatible format as Groq, hits `http://localhost:11434/v1/chat/completions`
- Each `run*Agent()` function runs a loop of up to 6 steps: call the model → if it requests tool(s), execute them locally via `executeTool()` and feed results back → repeat until the model returns plain text. This lets it chain multiple actions per turn (e.g. "create a project and add 3 tasks to it").
- Live trace bubbles (🔧 orange) show each tool call as it happens, for transparency.

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

## For a future Claude conversation

If you're picking this up in a new chat, paste this README (or just the repo link) and say what you want to change. Claude can `view` the live `index.html` in the repo, or you can re-upload/re-paste it. The deployment flow is:

1. Edit `/home/claude/index.html` (or wherever it's staged)
2. Validate JSX syntax with `@babel/core`'s `transformSync` before deploying (catches syntax errors before they hit production)
3. Get current file SHA via GitHub API, base64-encode the file, PUT to `https://api.github.com/repos/pranavk2050/project-command-center/contents/index.html` with a GitHub **classic** PAT (`repo` scope) — use `--data-binary @payload.json` (not inline `-d`) since the base64 payload is too large for a shell argument
4. GitHub Pages auto-rebuilds within ~1 minute

## Security notes

- Two categories of secrets exist, both stored only in `localStorage` (per-browser, never in the repo): the GitHub PAT (`gh_token`) and the AI provider key (`ai_key`)
- Rotate/delete tokens from github.com/settings/tokens and console.groq.com / aistudio.google.com / console.anthropic.com if ever exposed
