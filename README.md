# pi-token-usage

A [pi](https://github.com/badlogic/pi-mono) extension for lifetime token usage tracking and cost analytics across all sessions.

Pi already shows token usage per session. `pi-token-usage` adds a cross-session view so you can answer questions like:
- how much have I spent in total?
- which models cost me the most?
- what did I use today, this week, or this month?
- which projects and sessions are driving usage?

## Features

- **Lifetime totals** — tokens, cost, and cache usage across all sessions
- **Time rollups** — today, last 7 days, last 30 days, and by month
- **Per-model breakdown** — usage grouped by provider/model
- **Per-project breakdown** — usage grouped by working directory
- **Per-session breakdown** — top sessions by cost
- **Fast refresh** — clear cached scan results and rescan session files
- **Simple commands** — query usage directly from pi with `/usage ...`

## Install

From npm:

```bash
pi install npm:pi-token-usage
```

Or from git:

```bash
pi install git:github.com/ladislas/pi-token-usage
```

## Commands

```text
/usage                 — summary: lifetime, this month, last 30d, last 7d, today
/usage models          — breakdown by provider/model
/usage days [N]        — daily rollup for last N days (default: 7)
/usage months          — monthly rollup
/usage sessions [N]    — top N sessions by cost (default: 20)
/usage projects        — breakdown by project
/usage refresh         — clear cache and rescan session files
/usage help            — show command help
```

Aliases:

```text
/usage ?
/usage --help
```

## Example output

```text
── Token Usage ──
Period         Input     Output   Cache R   Cache W   Cost
Lifetime       1.2M      94.3k    3.4M      210.0k    $12.48
This month     240.0k    18.2k    640.0k    42.0k     $2.11
Last 30 days   310.5k    24.8k    811.0k    58.0k     $2.87
Last 7 days    84.1k     7.1k     210.4k    12.0k     $0.76
Today          9.2k      802      21.3k     0         $0.08
```

You can then drill down with `/usage models`, `/usage sessions`, `/usage projects`, or `/usage days 30`.

## How it works

Pi stores session history as JSONL files under `~/.pi/agent/sessions/`. Assistant messages include token usage and cost metadata. This extension scans those session files, extracts usage records, and aggregates them across multiple dimensions.

No external database or persistence file is required — your local pi session files are the source of truth.

## Notes

- Data stays local; no external service is used
- Results depend on usage metadata being present in pi session files
- The first scan may take longer if you have a large session history
- `/usage refresh` clears the in-memory cache and rescans all session files

## Requirements

- [pi](https://github.com/badlogic/pi-mono) v0.55.0 or later

## Development

```bash
npm install
npm test
```

## License

MIT
