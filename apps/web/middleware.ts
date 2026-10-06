import { type NextRequest, NextResponse } from 'next/server';

const PROTECTED = ['/me', '/studio'];

export function middleware(request: NextRequest): NextResponse {
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get('access_token')?.value;
  if (!token) {
    const signIn = new URL('/sign-in', request.url);
    // Path + query of this same-origin request; /sign-in re-validates it with safeReturnTo.
    signIn.searchParams.set('return_to', `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/me', '/studio/:path*'],
};
