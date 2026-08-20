import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import type { Database } from '@/types/database'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session -- must not write any logic between createServerClient
  // and this call, or sessions will not refresh correctly.
  const { data: { user } } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login, except on public routes.
  // /api/analytics/warm-cache and /api/shadow/warm-cache are called by a scheduled job with
  // no user session at all -- each authenticates itself via a shared secret header (checked
  // in the route handler), so both must be exempted here or this redirect would block them
  // before the route ever runs.
  // /forgot-password and /reset-password must be public for the same reason /login is:
  // a user hitting either one is by definition not authenticated yet. /reset-password in
  // particular is reached via the emailed recovery link with the session token in the URL
  // fragment (never sent to the server) -- the client-side Supabase SDK only exchanges it
  // for a session *after* the page loads, so this middleware's server-side getUser() check
  // would never see a session on the first request and would bounce the user to /login
  // before that exchange could ever happen.
  const isPublicPath = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/forgot-password') ||
    request.nextUrl.pathname.startsWith('/reset-password') ||
    request.nextUrl.pathname === '/api/analytics/warm-cache' ||
    request.nextUrl.pathname === '/api/shadow/warm-cache'
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
