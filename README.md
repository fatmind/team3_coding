# team3 — where humans and agents build together

Most AI coding tools treat the agent like a vending machine. Type a prompt, get code out, done.

We see it differently.

An agent isn't a tool you rent per task. It's a teammate with a memory, a role, and a seat at the table — one that comes back day after day, picks up where it left off, and gets sharper as the project grows.

**team3** is a workflow that turns "you + your coding agents" into a real team: **1 Human + 1 Architect + 1 Dev + 1 UAT**, four roles with one job — build your product, from **app → module → feature → uat**, and keep building it.

**English** | [简体中文](README.zh-CN.md)

> **Why "team3"?** Three agents — Architect, Dev, UAT — and a Chinese saying: *三生万物*, "from three, all things are born." Three agents, one shared memory, and a team that keeps growing into more than the sum of its parts.

---

## Why we built it

If you've shipped with AI agents, you've probably felt this:

- **You're the dispatcher.** Three sessions open, context copied by hand from one window to the next, requirements re-pasted every morning. The agents work hard — you work harder keeping them in sync.
- **You're the tester.** No checkpoints, no UAT. Just you, clicking through features by hand, trying to verify faster than the AI can produce. You can't.
- **And it never compounds.** Every task starts from zero. Nobody remembers last week's decisions. It's like working with brilliant strangers who forget you overnight.

team3 fixes exactly this — not by wrapping a better code model, but by giving the team a shared memory and a workflow that outlives any single session.

## How it works

A product gets built the way a real team builds it:

1. **The human decides.** The idea, the direction, the judgment calls — they come from you. Nobody overrides you. `spec/app_design.md` is yours alone to maintain.
2. **The Architect plans.** It breaks your idea into modules and features, dispatches the work, reviews what comes back, and decides when it's ready for acceptance.
3. **The Dev builds.** Each task gets its own fresh session — clean context, unit tests, self-verification, delivery. No cross-session contamination.
4. **The UAT judges.** From the user's point of view, black-box. It doesn't read the Dev's code, doesn't use mocks, and shows no mercy. If it doesn't feel right to a user, back it goes.

They talk through `spec/actions.jsonl` — a shared inbox you're always part of. A daemon keeps every session alive, scheduled, and aware of where the project stands.

The result: the agents aren't tools anymore. They're teammates who remember — and the longer you work together, the better the team gets.

## What you get

- **One team, four roles** — clear boundaries, decisions kept in a single authoritative file (`spec/decisions.md`), and every hard-won lesson distilled into `spec/experience.md` so nobody repeats a mistake.
- **A daemon that babysits** — watches actions, queues and schedules sessions, routes messages, rebases, persists state, and watches for the dead (literally — it has a watchdog).
- **A CLI for everything** — `init`, `write-action`, `experience`, `simulate_human`, `validate-uat-evidence`…
- **A web console** — watch progress and talk to the team in real time.
- **An eval loop** — `loop/` runs evals, regressions, and badcase drills, so you can watch the team get measurably better.
- **Ships like a real product** — `build/build.sh` produces a globally-installable package; `team3 start` and you're live.

## Quick start

```bash
# Build and install globally
cd team3
bash build/build.sh
npm install -g ./pkg/team3-*.tgz

# Start
team3 start -p 9001
# Open http://localhost:9001
```

Dev mode (dogfooding from source):

```bash
cd team3
node build/embed-prompts.js        # re-run after any prompt change
cd web
TEAM3_SUPERMAN=1 PORT=9001 npm run dev
```

## Documentation

- `team3/spec/` — design docs and protocol definitions (`app_design.md`, `packaging_design.md`, `usage.md`, …)
- `team3/human_coding/` — the three role prompts and the workflow reference (`team3.md` is the authoritative protocol)
- `draft/` — early-stage ideas and discussion notes (see [draft/README.md](draft/README.md))

## License

[MIT](LICENSE)
