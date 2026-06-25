# PBE Address Book — Design-Review Findings

Reviewer: DR-B
Review Number: DR-B-2
Review Focus: Security
Date of Review: 2026-06-07

## Overview of Findings

Before diving into specific vulnerabilities, here is my orientation of the system's trust boundaries and authentication model based on the provided design:

**Authentication & Authorization Model:**
* **User Auth:** Relies entirely on Ghost (pbe400.org) as the Identity Provider. Ghost issues a JWT, which the Book SPA passes to the backend via URL fragment. The Book backend validates the JWT against Ghost's JWKS, extracts the email, maps it to a `profiles` document on a *first-match* basis, and issues its own `HttpOnly`, `SameSite=Strict` session cookie.
* **Machine Auth:** The Linter tool uses a Google Service Account OIDC token to authenticate against the `/api/roster` endpoint.
* **Authorization:** Handled server-side via a field-visibility projection model. Read/Write access is determined by a combination of the user's `role` (`users` collection) and the target profile's `privacy` flags. 

**Trust Boundaries & Attack Surface:**
1.  **Browser <-> Book API:** The primary attack surface. Vulnerable to IDOR, mass assignment, and data validation bypasses.
2.  **Book API <-> Ghost API:** A highly sensitive, asymmetric trust boundary. Book blindly trusts Ghost for identity verification and pushes updates to it via a privileged Admin API key.
3.  **Book API <-> Linter:** Machine-to-machine boundary requiring strict isolation from public routing.
4.  **Admin <-> CSV Export/Import:** A classic vector for CSV injection and data poisoning.

**Overall Security Posture:**
The design successfully mitigates several common SPA risks (e.g., moving privacy projection to the server, avoiding frontend-only masking, using `HttpOnly` cookies instead of `localStorage` for tokens). However, the architecture introduces **critical flaws around identity mapping, trust delegation to Ghost, and application-layer DoS vulnerabilities**. If deployed as designed, the system is vulnerable to complete account takeover and data compromise. 

## Detailed Finding Register

| Review | Finding # | Severity | Location (`file §section`) | Finding Description | Reviewer's Suggested Resolution | Disposition | Action Taken |
| ------ | --------- | -------- | -------------------------- | ------------------- | ------------------------------- | ----------- | ------------ |
| DR-B-2 | 1 | blocker | `DATABASE-SCHEMA.md §8`, `API-SPEC.md §2` | **Account Takeover via Missing Email Uniqueness Constraint.** Book resolves identity on "first successful match" of the JWT email. However, the schema validation rules *do not enforce email uniqueness*. A malicious brother could `PATCH` their email/alternateEmail to match an Admin's email. If Ghost accepts the push (or if the attacker changes it in Ghost directly), their next login JWT will carry the Admin's email, mapping them to the Admin profile and granting full system takeover. | Explicitly enforce strict global uniqueness for `email` and `alternateEmail` at the database level and during the `PATCH` endpoint validation. | | |
| DR-B-2 | 2 | blocker | `ENGINEERING-DESIGN.md §5.1`, `DECISIONS.md D54` | **Privilege Escalation via Asymmetric Ghost Trust.** Book relies entirely on Ghost's JWKS to authenticate *all* roles, including Book Administrators. Because Ghost is a CMS with a lower security profile than a PII-heavy directory, a compromise of Ghost (e.g., gaining Ghost Admin access) allows an attacker to forge JWTs for Book Admins. This turns Ghost into a single point of total failure for Book's integrity. | Implement multi-factor authentication (MFA) or an independent identity verification mechanism for Administrator roles that does not rely solely on Ghost. | | |
| DR-B-2 | 3 | blocker | `API-SPEC.md §3.4` | **Information Disclosure via Incomplete Mass Assignment Protection.** The spec notes "Fields the caller may not edit are rejected," but relies heavily on *read* projection logic. If an attacker submits `{"role": "admin", "adminNote": "hacked", "ghostMemberId": "123"}` via `PATCH /api/profiles/{id}`, implicit rejection is insufficient. Write projection must be explicitly decoupled from read projection. | Implement an explicit, hardcoded allow-list of mutable fields for the `PATCH` payload, strictly stripping internal/system fields (`role`, `adminNote`, `id`, `ghostMemberId`) before processing. | | |
| DR-B-2 | 4 | blocker | `API-SPEC.md §3.4` | **Insecure Direct Object Reference (IDOR) on Profile Edits.** Constitution IDs are easily guessable, contiguous integers. The `PATCH` endpoint states "owner, manager, or admin", but does not explicitly detail the server-side identity verification. A malicious user could iterate through IDs sending `PATCH` requests. | Explicitly mandate the server-side check: `request.profileId == session.profileId OR session.role IN ('manager', 'admin')` before processing any `PATCH` or `PUT` operation. | | |
| DR-B-2 | 5 | should-fix | `ENGINEERING-DESIGN.md §5.2` | **Authentication Bypass / Broken Architecture for Linter API.** The design proposes verifying the Linter's SA token at the "Cloud Run front door (require auth + grant the service account roles/run.invoker)". This is architecturally impossible for Book: Cloud Run IAM is all-or-nothing per service. You cannot enforce IAM on `/api/roster` while leaving `/api/auth/session` and the SPA unauthenticated to the public internet. | Remove the Cloud Run IAM "front door" option. Mandate that the application code must verify the Google OIDC JWT against Google's JWKS internally for the `/api/roster` route. | | |
| DR-B-2 | 6 | should-fix | `ENGINEERING-DESIGN.md §1.6`, `DECISIONS.md D75` | **Application-Layer DoS via Synchronous Brotli Level 11.** The backend compresses the ~2000-record dataset using Brotli level 11 dynamically upon the first request after a cache invalidation. Brotli level 11 is notoriously CPU-intensive and slow. A user making frequent profile edits will trigger constant invalidations and recompilations, locking the single-threaded Node.js event loop and causing a DoS for all users. | Lower the Brotli compression level to a safer default (e.g., level 4-6) or offload the compression generation to an asynchronous background worker rather than the main request thread. | | |
| DR-B-2 | 7 | should-fix | `PRD.md §5.6.8`, `DATABASE-SCHEMA.md §10` | **CSV Injection (Formula Injection) in Admin Export.** The SPA performs client-side CSV exports containing user-generated free-text strings (`employerName`, `jobTitle`). If a malicious brother prepends their data with Excel formulas (e.g., `=cmd\|' /C calc'!A0`), an Admin opening the exported CSV in Excel is vulnerable to arbitrary code execution. | The client-side CSV generator must sanitize all fields by stripping or escaping leading `=`, `+`, `-`, or `@` characters. | | |
| DR-B-2 | 8 | minor | `DECISIONS.md D61` | **Audit Logging Privacy Leak.** The audit log discipline strictly logs field *names*, not values, to prevent PII leakage. However, for the `PUT /api/me/stars/{id}` action, the target `id` *is* the value being manipulated. While minor, this technically violates the "no values" discipline. | Document an explicit exception in the logging policy for relationship edges (like stars or Big Brother IDs) where the target ID is inherently part of the action metadata. | | |

## Severity legend (reviewer-assigned)

- **blocker** — must be resolved before building from these docs.
- **should-fix** — a real problem worth correcting, not a build-stopper.
- **minor** — small clarity/consistency nit.
- **question** — the reviewer is unsure; needs a judgment call.
