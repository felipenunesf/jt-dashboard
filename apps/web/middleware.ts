import { auth } from '@/lib/auth';

export default auth;

export const config = {
  matcher: ['/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|logo-jt.png).*)'],
};
