import { signIn } from '@/lib/auth';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';

async function loginAction(formData: FormData) {
  'use server';
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: '/',
    });
  } catch (err) {
    if (err instanceof AuthError) {
      redirect('/login?error=invalid');
    }
    throw err;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const hasError = params.error === 'invalid';

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
          <div className="flex flex-col items-center mb-8">
            <Image
              src="/logo-jt.png"
              alt="JT Advocacia Médica"
              width={120}
              height={120}
              className="mb-4"
              priority
            />
            <h1 className="text-xl font-semibold text-slate-900">Dashboard JT</h1>
            <p className="text-sm text-slate-500 mt-1">Atribuição Meta Ads</p>
          </div>

          <form action={loginAction} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Email
              </label>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Senha
              </label>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 outline-none text-sm"
              />
            </div>

            {hasError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                Email ou senha inválidos
              </p>
            )}

            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
            >
              Entrar
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">JT Advocacia Médica</p>
      </div>
    </main>
  );
}
