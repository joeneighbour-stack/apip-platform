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
  // /api/analytics/warm-cache is called by a scheduled GitHub Actions job with no user
  // session at all -- it authenticates itself via a shared secret header (checked in the
  // route handler), so it must be exempted here or this redirect would block it before
  // the route ever runs.
  const isPublicPath = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname === '/api/analytics/warm-cache'
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
