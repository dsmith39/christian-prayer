# ADR-0001: Vanilla JavaScript Frontend (No Framework)

**Date:** 2024  
**Status:** Accepted

## Context

FaithRequest needs a frontend that can be served as static files from a CDN (S3 + CloudFront). The application has a single meaningful page (the dashboard), simple user interactions (forms, lists, cards), and a small team size of one developer.

Framework options considered:
- React (with Vite or CRA)
- Vue 3
- Svelte
- Vanilla JS

## Decision

Use plain browser JavaScript with no build step, no bundler, and no framework.

## Rationale

- **Zero build tooling.** Files can be uploaded directly to S3 without a CI compile step. The deploy process is `aws s3 sync` rather than `npm run build && aws s3 sync`.
- **Simplicity.** The dashboard has one page and a manageable set of interactions. A component tree would add more abstraction than it removes complexity.
- **No framework lock-in.** If the project grows, a framework can be introduced later. Migrating to React from vanilla JS is straightforward; migrating between frameworks is harder.
- **Instant load.** No framework runtime JS to download. The entire dashboard loads from two small scripts (`config.js`, `app.js`).
- **Legibility.** Future maintainers can read the code without knowing any specific framework API.

## Trade-offs

- **Manual DOM rendering.** Every state change re-renders affected DOM sections by hand (innerHTML + appendChild). Scales poorly past ~10 interactive components.
- **No reactivity primitives.** State changes must manually call `render()`. A reactive framework would handle this automatically and reduce bugs.
- **No component reuse.** Repeated card patterns are written inline. A component system would allow easy reuse.

## Consequences

- All state lives in a single `state` object in `app.js`.
- The `render()` function is called explicitly after every mutation.
- All user-supplied text must be passed through `escapeHtml()` before use in innerHTML to prevent XSS.
- If the application grows significantly (multiple views, complex interactions), consider migrating to a lightweight framework like Svelte or Vue 3.
