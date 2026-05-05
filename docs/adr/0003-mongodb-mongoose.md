# ADR-0003: MongoDB with Mongoose for Data Persistence

**Date:** 2024  
**Status:** Accepted

## Context

FaithRequest needs a database to persist user accounts and their prayer data. The data model is user-centric: one user owns all their prayer lists and requests.

Database options considered:
- MongoDB (Atlas) + Mongoose
- PostgreSQL + Prisma
- SQLite (local file)
- Firebase Firestore

## Decision

Use MongoDB Atlas as the database and Mongoose as the ODM.

## Rationale

- **Document model fits the data shape.** A user's complete prayer data (lists + requests) is a natural document. Embedding lists and prayers inside the User document enables fetching everything in a single query with no joins. See ADR-0009 for details on the embedding decision.
- **MongoDB Atlas managed hosting.** Atlas provides free-tier hosting, automatic backups, connection pooling, and is available in the same AWS regions as the ECS cluster. No server to manage.
- **Mongoose schema validation.** Mongoose schemas enforce field types, max lengths, enums, and required constraints at the application layer before any data reaches the database, preventing malformed documents.
- **Familiarity.** MongoDB + Mongoose is one of the most documented Node.js stacks.

## Trade-offs

- **No transactions across documents.** Since all data is embedded in one document, writes are inherently atomic per user. This is a benefit here, but if the schema ever needed to split data across collections, multi-document transactions would be required (MongoDB 4+ supports them, but they add complexity).
- **Document size limit.** MongoDB documents have a 16 MB limit. A user with thousands of prayers could theoretically approach this — unlikely for a personal prayer app but worth monitoring.
- **Less rigid schema.** Unlike PostgreSQL with migrations, MongoDB allows fields to change without schema migrations. Mongoose validation helps, but older documents may have different shapes. The `ensureUncategorizedList` utility is an example of handling this.

## Consequences

- All user data is embedded: `User → prayerLists[] → prayers[]`.
- Every successful API mutation returns the full updated User document to keep the frontend in sync.
- `MONGODB_URI` is stored in AWS Secrets Manager in production and injected as an environment variable at ECS task startup.
- `autoIndex: true` is set in the Mongoose connection to build schema indexes on start-up. This is acceptable at current scale.
