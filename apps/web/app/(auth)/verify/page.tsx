'use client';
import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setTokens } from '../../../src/lib/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

const CODE_LENGTH = 6;

export default function VerifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') ?? '';
  const [digits, setDigits] = useState<string[]>(Array<string>(CODE_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>(Array<null>(CODE_LENGTH).fill(null));

  function handleDigitChange(index: number, value: string) {
    const char = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    setError(null);

    if (char && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all filled
    if (char && index === CODE_LENGTH - 1) {
      const code = [...next.slice(0, CODE_LENGTH - 1), char].join('');
      if (code.length === CODE_LENGTH) {
        void submitCode(code);
      }
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    const next = [...digits];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i] ?? '';
    }
    setDigits(next);
    if (pasted.length === CODE_LENGTH) {
      void submitCode(pasted);
    } else {
      inputRefs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
    }
  }

  async function submitCode(code: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(body.message ?? 'Invalid code. Please try again.');
        setDigits(Array<string>(CODE_LENGTH).fill(''));
        inputRefs.current[0]?.focus();
        return;
      }
      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
      };
      setTokens(data.access_token, data.refresh_token);
      router.push('/');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendLoading(true);
    setResendSent(false);
    try {
      await fetch(`${API_BASE}/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      setResendSent(true);
    } catch {
      // ignore
    } finally {
      setResendLoading(false);
    }
  }

  const code = digits.join('');

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-4xl font-bold">
            <span className="text-[#e94560]">Stream</span>ZW
          </span>
          <p className="mt-3 text-white font-semibold text-lg">Enter verification code</p>
          <p className="mt-1 text-gray-400 text-sm">
            Sent to <span className="font-mono text-gray-300">{phone || 'your phone'}</span>
          </p>
        </div>

        <div className="bg-[#16213e] rounded-2xl border border-[#1a1a2e]/50 p-6">
          {/* Digit inputs */}
          <div className="flex gap-3 justify-center mb-6" onPaste={handlePaste}>
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                disabled={loading}
                className="w-12 h-14 text-center text-xl font-bold bg-[#0f0f23] border border-gray-700 text-white rounded-xl focus:outline-none focus:border-[#e94560] transition disabled:opacity-50"
              />
            ))}
          </div>

          {error && (
            <div className="mb-4 bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300 text-center">
              {error}
            </div>
          )}

          <button
            onClick={() => code.length === CODE_LENGTH && void submitCode(code)}
            disabled={code.length < CODE_LENGTH || loading}
            className="w-full bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify'
            )}
          </button>

          <div className="mt-4 text-center">
            {resendSent ? (
              <p className="text-green-400 text-sm">Code resent!</p>
            ) : (
              <button
                onClick={() => void handleResend()}
                disabled={resendLoading}
                className="text-sm text-gray-400 hover:text-[#e94560] transition disabled:opacity-50"
              >
                {resendLoading ? 'Sending...' : "Didn't receive a code? Resend"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
