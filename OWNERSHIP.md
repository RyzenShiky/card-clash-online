# Database ownership map (Security Rules)

| Path | Read | Create | Update | Delete |
|------|------|--------|--------|--------|
| `players/$uid/public` | auth | owner | owner | owner |
| `players/$uid/private` | owner | owner | owner | owner |
| `players/$uid/friends` | owner | owner or friend | same | same |
| `players/$uid/inbox` | owner | sender (`fromUid`) | owner dismiss | owner |
| `usernames/$name` | auth | owner uid only | owner | owner |
| `presence/$uid` | auth (list) | owner | owner | onDisconnect |
| `roomCodes/$code` | auth | once only | **no overwrite** | auth (room close) |
| `matchmaking/{mode}/$roomId` | auth | hostId=auth | host | host |
| `rooms/$roomId` (create) | auth | host only | — | — |
| `rooms/.../meta` | auth | host | **host only** | host |
| `rooms/.../settings` | auth | host | host | host |
| `rooms/.../players/$pid` | auth | self or host bots | self / host | self or host |
| `rooms/.../hands/$uid` | **owner only** | owner | owner | owner |
| `rooms/.../game` | auth | member/host | member/host | — |
| `rooms/.../chat` | members | self uid | immutable | — |
| `leaderboard` | auth | **denied client** | denied | denied |
| `rankedResults` | auth | **denied client** | denied | denied |
| `gameActions/...` | members | create once self | immutable | — |

## Phase 2 (Cloud Functions) — required for Ranked 95%+
Client must **not** be the authority for:
- winner
- ranked MMR
- leaderboard
- playCard / drawCard legality

Until then: `rooms/.../game` remains member-writable (validated loosely).  
**Ranked results / leaderboard are client-write denied.**

## Deploy
```bash
firebase deploy --only database
firebase deploy --only storage
```

## Emulator tests (recommended)
```bash
firebase emulators:start --only database
# + @firebase/rules-unit-testing
```
