# ADR-0013: DynamoDB Single-Table Design Replaces MongoDB Atlas

**Date:** 2026-07-07
**Status:** Accepted
**Supersedes:** [ADR-0003](0003-mongodb-mongoose.md), [ADR-0012](0012-mongodb-atlas.md)

## Context

FaithRequest launched on MongoDB Atlas (ADR-0003, ADR-0012). At first production deployment, its trade-offs became the deciding factor:

- Atlas is an external SaaS account, separate from AWS billing and IAM.
- Atlas Network Access requires allowlisting the ECS tasks' outbound IP, which in practice meant a NAT Gateway (~$32/month) purely so Atlas could see a stable source IP.
- Nothing about the app's actual data access pattern needs a document database's query flexibility — every read is `getUser(userId)` or `getUser(email)`, never a cross-user query (see ADR-0009).

## Decision

Replace MongoDB Atlas with a single DynamoDB table, `faithrequest-users`, on-demand (PAY_PER_REQUEST) billing.

Two item shapes in one table:

- **Profile item** — `pk="USER#<uuid>"`, `sk="PROFILE"`: `userId, name, email, passwordHash, prayerLists (nested List), createdAt, updatedAt`. This preserves the embedded-document model from ADR-0009 exactly — `prayerLists[] → prayers[]` is stored as a nested attribute on one item, just as it was one Mongoose document.
- **Email-lock item** — `pk="EMAIL#<email>"`, `sk="PROFILE"`: `{ userId }`. Exists only so registration can atomically enforce a unique email (`TransactWriteItems` with `ConditionExpression: attribute_not_exists(pk)` on both items) and so login can look up a user by email with a direct `GetItem` instead of a secondary index.

No GSI is needed — the email-lock item's key *is* the index.

## Rationale

- **Fully AWS-native.** Same account, same IAM, same bill, no external vendor console or API key to manage.
- **No NAT Gateway required.** Lambda/ECS reach DynamoDB over the AWS network (or a VPC endpoint if ever placed in a VPC) — no outbound internet path or IP allowlist needed. This also removed the reason ADR-0012 needed the NAT Gateway in the first place.
- **Pay-per-request pricing.** Near-$0 at this app's traffic, vs. Atlas M0's storage cap or an M10's ~$57/month fixed cost at real scale.
- **Matches the access pattern exactly.** Every operation in `backend/models/User.js` is a key-based `GetItem`/`PutItem`/`UpdateItem`/`TransactWriteItems` — no query planner, no indexes to tune, no N+1 risk.
- **IAM-scoped access.** The Lambda execution role's inline policy grants only `GetItem`/`PutItem`/`UpdateItem`/`DeleteItem`/`TransactWriteItems`/`Query` on this one table ARN — no shared credential to rotate or leak.

## Trade-offs

- **No cross-user queries.** Same limitation as the embedded-document model already had (ADR-0009) — acceptable since FaithRequest has no such use case.
- **16 KB item size soft-comfort-zone** (DynamoDB's hard limit is 400 KB per item). A user's `prayerLists` attribute could theoretically approach this at very heavy use; unlikely for a personal prayer app but worth monitoring, same caveat as MongoDB's 16 MB limit was.
- **No ODM-level schema validation.** Mongoose enforced field types/maxlength/enums at the model layer. That validation now lives only in the route handlers (`authRoutes.js`, `userRoutes.js`), which already duplicated it as a defense-in-depth measure — no functional gap, just one less layer.
- **Manual uniqueness pattern.** DynamoDB has no native unique-secondary-attribute constraint (unlike Mongoose's `unique: true` index), hence the email-lock item + transaction pattern above.

## Consequences

- `backend/config/dynamo.js` exports a shared `DynamoDBDocumentClient`; there is no connect step (the SDK client is stateless).
- `backend/models/User.js` is a plain data-access module (`createUser`, `findByEmail`, `findById`, `updateUser`, `deleteUser`) instead of a Mongoose model.
- `DYNAMODB_TABLE_NAME` (env var) replaces `MONGODB_URI`. No `MONGODB_URI` secret exists anymore.
- Route handlers generate `_id` for new prayer lists/prayers with `uuid()` instead of relying on Mongoose's automatic subdocument `_id`.
