# Architecture: Session Recovery System

**Status:** Design Proposal  
**Date:** 2026-05-08  
**Target:** MammothMINICLI — replacement for current `SessionStore.ts`

---

## 1. Overview

The current `SessionStore` uses synchronous JSON file writes with no crash recovery, no snapshots, and no isolation between concurrent sessions. This design proposes a **RecoverableSessionStore** with atomic writes, snapshot/rollback support, session isolation, and integrity verification.

### Goals
- **Crash-safe writes** — no corrupt sessions from interrupted writes
- **Snapshots** — point-in-time saves for rollback
- **Rollback points** — named checkpoints (manual + automatic at turn boundaries)
- **Concurrent isolation** — multiple MammothLoop instances operate independently
- **Backward compatibility** — migrate existing `.mammoth/sessions/*.json` files

---

## 2. Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       MammothLoop                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │ ToolRegistry │   │ PermManager  │   │ RecoverableSessionStore│ │
│  └──────────────┘   └──────────────┘   └──────────┬───────────┘ │
└────────────────────────────────────────────────────┼────────────┘
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          │           RecoverableSessionStore                    │
                          │                                                      │
                          │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
                          │  │  Snapshot    │  │  Rollback    │  │  Journal    │ │
                          │  │  Manager     │  │  Manager     │  │  Manager    │ │
                          │  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘ │
                          │         │                │                  │        │
                          │         └────────────────┼──────────────────┘        │
                          │                          │                           │
                          │               ┌──────────▼──────────┐                │
                          │               │   Storage Backend    │                │
                          │               │  (FileSystem / WAL)  │                │
                          │               └──────────┬──────────┘                │
                          └──────────────────────────┼──────────────────────────┘
                                                     │
                                   ┌─────────────────▼─────────────────┐
                                   │         .mammoth/sessions/         │
                                   │  ┌─────────────────────────────┐  │
                                   │  │ session-XYZ/                  │  │
                                   │  │   ├── wal.json               │  │
                                   │  │   ├── session.json           │  │
                                   │  │   ├── meta.json              │  │
                                   │  │   ├── snapshots/             │  │
                                   │  │   │    ├── snap-001.json     │  │
                                   │  │   │    └── snap-002.json     │  │
                                   │  │   └── rollbacks/             │  │
                                   │  │        ├── auto-turn-3.json  │  │
                                   │  │        └── manual-check.json │  │
                                   │  └─────────────────────────────┘  │
                                   └───────────────────────────────────┘
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **RecoverableSessionStore** | Public API, orchestrates all subsystems |
| **Snapshot Manager** | Creates, lists, and restores full session snapshots |
| **Rollback Manager** | Creates named rollback points; restores to any point |
| **Journal Manager** | Write-Ahead Log for crash recovery; replays on startup |
| **Storage Backend** | Abstract file I/O; swap between filesystem, memory, etc. |

---

## 3. Data Model

### 3.1 Session Directory Layout

```
.mammoth/sessions/
├── session-abc123/                    # One directory per session
│   ├── wal.json                       # Write-Ahead Log (append-only)
│   ├── session.json                   # Canonical message file (checkpointed)
│   ├── meta.json                      # Session metadata
│   ├── snapshots/                     # Point-in-time full copies
│   │   ├── 2026-05-08T10-00-00.json
│   │   └── 2026-05-08T10-05-00.json
│   └── rollbacks/                     # Named checkpoints (diffs or full)
│       ├── auto-turn-3.json
│       └── before-dangerous-op.json
└── store.lock                         # Global lock file (optional)
```

### 3.2 WAL Entry Format

```typescript
interface WALEntry {
  seq: number                    // Monotonic sequence number
  op: 'append_msg' | 'system' | 'checkpoint'
  timestamp: string              // ISO 8601
  payload: DSMLMessage | { systemPrompt: string }
}
```

### 3.3 Snapshot Format

```typescript
interface SessionSnapshot {
  id: string                     // Snapshot ID
  sessionId: string
  createdAt: string
  label?: string                 // Human-readable label
  messages: DSMLMessage[]
  systemPrompt: string
  turnCount: number
  checksum: string               // SHA-256 of messages JSON
}
```

### 3.4 RollbackPoint Format

```typescript
interface RollbackPoint {
  id: string
  sessionId: string
  name: string                   // e.g., "auto-turn-5", "before-rm-rf"
  createdAt: string
  turnNumber: number
  messages: DSMLMessage[]        // Full messages at that point
  diff?: {                       // Optional diff from previous rollback
    fromId: string
    added: number                // Message count added since
  }
}
```

### 3.5 Meta Format (Extended)

```typescript
interface SessionMeta {
  id: string
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  turnCount: number              // NEW
  snapshotCount: number          // NEW
  lastCheckpointSeq: number      // NEW — WAL sequence of last checkpoint
  dirty: boolean                 // NEW — true if WAL has uncheckpointed entries
}
```

---

## 4. API Surface

### 4.1 RecoverableSessionStore

```typescript
class RecoverableSessionStore {
  // Lifecycle
  constructor(config?: SessionConfig)
  
  // Session management
  newSession(firstMessage?: string): string
  load(sessionId: string): DSMLMessage[] | null
  save(messages: DSMLMessage[]): void         // WAL append + periodic checkpoint
  list(): SessionMeta[]
  getLastSession(): string | null
  delete(sessionId: string): void             // NEW
  
  // Crash recovery
  recover(): RecoveryReport                   // NEW — replays WAL on startup
  checkpoint(): void                           // NEW — flush WAL to session.json
  
  // Snapshots
  createSnapshot(label?: string): string       // NEW — returns snapshot ID
  restoreSnapshot(snapshotId: string): void    // NEW
  listSnapshots(): SessionSnapshot[]
  deleteSnapshot(snapshotId: string): void
  
  // Rollback points
  createRollbackPoint(name: string): void      // NEW
  rollback(name: string): DSMLMessage[]        // NEW — returns restored messages
  listRollbackPoints(): RollbackPoint[]
  
  // Concurrency
  lock(): void                                 // NEW — acquire session lock
  unlock(): void                               // NEW
  isLocked(): boolean
  
  // Integrity
  verify(): IntegrityReport                    // NEW — checksum validation
  repair(): RepairReport                       // NEW — attempt to fix corruption
}

interface SessionConfig {
  baseDir?: string
  autoCheckpointInterval?: number   // Messages between auto-checkpoints (default: 50)
  maxSnapshots?: number             // Max snapshots to retain (default: 10)
  maxRollbackPoints?: number        // Max rollback points (default: 20)
  walMaxSize?: number               // Max WAL entries before forced checkpoint
  isolationMode?: 'directory' | 'lock'  // Concurrency strategy
}
```

### 4.2 Atomic Write Protocol

```
Save:
  1. Serialize messages to JSON
  2. Write to TEMP file: session.json.{pid}.tmp
  3. fsync TEMP file
  4. Atomic rename: TEMP → session.json
  5. Update WAL with checkpoint marker

Load:
  1. Read session.json
  2. Read WAL, replay entries since last checkpoint
  3. Return merged messages

Snapshot:
  1. Lock session
  2. Copy current session.json → snapshots/{timestamp}.json
  3. Write checksum
  4. Unlock

Rollback:
  1. Lock session
  2. Copy rollback point messages to session.json (atomic write)
  3. Truncate WAL to rollback point sequence
  4. Unlock
```

---

## 5. Crash Recovery Protocol

```
On startup:
  1. List all session directories
  2. For each session:
     a. Read meta.json → check dirty flag
     b. If dirty: read WAL, find last checkpoint
     c. Load session.json (last checkpoint)
     d. Replay WAL entries after last checkpoint
     e. Write recovered state to session.json
     f. Clear dirty flag
  3. Report: { sessionsChecked, sessionsRecovered, messagesReplayed, errors[] }

On save crash:
  - WAL is append-only, always valid
  - session.json is only written via atomic rename
  - Worst case: lose last WAL entry (not yet fsynced) → 1 message loss
```

---

## 6. Migration Path

### Phase 1: Shadow Mode (v1.0 → v1.1)
- Deploy `RecoverableSessionStore` alongside current `SessionStore`
- On load: if old format detected (`{id}.json` in root sessions dir), migrate to new directory structure
- Write both formats for one version (dual-write)

### Phase 2: Default (v1.2)
- `RecoverableSessionStore` becomes default
- Old `SessionStore` becomes `LegacySessionStore` with deprecation warning
- Auto-migrate on first access

### Phase 3: Cleanup (v2.0)
- Remove legacy `SessionStore`
- Remove migration code
- Old format files readable but no longer written

### Migration Function

```typescript
function migrateSession(oldFile: string, newDir: string): boolean {
  // 1. Read old {id}.json + {id}.meta.json
  // 2. Create new directory structure
  // 3. Write session.json (atomic)
  // 4. Write meta.json
  // 5. Initialize empty WAL
  // 6. Verify checksums match
  // 7. Return success/failure
}
```

---

## 7. Trade-offs & Risks

| Decision | Benefit | Risk |
|----------|---------|------|
| WAL (append-only) | Crash-safe, no corruption | Higher disk usage; must periodically checkpoint |
| Directory-per-session | Isolation, easy cleanup | More inodes; slightly slower listing |
| Atomic rename writes | No partial writes | Requires fsync; not available on all filesystems |
| JSON format | Human-readable, debuggable | Slower than binary; larger files |
| No compression (v1) | Simplicity, fast access | Large sessions bloat disk |

---

## 8. Future Extensions

- **Compression**: gzip snapshots > 1MB
- **Streaming writes**: Append to WAL without full serialization
- **Remote sync**: Push snapshots to S3/GCS for backup
- **Encryption**: At-rest encryption for session files
- **Delta snapshots**: Store only message diffs, not full copies
- **Session merging**: Combine two sessions into one
