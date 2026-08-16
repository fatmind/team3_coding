# team3 — An AI-Agent-Driven Software Development Workflow

> A 1+1+1+1 human–AI collaboration: **Human + Architect + Dev + UAT** working together through an **app → module → feature → uat** pipeline to build products continuously.

**English** | [简体中文](README.zh-CN.md)

team3 lets "a human + multiple AI agents" collaborate on software development like a real team. The human only sets direction and makes decisions; the Architect decomposes requirements, dispatches tasks, and reviews acceptance; the Dev writes code and self-tests; the UAT independently validates the product from a black-box, user-centric perspective. All roles communicate through `spec/actions.jsonl`, and a daemon schedules every agent session.

## The Problem

Three pain points when using AI coding tools (Claude Code / Cursor / Codex, etc.) for commercial product development:

- **The human becomes the dispatcher** — coordinating context across multiple sessions and copying requirements by hand; team3 handles inter-agent context and messaging for you
- **Acceptance relies on manual testing** — without checkpoints or UAT, humans can't manually verify features faster than AI produces them; team3 bakes checkpoints and black-box UAT into the flow
- **No sustained collaboration** — one-off, single-feature coding can't improve the way human collaboration does over time; team3 supports long-term iteration across features and modules

## Core Concepts

| Role | Responsibility |
|---|---|
| **Human** | Product ideas, architecture direction, requirements, daily acceptance feedback (only the human maintains `spec/app_design.md`) |
| **Architect** | Requirement breakdown, task dispatch, acceptance review, state management, UAT trigger (writes no business code) |
| **Dev** | Coding, unit/integration tests, self-verification and fixing, delivery (a dedicated session per task to avoid context pollution) |
| **UAT** | Black-box validation from the user's perspective; doesn't read Dev code; no mocks or stubs allowed |

## Features

- **Four-role protocol** — clear role boundaries, a single source of truth for human decisions (`spec/decisions.md`), lessons learned distilled into `spec/experience.md`
- **Daemon scheduler** — action watching, session queueing/scheduling, message routing, rebase, state persistence, watchdog
- **CLI toolchain** — `init` / `write-action` / `experience` / `simulate_human` / `validate-uat-evidence` and more
- **Web console** — a Next.js dashboard to watch progress and exchange messages in real time
- **Evaluation tooling** — `loop/` provides eval / regression / badcase tools to continuously assess agent performance
- **Packaging & release** — `build/build.sh` produces a globally-installable tgz; `team3 start` launches in one command

## Directory Layout

```text
team3_coding/
├── README.md
├── LICENSE
├── draft/                # Early-stage ideas and discussion notes (process docs)
└── team3/
    ├── bin/              # team3 CLI entry
    ├── build/            # Packaging scripts
    ├── cli/              # Toolchain (init / write-action / experience ...)
    ├── daemon/           # Agent scheduler
    ├── human_coding/     # Architect / Dev / UAT role prompts
    ├── loop/             # Evaluation tooling (eval / regression / badcase)
    ├── spec/             # Design docs and protocol definitions
    └── web/              # Next.js web console
```

## Quick Start

```bash
# Build and install globally
cd team3
bash build/build.sh
npm install -g ./pkg/team3-*.tgz

# Start
team3 start -p 9001
# Open http://localhost:9001
```

Dev mode (source dogfooding):

```bash
cd team3
node build/embed-prompts.js        # re-run after any prompt change
cd web
TEAM3_SUPERMAN=1 PORT=9001 npm run dev
```

## Documentation

- `team3/spec/` — design docs and protocol definitions (`app_design.md`, `packaging_design.md`, `usage.md`, ...)
- `team3/human_coding/` — the three role prompts and workflow reference (`team3.md` is the authoritative protocol)
- `draft/` — early-stage ideas and discussion notes (process docs; see [draft/README.md](draft/README.md))

## License

[MIT](LICENSE)
