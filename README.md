# pi-token-usage

A [pi](https://github.com/badlogic/pi-mono) extension for lifetime token usage tracking and cost analytics across all sessions.

## Features

- **Lifetime totals** — tokens, cost, cache usage across all sessions
- **Time rollups** — by month, day, last 7/30 days, today
- **Per-model breakdown** — usage grouped by provider and model
- **Per-project breakdown** — usage grouped by working directory
- **Per-session breakdown** — top sessions by cost/tokens
- **Commands** — `/usage`, `/usage models`, `/usage days 30`, `/usage sessions`, `/usage months`
- **Export** — JSON and CSV export

## Install

```bash
pi install npm:pi-token-usage
```

Or from git:

```bash
pi install git:github.com/ladislas/pi-token-usage
```

## Usage

```
/usage                — lifetime summary + today + this month
/usage models         — breakdown by provider/model
/usage sessions       — top sessions by cost
/usage days [N]       — daily rollup (default: 7)
/usage months         — monthly rollup
/usage export [json|csv] — export raw data
```

## How it works

Pi stores all sessions as JSONL files under `~/.pi/agent/sessions/`. Each assistant message includes full token usage and cost data. This extension scans all session files, extracts usage from assistant messages, and aggregates the data across multiple dimensions.

No external database or persistence file needed — session files are the source of truth.

## Requirements

- [pi](https://github.com/badlogic/pi-mono) v0.55.0 or later

## License

MIT
