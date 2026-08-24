# Security — Card Clash

## Deploy rules (priority #1)
```bash
firebase deploy --only database
firebase deploy --only storage
```
See `database.rules.json` + `OWNERSHIP.md`.

## What Rules protect now
- Deny-by-default
- Profile / friends / inbox ownership
- roomCodes: create-once, no overwrite
- matchmaking entry only by hostId === auth.uid
- Room meta/settings: host only
- Hands: private read; write self or host (deal)
- Leaderboard & rankedResults: **no client write**
- Chat: members, uid must match auth
- Presence list readable for online count

## What Rules cannot replace (Phase 2)
| Risk | Mitigation |
|------|------------|
| Client writes `game` winner | Cloud Function `playCard` / `finishMatch` |
| Host fakes ranked MMR for others | CF only writes `players/$uid/ranked` |
| Illegal card play | CF validates hand + turn |
| Double action | `gameActions` + actionId server-side |

## Casual vs Ranked
- **Casual:** client game state OK with rules + actionId on client
- **Ranked:** treat results as untrusted until CF; leaderboard write denied

## App Check
Enable in console → monitoring → then enforce. Not a Rules substitute.

## Emulator
```bash
firebase emulators:start --only database
```
