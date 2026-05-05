# ADR-0011: S3 + CloudFront for Frontend Deployment

**Date:** 2024  
**Status:** Accepted

## Context

The FaithRequest frontend is a set of static HTML, CSS, and JS files (no server-side rendering). It needs to be hosted at `https://faithrequest.com` with HTTPS and reasonable global performance.

Static hosting options considered:
- AWS S3 + CloudFront (CDN)
- Netlify
- Vercel
- GitHub Pages
- EC2/Nginx

## Decision

Host the frontend on AWS S3 (private bucket) served through an AWS CloudFront distribution with an ACM TLS certificate for `faithrequest.com`.

## Rationale

- **No server to manage.** S3 stores the files; CloudFront distributes them. No EC2, no container, no patching.
- **Global CDN performance.** CloudFront caches files at edge locations worldwide. The user downloads from the nearest edge node rather than the S3 origin bucket's region.
- **Tight AWS ecosystem integration.** The backend runs on ECS in the same AWS account. DNS (Route53), TLS (ACM), and CDN (CloudFront) are all managed in one console with unified billing.
- **Origin Access Control (OAC).** The S3 bucket is private. Only the CloudFront distribution can read it. Direct S3 URL access is blocked.
- **Deployment is a simple `aws s3 sync`.** No build step required (ADR-0001). Files are uploaded directly from the repo.

## Trade-offs

- **CloudFront cache invalidation.** After deploying new files to S3, a CloudFront invalidation (`/*`) must be triggered for users to see the new version. Cached files can serve stale content for up to 24 hours without invalidation.
- **ACM certificate must be in us-east-1.** CloudFront requires ACM certificates to be in the US East (N. Virginia) region regardless of where the distribution or origin is. This is an AWS constraint.
- **Slightly more setup than Netlify/Vercel.** Netlify and Vercel offer one-click deploys with built-in CDN. The AWS setup requires Route53, ACM, S3, and CloudFront configuration. The `aws-deployment-guide.html` documents all required steps.
- **No server-side logic.** If the frontend ever needs server-side rendering, a different hosting platform would be needed. Given the vanilla JS architecture (ADR-0001), this is not a concern.

## Consequences

- The `deploy/aws/prepare.js` script (run via `npm run aws:prepare`) replaces `config.js` with a production version pointing to `https://api.faithrequest.com/api` before the S3 sync.
- All pages reference `config.js` for the API URL, so no hardcoded URLs exist in the HTML or JS files.
- Cache-Control headers should be set appropriately: `no-cache` for `index.html`/`*.html`, and long TTLs for versioned assets. This is configured in the CloudFront distribution settings.
