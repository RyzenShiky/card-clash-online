# Security Rules test matrix (manual / Emulator)

## Profile
- [ ] A read own public → allow
- [ ] A write own displayName ≤32 → allow
- [ ] A write B public → deny
- [ ] displayName length 0 → deny

## Room codes
- [ ] Create new code → allow
- [ ] Overwrite existing code (other host) → deny
- [ ] Host delete own code → allow

## Matchmaking
- [ ] Host create queue entry hostId=self → allow
- [ ] User write other room queue → deny

## Room players
- [ ] Join self → allow
- [ ] Host add bot-* → allow
- [ ] User write other human player → deny

## Hands
- [ ] Read own hand → allow
- [ ] Read opponent hand → deny
- [ ] Host deal all hands → allow

## Chat
- [ ] Member send uid=self → allow
- [ ] Edit existing message → deny
- [ ] Non-member write → deny

## Leaderboard / rankedResults
- [ ] Any client write → deny
