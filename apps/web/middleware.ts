import { type NextRequest, NextResponse } from 'next/server';

const PROTECTED = ['/me', '/studio'];

export function middleware(request: NextRequest): NextResponse {
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // The access cookie lives 15 minutes; a refresh token means the client can renew it, so
  // only send people to sign-in when they hold neither.
  const signedIn =
    request.cookies.get('access_token')?.value || request.cookies.get('refresh_token')?.value;
  if (!signedIn) {
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
