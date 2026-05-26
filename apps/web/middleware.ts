import { type NextRequest, NextResponse } from 'next/server';

const PROTECTED = ['/me', '/studio'];

export function middleware(request: NextRequest): NextResponse {
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get('access_token')?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/me', '/studio/:path*'],
};
