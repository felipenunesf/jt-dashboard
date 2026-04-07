import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7, // 7 dias
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

        if (!adminEmail || !adminPasswordHash) {
          console.error('[auth] ADMIN_EMAIL or ADMIN_PASSWORD_HASH not set');
          return null;
        }

        if (email.toLowerCase() !== adminEmail.toLowerCase()) return null;

        const ok = await bcrypt.compare(password, adminPasswordHash);
        if (!ok) return null;

        return {
          id: 'admin',
          email: adminEmail,
          name: 'Admin',
        };
      },
    }),
  ],
  callbacks: {
    async authorized({ auth: session, request }) {
      const isLoggedIn = !!session;
      const isLoginPage = request.nextUrl.pathname.startsWith('/login');
      const isApiAuth = request.nextUrl.pathname.startsWith('/api/auth');

      if (isLoginPage || isApiAuth) return true;
      return isLoggedIn;
    },
  },
});
