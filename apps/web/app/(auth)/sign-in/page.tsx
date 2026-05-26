'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export default function SignInPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validatePhone(p: string): boolean {
    return /^\+[1-9]\d{7,14}$/.test(p.trim());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = phone.trim();
    if (!validatePhone(trimmed)) {
      setError('Enter a valid phone number in E.164 format (e.g. +263771234567)');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(body.message ?? 'Failed to send OTP. Please try again.');
        return;
      }
      router.push(`/verify?phone=${encodeURIComponent(trimmed)}`);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo mark */}
        <div className="text-center mb-8">
          <span className="text-4xl font-bold">
            <span className="text-[#e94560]">Stream</span>ZW
          </span>
          <p className="mt-2 text-gray-400 text-sm">Sign in with your phone number</p>
        </div>

        <div className="bg-[#16213e] rounded-2xl border border-[#1a1a2e]/50 p-6">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-300 mb-1.5">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError(null);
                }}
                placeholder="+263771234567"
                className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-4 py-3 w-full focus:outline-none focus:border-[#e94560] transition text-base placeholder:text-gray-600"
                autoComplete="tel"
                inputMode="tel"
                disabled={loading}
              />
              <p className="mt-1 text-xs text-gray-600">
                Include country code, e.g. +263 for Zimbabwe
              </p>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending code...
                </>
              ) : (
                'Send verification code'
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-600">
            We&apos;ll send a code via WhatsApp or SMS
          </p>
        </div>
      </div>
    </div>
  );
}
