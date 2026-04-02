# Plan

## Overview

Build a pi extension that provides lifetime token usage analytics by scanning all pi session JSONL files.

## Architecture

### Data source

Pi session files are stored as JSONL at `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl`.

Each assistant message entry contains:

```typescript
{
  type: "message",
  message: {
    role: "assistant",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
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
        total: number
      }
    },
    timestamp: number
  },
  timestamp: string  // ISO
}
```

### Scanning strategy

1. Use `SessionManager.listAll()` to enumerate all sessions
2. For each session, open with `SessionManager.open(path)` and iterate entries
3. Extract usage data from assistant messages
4. Aggregate into in-memory data structures
5. Cache results and invalidate on session changes

### Data model

```typescript
interface UsageRecord {
  timestamp: number        // Unix ms
  provider: string
  model: string
  project: string          // extracted from session cwd
  sessionId: string
  sessionFile: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  costTotal: number
  costInput: number
  costOutput: number
  costCacheRead: number
  costCacheWrite: number
}
```

### Aggregation dimensions

- **Time**: lifetime, this month, last 30 days, last 7 days, today, by day, by month
- **Model**: group by `provider/model`
- **Project**: group by session cwd (last path component)
- **Session**: group by session file

### Extension structure

Single-file extension: `src/index.ts`

#### Commands

| Command | Description |
|---------|-------------|
| `/usage` | Lifetime summary + today + this month + last 7 days |
| `/usage models` | Breakdown by provider/model, sorted by cost |
| `/usage sessions` | Top 20 sessions by cost |
| `/usage days [N]` | Daily rollup for last N days (default: 7) |
| `/usage months` | Monthly rollup |
| `/usage export [json\|csv]` | Export all records |
| `/usage refresh` | Force rescan of all sessions |

#### Implementation phases

### Phase 1 — Core scanning & `/usage` command

- [ ] Set up project structure (package.json, tsconfig, etc.)
- [ ] Implement session scanning using `SessionManager.listAll()` + `SessionManager.open()`
- [ ] Extract `UsageRecord` from assistant messages
- [ ] Implement basic aggregation (lifetime, today, this month, last 7 days)
- [ ] Register `/usage` command with summary output
- [ ] Test with real session data

### Phase 2 — Breakdown commands

- [ ] `/usage models` — group by provider/model
- [ ] `/usage sessions` — top sessions by cost
- [ ] `/usage days [N]` — daily rollup
- [ ] `/usage months` — monthly rollup

### Phase 3 — Performance & caching

- [ ] Cache scan results in memory
- [ ] Track session file mtimes for incremental updates
- [ ] `/usage refresh` command for forced rescan
- [ ] Show scan progress for large session collections

### Phase 4 — Export & polish

- [ ] `/usage export json` — dump all records
- [ ] `/usage export csv` — CSV export
- [ ] Footer/status widget (optional toggle)
- [ ] Formatting polish, colors, tables

## Technical decisions

### Why scan JSONL files directly?

- Session files are the canonical source of truth
- No need for a separate database or sync mechanism
- Pi already provides `SessionManager` API for listing and opening sessions
- Data is always fresh and consistent

### Why not persist aggregated data?

- Avoids sync/corruption issues
- Session files already persist everything
- Scanning is fast enough with caching
- Keeps the extension stateless and simple

### Formatting

- Use `ctx.ui.notify()` for command output
- Use ANSI escape codes for colors/formatting (like `@artale/pi-cost` does)
- Keep output compact and scannable
- Use the theme API where available

## File structure

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
