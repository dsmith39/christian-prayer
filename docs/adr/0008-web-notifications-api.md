# ADR-0008: Web Notifications API for Prayer Reminders

**Date:** 2024  
**Status:** Accepted

## Context

FaithRequest lets users set daily reminder alerts on individual prayer requests. The app needs a way to deliver these reminders to the user even when they are not actively looking at the page.

Notification delivery options considered:
- Browser Notifications API (Web Push / Notification API)
- Server-side push (WebSocket / SSE) with in-page toast only
- Email reminders via a third-party service (SendGrid, SES)
- No reminders (opt-out)

## Decision

Use the browser's Notifications API for desktop/mobile push notifications, with an in-app toast as a fallback for users who decline permission.

Alert times are stored in the database (`nextAlertAt` timestamp, `alertTime` HH:MM string). The frontend polls every 30 seconds (`ALERT_POLL_INTERVAL_MS`) to check if any prayer's `nextAlertAt` has passed.

## Rationale

- **Zero server infrastructure.** No WebSocket server, no email service, no push server. The browser handles delivery entirely.
- **Opt-in by design.** The browser always requires the user to grant permission before showing notifications. The app respects a "denied" state gracefully.
- **Simple polling is sufficient.** A 30-second poll is accurate to within half a minute, which is precise enough for daily prayer reminders. No real-time protocol is needed.
- **Persistent reminders.** Storing `nextAlertAt` in the database means alert state is preserved if the user logs in from a different browser tab.

## Trade-offs

- **Requires the page to be open.** Browser notifications only fire while the tab is open in the browser. They do not work when the browser is closed. True background delivery would require a Service Worker with a Web Push subscription (VAPID keys, push server), which significantly increases complexity.
- **Permission is easily denied.** Many users instinctively block notification permission requests. In-app toasts serve as the fallback.
- **Polling overhead.** Every 30 seconds, `processAlerts()` runs and iterates all prayers. This is negligible at the expected data volume (tens to hundreds of prayers).
- **Client-side scheduling.** If the user's system clock is wrong, alerts may fire at incorrect times. Server-side scheduling would be more reliable but requires a background job system.

## Consequences

- `updateNotificationButton()`, `requestNotificationPermission()`, `triggerPrayerAlert()`, and `processAlerts()` in `app.js` implement the notification system.
- After an alert fires, `nextAlertAt` is updated to the next day via a `PATCH` API call so the reminder recurs daily.
- The Enable Notifications button is hidden if the browser does not support the Notifications API.
