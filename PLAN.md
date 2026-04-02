# Plan

## Overview

Build a pi extension that provides lifetime token usage analytics by scanning all pi session JSONL files.

**Inspiration:** [ccusage](https://github.com/ryoppippi/ccusage) — a CLI tool that does similar analysis. Key differences from ccusage:

- **Pi extension**, not a standalone CLI — runs inside pi with `/usage` commands
- **Per-model rows by default** — ccusage merges models per day in TUI, only separates with `--breakdown`; we always show per-model detail
- **Richer time views** — last 7 days, last 30 days, today, this month, lifetime in one summary
- **Provider awareness** — group by provider, not just model name

## Architecture

### Data source

Pi session files are stored as JSONL at:

```
~/.pi/agent/sessions/--<cwd-with-dashes>--/<timestamp>_<uuid>.jsonl
```

Can also be overridden via `PI_CODING_AGENT_DIR` env var.

Each assistant message entry contains:

```typescript
{
  type: "message",
  timestamp: "2026-04-02T10:30:00.000Z",  // ISO string
  message: {
    role: "assistant",
    provider: "anthropic",           // ← provider
    model: "claude-sonnet-4-5",      // ← model id
    usage: {
      input: number,
      output: number,
      cacheRead: number,
      cacheWrite: number,
      totalTokens: number,
      cost: {
        input: number,
        output: number,
        cacheRead: number,
        cacheWrite: number,
        total: number               // ← pre-computed cost in USD
      }
    },
    timestamp: number               // Unix ms
  }
}
```

**Key insight from ccusage:** Pi already computes `cost.total` per message. We don't need a pricing table — just sum the costs.

### Scanning strategy

**Direct JSONL parsing** (like ccusage), not `SessionManager`:

1. Glob `~/.pi/agent/sessions/**/*.jsonl`
2. Stream each file line-by-line
3. Parse JSON, filter for `type === "message"` + `role === "assistant"` + `usage` present
4. Extract fields into `UsageRecord`
5. Deduplicate by `timestamp + totalTokens` hash (ccusage's approach, handles branched sessions)

**Why not `SessionManager.listAll()` + `SessionManager.open()`?**

- `SessionManager` is designed for interactive session management, not bulk scanning
- Direct JSONL streaming is simpler, faster, and has no API coupling concerns
- ccusage proves this approach works well at scale

### Data model

```typescript
interface UsageRecord {
  timestamp: number        // Unix ms (from message.timestamp)
  isoTimestamp: string     // ISO string (from entry.timestamp)
  provider: string
  model: string
  project: string          // extracted from session path (the --cwd-- dir name)
  sessionId: string        // UUID from filename
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  costTotal: number        // from usage.cost.total
}
```

### Aggregation dimensions

| Dimension | Group key | Sort |
|-----------|-----------|------|
| Lifetime | (all) | — |
| Today | date === today | — |
| Last 7 days | date >= today-7 | — |
| Last 30 days | date >= today-30 | — |
| This month | month === current | — |
| By day | `YYYY-MM-DD` | date desc |
| By month | `YYYY-MM` | month desc |
| By model | `provider/model` | cost desc |
| By project | project path | cost desc |
| By session | sessionId | cost desc |

Each group shows: input, output, cacheRead, cacheWrite, totalTokens, costTotal.
Sub-groups always show per-model breakdown.

### Extension structure

```
pi-token-usage/
├── README.md
├── PLAN.md
├── TODO.md              # local only, gitignored
├── LICENSE
├── package.json
└── src/
    └── index.ts         # single-file extension
```

### Commands

| Command | Description |
|---------|-------------|
| `/usage` | Summary: lifetime, this month, last 30d, last 7d, today — with per-model breakdown |
| `/usage models` | Full breakdown by provider/model, sorted by cost desc |
| `/usage sessions [N]` | Top N sessions by cost (default: 20) |
| `/usage days [N]` | Daily rollup for last N days (default: 7), per-model breakdown |
| `/usage months` | Monthly rollup, per-model breakdown |
| `/usage projects` | Breakdown by project (cwd), sorted by cost desc |
| `/usage export [json\|csv]` | Export all records |
| `/usage refresh` | Force rescan (clear cache) |

### Output formatting

Use `ctx.ui.notify()` with ANSI escape codes for colors. Compact table-like output.

Example `/usage` output sketch:

```
── Token Usage ──────────────────────────────────────────────
                    Input    Output   Cache R   Cache W     Cost
  Lifetime      1,234.5K    156.2K   8,901.3K   234.5K  $47.82
  This month      456.7K     67.8K   3,456.7K   123.4K  $18.34
  Last 30 days    456.7K     67.8K   3,456.7K   123.4K  $18.34
  Last 7 days     123.4K     34.5K     890.1K    45.6K   $5.67
  Today            12.3K      4.5K      89.0K     3.4K   $0.71

── Today by Model ───────────────────────────────────────────
  openai/gpt-5.4              10.1K      3.2K    78.0K    2.1K   $0.52
  anthropic/claude-opus-4-6    2.2K      1.3K    11.0K    1.3K   $0.19
```

### Implementation phases

#### Phase 1 — Core scanning & `/usage`

- [ ] Set up package.json with pi manifest
- [ ] Implement JSONL glob + line-by-line parser
- [ ] Extract UsageRecord from assistant messages
- [ ] Deduplicate by timestamp+tokens hash
- [ ] Aggregate: lifetime, today, this month, last 7d, last 30d
- [ ] Per-model breakdown for "today"
- [ ] Register `/usage` command
- [ ] Test with real session data

#### Phase 2 — Breakdown commands

- [ ] `/usage models`
- [ ] `/usage sessions [N]`
- [ ] `/usage days [N]`
- [ ] `/usage months`
- [ ] `/usage projects`

#### Phase 3 — Performance & caching

- [ ] Cache scan results in memory (per pi session)
- [ ] Track file mtimes for incremental updates
- [ ] `/usage refresh` for forced rescan
- [ ] Show scan progress for large collections

#### Phase 4 — Export & polish

- [ ] `/usage export json`
- [ ] `/usage export csv`
- [ ] Optional footer/status widget
- [ ] Formatting polish

## Technical decisions

### Direct JSONL parsing vs SessionManager API

Direct parsing wins because:

- Simpler, no API coupling
- Streaming is memory-efficient
- ccusage validates this approach
- SessionManager is for interactive use, not bulk analysis

### Pre-computed costs vs pricing table

Use `usage.cost.total` from pi. No need to maintain a model pricing table (unlike `@artale/pi-cost` which hardcodes prices). Pi already computes correct costs per-message.

### Deduplication

ccusage uses `timestamp + totalTokens` as a dedup key. This handles:

- Branched sessions (same message appears in forked session files)
- Re-opened sessions

### No external persistence

Session files are the source of truth. No `~/.pi/cost.json` or similar. This avoids sync issues and keeps the extension stateless.

### Project name extraction

From session path: `~/.pi/agent/sessions/--Users-foo-myproject--/` → extract `--Users-foo-myproject--`, then decode to display as project path. ccusage uses the raw directory name; we can do better by converting `--` delimiters and `-` back to `/`.
