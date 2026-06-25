# PBE Address Book — Design-Review Findings

Reviewer: DR-B
Review Number: DR-B-1
Review Focus: Structural, completeness & consistency (broad)
Date of Review: 2026-06-07

As an AI acting as a senior engineer, I have reviewed the provided design documents. I approach this with no prior context, evaluating the architecture strictly on its technical merits, resilience, and completeness.

System Restatement
Purpose: The "Book" system is a custom, serverless web directory designed to replace the Phi Beta Epsilon (PBE) fraternity's outdated paper records and external MIT Alumni Association (MITAA) data. It acts as the authoritative system of record for the contact information and communication preferences of approximately 800 living alumni and 40 active undergraduates.

Users:
The system is accessed by authenticated fraternity members, who are divided into three role-based tiers (Brother, Manager, Administrator). It is also accessed programmatically by a first-party PBE News "Linter" (using a Google service account) to fetch canonical name data, and occasionally by administrators to export/import CSVs for MITAA reconciliation.

Data Flow:
Authentication originates from a custom Ghost (PBE News) route that mints a JWT. This JWT is passed via a URL fragment to the Book Single Page Application (SPA), which exchanges it with the Book backend for a 4-hour session cookie. On application load, the React SPA requests the entire directory (GET /api/profiles). The Cloud Run Node.js backend serves this payload from a synchronized in-memory cache, projecting the JSON to hide fields the user's role does not permit them to see. All searching, filtering, and sorting occur entirely in the browser's memory. When a user updates their profile, the SPA sends a PATCH request guarded by Optimistic Concurrency Control (Firestore updateTime ETags). The backend writes this to Firestore, which subsequently updates the in-memory caches of all active Cloud Run instances via a Firestore snapshot listener. Critical identity and consent changes are then synchronously pushed back to the Ghost Admin API to keep the newsletter platform aligned.

Documentation Gap / Lack of Confidence: The documents do not confidently explain how the SPA gracefully recovers from a 401 Unauthorized response during an asynchronous state-modifying action (e.g., clicking "Save" on a profile edit precisely after the 4-hour cookie expires). The design mentions that lapsed sessions "re-bounce through the bridge," but doing a hard window.location redirect during an XHR call would destroy the user's unsaved form data. This missing error-recovery path is a critical gap for an app emphasizing long, abandonable edit sessions.

Findings Register
Based on my adversarial review of the documentation suite, I have identified several severe architectural risks, missing edge cases, and implicit assumptions that threaten the buildability, performance, and stability of the system.

## Findings

| Review | Finding # | Severity | Location (`file §section`) | Finding Description | Reviewer's Suggested Resolution | Disposition | Action Taken |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| DR-B-1 | 1 | blocker | `ENGINEERING-DESIGN.md` §1.5 | **Cloud Run CPU Allocation vs. Snapshot Listeners.** The design relies on a Firestore snapshot listener to keep in-memory caches coherent across instances. However, Cloud Run defaults to throttling CPU to zero between HTTP requests. If CPU is not set to "always allocated", the background listener will freeze, drop websocket frames, and severely desync the cache, serving stale data to users. | Explicitly require the "CPU always allocated" pricing tier in the infrastructure spec, or refactor cache invalidation to use Pub/Sub push subscriptions (which wake up instances via HTTP). | | |
| DR-B-1 | 2 | blocker | `ENGINEERING-DESIGN.md` §1.6 | **Brotli Level 11 On-the-Fly Latency.** The design specifies memoized Brotli level 11 compression derived lazily on the first request. Brotli level 11 is notoriously CPU-intensive and slow. Executing this synchronously on the Node main thread during a cold start will block the event loop, causing massive latency spikes (potentially triggering API Gateway 10s timeouts) for the unlucky user who triggers the cache miss. | Downgrade to Brotli level 4 or 5 for dynamic on-the-fly compression, or shift the compression to an asynchronous background worker task upon cache invalidation. | | |
| DR-B-1 | 3 | should-fix | `PRD.md` §5.6.3 & `CODING-PROJECT-PLAN` | **Main Thread Locking via Load-Time Phonetic Compute.** Computing Double Metaphone (or Beider-Morse) codes for ~2000 profiles × 3 names (~6000 strings) synchronously on the browser's main thread during SPA initialization will cause severe UI jank, especially for the stated target demographic using older hardware/slow connections. | Move the Fuse.js indexing and Talisman phonetic code generation into a Web Worker, allowing the UI to remain responsive and render the grid while the search index builds in the background. | | |
| DR-B-1 | 4 | should-fix | `ENGINEERING-DESIGN.md` §6.5 | **Lack of API Versioning / Client Refresh Strategy.** The SPA is aggressively cached (`immutable` assets). If the backend schema or API contract evolves via the described Firestore migration scripts, a user with a stale SPA open in a background tab will send malformed data or crash. The design lacks a mechanism to force clients to update. | Implement a version header in API responses. If the SPA detects a newer API version, prompt the user to refresh, or fail gracefully with a "New version available" overlay. | | |
| DR-B-1 | 5 | should-fix | `ENGINEERING-DESIGN.md` §5.1 | **Synchronous Ghost API Rate Limits & Failure Modes.** The design pushes real-time updates to Ghost on save. It states "failed real-time push is retried a few times". If this happens synchronously during the `PATCH` request, it couples Book's latency and uptime strictly to Ghost's Admin API. If Ghost rate-limits or times out, the Book user experiences a hung "Save" button. | Decouple the Ghost push. Write the Book update to Firestore, return a `200 OK` to the client, and handle the Ghost API push asynchronously (e.g., via Cloud Tasks or a queued background job) with exponential backoff. | | |
| DR-B-1 | 6 | should-fix | `PRD.md` §5.6.8 & `API-SPEC.md` | **Client-Side Looping for Bulk Destructive Actions.** Administrators perform bulk deletes by selecting rows and iterating "the selection against the per-record `DELETE` endpoint." This is highly brittle. A network interruption during a 50-record delete leaves the database in a partial, non-transactional state with no rollback mechanism. | Implement a dedicated bulk-action endpoint (e.g., `POST /api/admin/bulk-delete`) that accepts an array of IDs and processes them within a server-side Firestore transaction or batch write. | | |
| DR-B-1 | 7 | should-fix | `PRD.md` §5.7.3 | **UI Visual Clutter (Mobile/Accessibility).** The privacy switches demand stating *both* consequences of a toggle in plain text (e.g., "Brothers can reach you by email"). Rendering 7 distinct, verbose toggles on a mobile viewport directly violates the design's stated goal of a "calm resting interface," creating severe scrolling fatigue and cognitive overload for elderly users. | Simplify the resting state. Use clear, concise standard labels (e.g., "Share Email"), and utilize the already-designed toggle-tip `?` (Popover) pattern to house the verbose "both consequences" explanatory text. | | |
| DR-B-1 | 8 | minor | `ENGINEERING-DESIGN.md` §6.6 | **Missing Virtualized List ARIA Assertions.** The design asserts WCAG 2.1 AA conformance and relies on TanStack Virtual. Virtualized lists remove DOM nodes, which breaks native screen-reader indexing (e.g., announcing "row 1 of 50" instead of 2000). The manual checklist does not explicitly verify virtualized ARIA attributes. | Add explicit requirements to test and implement `aria-rowcount`, `aria-rowindex`, and `aria-setsize` on the TanStack Virtual implementation to ensure assistive technologies accurately report the full dataset size. | | |


## Severity legend (reviewer-assigned)

- **blocker** — must be resolved before building from these docs.
- **should-fix** — a real problem worth correcting, not a build-stopper.
- **minor** — small clarity/consistency nit.
- **question** — the reviewer is unsure; needs a judgment call.
