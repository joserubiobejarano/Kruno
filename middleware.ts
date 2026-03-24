import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const CITY_ROUTE_PREFIX = '/cities'

type SupportedLocale = 'en' | 'es'

function getPreferredLocale(acceptLanguage: string | null): SupportedLocale {
  if (!acceptLanguage) {
    return 'en'
  }

  const entries = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [langRange, ...params] = part.trim().split(';').map((value) => value.trim())
      if (!langRange) {
        return null
      }
      const qParam = params.find((param) => param.startsWith('q='))
      const qValue = qParam ? Number.parseFloat(qParam.slice(2)) : 1
      return {
        lang: langRange.toLowerCase(),
        q: Number.isNaN(qValue) ? 1 : qValue,
        index,
      }
    })
    .filter((entry): entry is { lang: string; q: number; index: number } => Boolean(entry))

  if (entries.length === 0) {
    return 'en'
  }

  entries.sort((a, b) => b.q - a.q || a.index - b.index)
  const primary = entries[0].lang.split('-')[0]
  return primary === 'es' ? 'es' : 'en'
}

const isPublicRoute = createRouteMatcher([
  '/',
  // Localized marketing (must match middleware.config.matcher so auth() works on these pages)
  '/en(.*)',
  '/es(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/p(.*)',
  '/discover-kruno(.*)',
  '/discover(.*)',
  '/api/public(.*)',
  '/api/newsletter/subscribe(.*)',
  '/api/newsletter/confirm(.*)',
  '/api/newsletter/unsubscribe(.*)',
  '/api/webhooks/clerk(.*)',
  '/api/debug(.*)',
  '/api/wikimedia(.*)',
])

const isProtectedRoute = createRouteMatcher([
  '/trips(.*)',
  '/settings(.*)',
  '/my-trips(.*)',
  '/mytrips(.*)',
  '/api/trips(.*)',
  '/api/user(.*)',
  '/api/billing(.*)',
])

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl
  if (pathname === '/') {
    return NextResponse.next()
  }
  if (pathname === CITY_ROUTE_PREFIX || pathname.startsWith(`${CITY_ROUTE_PREFIX}/`)) {
    const locale = getPreferredLocale(request.headers.get('accept-language'))
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}${pathname}`
    return NextResponse.redirect(url, 308)
  }

  if (isPublicRoute(request)) {
    return NextResponse.next()
  }

  // Only protect routes that are explicitly protected
  if (isProtectedRoute(request)) {
    const isApiRoute = pathname.startsWith('/api/')
    
    if (isApiRoute) {
      // For API routes, the middleware just needs to run so Clerk can detect clerkMiddleware()
      // API routes handle their own authentication logic via auth() calls in route handlers
      // We don't call auth.protect() here to allow API routes to handle errors themselves
      // The middleware running is sufficient for Clerk to set up the auth context
    } else {
      // For page routes, use protect() to enforce authentication
      try {
        await auth.protect()
      } catch (error) {
        // Fail securely: return 401 instead of allowing unauthorized access
        console.error('Clerk middleware auth error:', error)
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }
    }
  }
  
  return NextResponse.next()
})

export const config = {
  matcher: [
    '/',
    '/en(.*)',
    '/es(.*)',
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/trips(.*)',
    '/settings(.*)',
    '/my-trips(.*)',
    '/mytrips(.*)',
    '/api/trips(.*)',
    '/api/user(.*)',
    '/api/billing(.*)',
  ],
}

