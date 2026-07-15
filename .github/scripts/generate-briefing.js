// Runs in CI only (see ../workflows/daily-briefing.yml) — never shipped to the browser.
// Reads data.json, calls Groq for a short natural-language briefing, writes briefing.json.
// Deliberately a separate file from data.json so this never races with the app's own
// sha-based optimistic-concurrency save flow for data.json.
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const todayStr = () => new Date().toISOString().split("T")[0];
const daysBetween = (a, b) => Math.ceil((new Date(a) - new Date(b)) / 86400000);

// Hand-ported from index.html's isOverdue() — there's no shared module between the
// browser app and this CI script, so this is intentionally duplicated. Keep both in
// sync manually if the overdue rule ever changes.
const isOverdue = (task, today) => task.status !== "Completed" && !!task.deadline && task.deadline < today;

async function callGroq(prompt, apiKey) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400
    })
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error("Groq API error: " + r.status + " " + errText.slice(0, 200));
  }
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from Groq");
  return text.trim();
}

async function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data.json"), "utf8"));
  } catch (e) {
    console.log("Could not read/parse data.json, skipping briefing:", e.message);
    return;
  }

  const projects = data.projects || [];
  const tasks = data.tasks || [];
  const today = todayStr();

  const overdue = tasks.filter(t => isOverdue(t, today));
  const upcoming = tasks.filter(t => t.status !== "Completed" && t.deadline && !isOverdue(t, today) && daysBetween(t.deadline, today) <= 3);
  const stale = tasks.filter(t => t.status === "In Progress" && t.updatedAt && daysBetween(today, t.updatedAt) >= 5);

  if (!overdue.length && !upcoming.length && !stale.length) {
    console.log("Nothing overdue, upcoming, or stale — skipping briefing to avoid noise.");
    return;
  }

  const projName = id => (projects.find(p => p.id === id) || {}).name || "?";
  const summarize = list => list.map(t => '"' + t.title + '" (' + projName(t.projectId) + ")").join(", ") || "None";

  const prompt = "You are a terse project-status assistant. Given this data, write a 3-5 sentence daily briefing for a busy project manager. Be direct and specific, no fluff, no greeting or sign-off.\n\n" +
    "OVERDUE TASKS (" + overdue.length + "): " + summarize(overdue) + "\n" +
    "DUE WITHIN 3 DAYS (" + upcoming.length + "): " + summarize(upcoming) + "\n" +
    "STALE IN-PROGRESS TASKS, NOT UPDATED IN 5+ DAYS (" + stale.length + "): " + summarize(stale) + "\n\n" +
    "Write the briefing now.";

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.log("GROQ_API_KEY not set — skipping briefing generation.");
    return;
  }

  let text;
  try {
    text = await callGroq(prompt, apiKey);
  } catch (e) {
    console.log("LLM call failed, skipping briefing:", e.message);
    return;
  }

  const outPath = path.join(REPO_ROOT, "briefing.json");
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    briefing: text,
    stats: { overdueCount: overdue.length, upcomingCount: upcoming.length, staleCount: stale.length }
  }, null, 2) + "\n");
  console.log("briefing.json written.");
}

main().catch(e => { console.error("Unexpected error, skipping:", e); });
