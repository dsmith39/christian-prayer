# ADR-0009: Embedded Document Model (Single User Document)

**Date:** 2024  
**Status:** Accepted (storage engine changed to DynamoDB by [ADR-0013](0013-dynamodb-single-table.md); the embedding decision itself is unchanged — one DynamoDB item now holds the tree instead of one Mongoose document)

## Context

FaithRequest's core data consists of prayer lists and prayer requests, all owned by a single user. The question is how to store this in MongoDB:

- **Option A: Embedded sub-documents** — `User` contains `prayerLists[]`, each of which contains `prayers[]`.
- **Option B: Referenced collections** — separate `PrayerList` and `PrayerRequest` collections with `userId` / `listId` foreign keys.

## Decision

Use Option A: fully embedded documents. `User`, `PrayerList`, and `PrayerRequest` are all defined in a single Mongoose schema in `backend/models/User.js`. No separate collections exist for lists or prayers.

## Rationale

- **Single-query reads.** The entire user's prayer data is fetched in one `User.findById()` call. No joins, no `$lookup`, no separate queries. The API returns the full user document on every read and after every mutation, which is how the frontend stays in sync.
- **Atomic writes per user.** Mutations to a user's data (add list, delete prayer) are a single `user.save()` operation. MongoDB documents update atomically, so there is no risk of partial writes leaving the database in an inconsistent state.
- **Simple schema.** Three Mongoose sub-document schemas in one file are far simpler to reason about than three collections with referential integrity to maintain manually.
- **Access pattern is always by user.** FaithRequest never queries "all prayers across all users" or "all lists for a given category." Every API call is scoped to `req.auth.userId`. Embedding is ideal when the access pattern is always parent-first.

## Trade-offs

- **16 MB document size limit.** A user's document grows with every prayer added. At the expected scale (personal use, hundreds of prayers), this limit is not a concern. A user would need tens of thousands of large text prayers to approach it.
- **Cannot query across users.** Aggregate queries like "most popular prayer categories across all users" are expensive with this model. Since FaithRequest does not have this use case, this is acceptable.
- **No granular indexes on prayers.** A separate `PrayerRequest` collection could have indexes on `(userId, listId, answered)` for fast filtered reads. The embedded model reads all prayers and filters in application code. Fine at current scale.
- **Deletion of a list requires pulling from the array.** Mongoose's `$pull` on the sub-document array is used for list deletion, which is slightly more complex than a simple document delete but still straightforward.

## Consequences

- The User schema in `backend/models/User.js` is the single source of truth for all data shapes.
- The `ensureUncategorizedList()` utility creates the system list on-demand if it is missing from an older user document.
- Every API route handler that modifies data calls `await user.save()` and then returns `user` in the response. The frontend calls `applyUserData(user)` to synchronise state.
