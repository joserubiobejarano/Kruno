# Security Architecture

This document outlines the security architecture, enforcement mechanisms, and best practices for Kruno.

## Overview

Kruno uses a multi-layered security approach:
1. **Authentication**: Clerk handles user authentication
2. **Authorization**: Application-layer checks in API routes
3. **Input Validation**: Zod schemas for all API inputs
4. **Rate Limiting**: In-memory rate limiter (can upgrade to Redis)
5. **XSS Protection**: DOMPurify for user-generated content sanitization

## Authentication

### Clerk Integration

- All API routes (except public routes) require Clerk authentication
- Middleware (`middleware.ts`) protects routes using `clerkMiddleware`
- **Security Fix**: Middleware now fails securely (returns 401) instead of allowing requests through on auth errors

### Public Routes

The following routes are public and do not require authentication:
- `/` (homepage)
- `/sign-in(.*)`
- `/sign-up(.*)`
- `/p(.*)` (public trip sharing)
- `/api/webhooks/clerk(.*)` (webhook endpoints)
- `/api/debug(.*)` (debug endpoints – return 404 in production)
- `/api/test(.*)` (test email endpoints – return 404 in production)

## Authorization

### Centralized Auth Helpers

All authorization checks use centralized helpers in `lib/auth/`:

- **`requireAuth()`**: Ensures user is authenticated
- **`requirePro()`**: Ensures user has account-level Pro subscription
- **`requireTripAccess()`**: Ensures user has access to trip (owner or member)
- **`requireTripOwner()`**: Ensures user owns the trip
- **`requireTripPro()`**: Ensures user owns trip AND has Pro (account or trip-level)

### Usage Example

```typescript
import { requireTripAccess, tripAccessErrorResponse } from '@/lib/auth/require-trip-access';

export async function POST(request: NextRequest, { params }) {
  try {
    const { tripId } = await validateParams(params, TripIdParamsSchema);
    const supabase = await createClient();
    
    // Verify access
    const accessResult = await requireTripAccess(tripId, supabase);
    const trip = accessResult.trip;
    const profileId = accessResult.profileId;
    
    // ... rest of handler
  } catch (error) {
    if (error instanceof NextResponse) return error;
    return tripAccessErrorResponse(error);
  }
}
```

## Pro/Free Gating

### Server-Side Enforcement

**Critical**: All Pro/Free gating is enforced server-side. Client-side checks are for UI only and can be bypassed.

### Pro Status Types

1. **Account-Level Pro** (`profiles.is_pro`): User has active Pro subscription
2. **Trip-Level Pro** (`trips.has_trip_pro`): Specific trip has Pro unlock
3. **Effective Pro**: Either account Pro OR trip Pro grants access

### Pro-Only Features

The following features require Pro (account or trip-level):
- Multi-city trips (trip segments)
- Advanced Explore filters
- Higher usage limits (swipes, changes, search adds)

### Enforcement Points

- **Segments API** (`/api/trips/[tripId]/segments`): POST, PATCH, DELETE require `requireTripPro()`
- **Explore Filters**: Pro-only filters checked server-side
- **Usage Limits**: Enforced server-side in swipe/change/search-add endpoints

## Input Validation

### Zod Schemas

All API route inputs are validated using Zod schemas in `lib/validation/api-schemas.ts`.

### Validation Helpers

- **`validateBody()`**: Validates request body
- **`validateQuery()`**: Validates query parameters
- **`validateParams()`**: Validates route parameters

### Example

```typescript
import { validateBody, validateParams } from '@/lib/validation/validate-request';
import { TripIdParamsSchema, SwipeRequestSchema } from '@/lib/validation/api-schemas';

export async function POST(request: NextRequest, { params }) {
  try {
    const { tripId } = await validateParams(params, TripIdParamsSchema);
    const body = await validateBody(request, SwipeRequestSchema);
    // body is now typed and validated
  } catch (error) {
    if (error instanceof NextResponse) return error;
    // handle error
  }
}
```

### Validation Features

- **Strict mode**: Unknown fields are rejected
- **Type safety**: Validated data is fully typed
- **Error messages**: Clear validation error messages returned to client

## Rate Limiting

### Implementation

Rate limiting uses an in-memory limiter (`lib/rate-limit/in-memory-limiter.ts`). For multi-instance deployments, upgrade to Redis-based limiter.

### Rate Limits

| Endpoint Type | Per Minute | Per Hour |
|--------------|------------|----------|
| AI Endpoints | 10 | 100 |
| Places Endpoints | 30 | 500 |
| Assistant/Chat | 20 | 200 |

### Protected Endpoints

- `/api/trips/[tripId]/assistant`
- `/api/trips/[tripId]/itinerary-chat`
- `/api/ai-itinerary`
- `/api/ai/plan-day`
- `/api/places/autocomplete`
- `/api/places/city-autocomplete`

### Rate Limit Headers

Responses include rate limit headers:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in window
- `X-RateLimit-Reset`: Unix timestamp when limit resets
- `Retry-After`: Seconds to wait before retrying (429 responses)

## Row-Level Security (RLS)

### Current Strategy

**RLS is enabled** on all public tables exposed to PostgREST: `trips`, `trip_members`, `expenses`, `expense_shares`, `smart_itineraries` (see migration `database/migrations/enable-rls-on-exposed-tables.sql`). Policies are permissive (`USING (true) WITH CHECK (true)`) because Kruno uses Clerk (not Supabase Auth). **All authorization happens in the application layer.**

### Why This Approach?

- Clerk user IDs are stored in `profiles.clerk_user_id` (not Supabase Auth)
- RLS `auth.uid()` doesn't work with Clerk
- Application-layer checks provide more flexibility

### Security Responsibility

**Critical**: With permissive RLS, all API routes MUST verify:
1. User authentication (via `requireAuth()`)
2. Trip access (via `requireTripAccess()` or `requireTripOwner()`)
3. Pro status (via `requirePro()` or `requireTripPro()`)

### Residual Risk and Guardrails

- Any direct Supabase client access (e.g. from a future script or server) that bypasses API routes is not restricted by RLS; use the service role only where necessary and audit access.
- Future option: migrate to restrictive RLS using Clerk JWT claims or a custom RLS function.

### Future Considerations

- Consider using Supabase service role key restrictions
- Monitor for any direct database access bypassing API routes
- Optionally migrate to restrictive RLS with Clerk JWT integration

## XSS Protection

### Sanitization

User-generated content is sanitized using DOMPurify:

- **`sanitizeHtml()`**: Sanitizes HTML content
- **`escapeHtml()`**: Escapes HTML entities for plain text
- **`sanitizeUserContent()`**: Sanitizes notes/descriptions
- **`sanitizeChatMessage()`**: Sanitizes chat messages (more restrictive)

### Sanitized Content

- Trip notes
- Activity notes
- Activity descriptions
- Chat messages
- User-generated text fields

### Allowed HTML Tags

For user content:
- `p`, `br`, `strong`, `em`, `u`, `b`, `i`
- `ul`, `ol`, `li`
- `h1`-`h6`
- `a` (with href, title, target, rel)
- `blockquote`, `code`, `pre`

For chat messages (more restrictive):
- `p`, `br`, `strong`, `em` only

## Secrets Management

### Environment Variables

**Server-Only Secrets** (never exposed to client):
- `OPENAI_API_KEY`: OpenAI API key
- `GOOGLE_MAPS_API_KEY`: Google Maps API key (server-side usage)
- `CLERK_SECRET_KEY`: Clerk secret key
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key

**Public Keys** (exposed to client):
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: Google Maps API key for client-side maps
  - **Important**: Configure domain and API restrictions in Google Cloud Console
  - Restrict to your domain(s)
  - Restrict to specific APIs (Places API, Maps JavaScript API)

### Best Practices

1. Never use `NEXT_PUBLIC_` prefix for sensitive keys
2. Document API key restrictions in Google Cloud Console
3. Rotate keys regularly
4. Use environment-specific keys (dev/staging/prod)

## CSRF Protection

### Clerk CSRF Protection

Clerk handles CSRF protection via:
- Same-site cookies
- CSRF tokens in requests
- Origin validation

### Additional Measures

- All state-changing operations require authentication
- API routes validate request origin (handled by Clerk)
- No GET requests modify data

## Security Verification Checklist (PR / audits)

Use this when adding or changing API routes or auth:

- [ ] RLS is enabled on any new public tables (and policies documented).
- [ ] Trip-scoped routes call `requireTripAccess(tripId)` or `requireTripOwner(tripId)` before any DB read/write.
- [ ] No raw `error.message` or internal details returned to the client (log only; return generic messages).
- [ ] Debug/test routes return 404 in production (or are removed).
- [ ] Expensive or AI routes use rate limiting (`checkRateLimit` with appropriate type).
- [ ] Inputs validated with Zod schemas and `validateParams` / `validateBody` / `validateQuery`.
- [ ] No server-only secrets in `NEXT_PUBLIC_*` or in committed docs (use placeholders).

## Security Checklist

### For New API Routes

- [ ] Use `requireAuth()` or trip access helpers
- [ ] Validate all inputs with Zod schemas
- [ ] Apply rate limiting for expensive operations
- [ ] Sanitize user-generated content before storing
- [ ] Return appropriate error responses (401, 403, 404, 429)
- [ ] Log security-relevant events

### For Pro Features

- [ ] Use `requirePro()` or `requireTripPro()` server-side
- [ ] Never rely on client-side Pro checks
- [ ] Verify Pro status on every request
- [ ] Return clear error messages for Pro-required features

### For Trip Operations

- [ ] Use `requireTripAccess()` for read operations
- [ ] Use `requireTripOwner()` for write/delete operations
- [ ] Verify trip exists before operations
- [ ] Check trip membership for shared trips

## Monitoring & Logging

### Security Events Logged

- Authentication failures
- Authorization failures (403)
- Rate limit violations (429)
- Validation errors (400)
- Pro status checks
- Trip access checks

### Log Format

```typescript
console.error('[API Name]', {
  path: '/api/...',
  method: 'POST',
  error: 'Error message',
  userId: 'user_...',
  tripId: 'uuid',
  // ... other context
});
```

## Incident Response

### If Security Issue Detected

1. **Immediate**: Disable affected endpoint/feature
2. **Investigate**: Review logs, identify scope
3. **Fix**: Implement proper security controls
4. **Verify**: Test fix thoroughly
5. **Monitor**: Watch for similar issues
6. **Document**: Update this document with lessons learned

## Future Improvements

1. **Redis Rate Limiting**: Upgrade from in-memory to Redis for multi-instance support
2. **Request Signing**: Add request signing for critical operations
3. **IP Allowlisting**: For admin operations
4. **Audit Logging**: Comprehensive audit trail for all operations
5. **Penetration Testing**: Regular security audits
6. **Dependency Scanning**: Automated vulnerability scanning

## Recent Changes (March 2025 – RLS and security pass)

### Added
- **RLS enabled** on `trips`, `trip_members`, `expenses`, `expense_shares`, `smart_itineraries` via `database/migrations/enable-rls-on-exposed-tables.sql` (Supabase advisor alerts resolved).
- **Authorization on all trip data paths**: `requireTripAccess()` or `requireTripOwner()` added to `ai/plan-day`, `accommodation/find`, `ai-itinerary`, and `images/cache-place-image` (IDOR fixes).
- **Rate limiting** on `ai-itinerary`, `ai/plan-day`, and `itinerary-chat` (in addition to existing assistant/places).
- **Security verification checklist** section for PR/audit use.

### Changed
- **Debug and test routes** (`/api/debug/*`, `/api/test/*`) return 404 in production.
- **Error responses**: Removed leakage of `error.message` / internal details in itinerary-chat and test/welcome-email; generic messages returned to clients.
- **Docs**: README env example uses placeholders instead of real Supabase URL/anon key.

## Recent Changes (January 2025)

### Added
- **Centralized Auth Helpers** (`lib/auth/`):
  - `requireAuth()` - Ensures user is authenticated
  - `requirePro()` - Ensures account-level Pro subscription
  - `requireTripAccess()` - Ensures user has access to trip (owner or member)
  - `requireTripOwner()` - Ensures user owns the trip
  - `requireTripPro()` - Ensures user has Pro (account or trip-level)
- **Input Validation System** (`lib/validation/`):
  - Zod schemas for all API route inputs (`api-schemas.ts`)
  - Validation helpers: `validateBody()`, `validateQuery()`, `validateParams()`
  - Strict mode: Unknown fields are rejected
  - Type-safe validated data
- **Rate Limiting System** (`lib/rate-limit/`):
  - In-memory rate limiter (`in-memory-limiter.ts`)
  - Rate limit middleware (`rate-limit-middleware.ts`)
  - Protected endpoints: AI (10/min, 100/hour), Places (30/min, 500/hour), Assistant/Chat (20/min, 200/hour)
  - Rate limit headers in responses
- **XSS Protection**:
  - DOMPurify sanitization for user-generated content
  - Sanitization functions: `sanitizeHtml()`, `escapeHtml()`, `sanitizeUserContent()`, `sanitizeChatMessage()`

### Changed
- **Middleware Security**: Middleware now fails securely (returns 401) instead of allowing requests through on auth errors
- **All API Routes**: Now use centralized auth helpers and Zod validation for consistency

### Removed
- None (no security features removed in this update)

## References

- [Clerk Security Best Practices](https://clerk.com/docs/security)
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Next.js Security Headers](https://nextjs.org/docs/app/api-reference/next-config-js/headers)
