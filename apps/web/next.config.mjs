/** @type {import('next').NextConfig} */
const nextConfig = {
  // All dashboard pages are server-side by default (App Router).
  // No client-side data fetching of sensitive fields -- all queries
  // go through server components or server actions where RLS applies.
}

export default nextConfig
