'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../src/lib/api';
import { isAuthenticated, getUser } from '../../../src/lib/auth';
import type { Video } from '../../../src/types/api';

type AccessMode = Video['access_mode'];
type UploadState =
  | 'idle'
  | 'creating'
  | 'uploading'
  | 'complete-upload'
  | 'processing'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'failed';

export default function UploadPage() {
  const router = useRouter();

  // Auth check
  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/sign-in');
      return;
    }
    const user = getUser();
    if (user && user.role !== 'creator' && user.role !== 'admin') {
      router.push('/');
    }
  }, [router]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [accessMode, setAccessMode] = useState<AccessMode>('free');
  const [ppvPrice, setPpvPrice] = useState('');
  const [ppvCurrency, setPpvCurrency] = useState('USD');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function cleanup() {
    if (pollRef.current) clearInterval(pollRef.current);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!file) {
      setError('Please select a video file.');
      return;
    }
    if (
      (accessMode === 'ppv' || accessMode === 'premium_buyable') &&
      (!ppvPrice || isNaN(parseFloat(ppvPrice)) || parseFloat(ppvPrice) <= 0)
    ) {
      setError('Please enter a valid price.');
      return;
    }

    setUploadState('creating');
    try {
      // Step 1: Create video
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        access_mode: accessMode,
      };
      if (accessMode === 'ppv' || accessMode === 'premium_buyable') {
        body.ppv_price_minor_units = Math.round(parseFloat(ppvPrice) * 100);
        body.ppv_price_currency = ppvCurrency;
      }

      const createRes = await api.post<{
        video_id: string;
        upload_url?: string;
        presigned_url?: string;
      }>('/videos', body);

      const vid = createRes.video_id;
      setVideoId(vid);

      const uploadUrl = createRes.upload_url ?? createRes.presigned_url;
      if (!uploadUrl) {
        throw new Error('No upload URL returned from server.');
      }

      // Step 2: Upload file via PUT (no auth header for presigned URLs)
      setUploadState('uploading');
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
        xhr.upload.addEventListener('progress', (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.send(file);
      });

      // Step 3: Complete upload
      setUploadState('complete-upload');
      await api.post(`/videos/${vid}/complete-upload`, {});

      // Step 4: Poll for state
      setUploadState('processing');
      pollRef.current = setInterval(async () => {
        try {
          const video = await api.get<Video>(`/videos/${vid}`);
          if (video.state === 'ready') {
            cleanup();
            setUploadState('ready');
          } else if (video.state === 'failed') {
            cleanup();
            setUploadState('failed');
            setError('Transcoding failed. Please try again.');
          }
        } catch {
          // ignore transient errors
        }
      }, 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setUploadState('failed');
    }
  }

  async function handlePublish() {
    if (!videoId) return;
    setUploadState('publishing');
    try {
      await api.post(`/videos/${videoId}/publish`);
      setUploadState('published');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Publish failed. Please try again.');
      setUploadState('ready');
    }
  }

  // Cleanup on unmount
  useEffect(() => cleanup, []);

  const isLoading = [
    'creating',
    'uploading',
    'complete-upload',
    'processing',
    'publishing',
  ].includes(uploadState);

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Upload Video</h1>

      {uploadState === 'published' && videoId ? (
        <div className="bg-[#16213e] rounded-xl border border-green-700/30 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-900/30 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Video published!</h2>
          <p className="text-gray-400 text-sm mb-6">Your video is now live on the platform.</p>
          <div className="flex gap-3 justify-center">
            <a
              href={`/v/${videoId}`}
              className="bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-2.5 px-6 rounded-lg transition"
            >
              View video
            </a>
            <button
              onClick={() => {
                setUploadState('idle');
                setTitle('');
                setDescription('');
                setFile(null);
                setVideoId(null);
                setUploadProgress(0);
                setError(null);
              }}
              className="bg-[#16213e] hover:bg-[#1a2744] text-gray-300 font-semibold py-2.5 px-6 rounded-lg transition border border-gray-700"
            >
              Upload another
            </button>
          </div>
        </div>
      ) : uploadState === 'ready' ? (
        <div className="bg-[#16213e] rounded-xl border border-[#1a1a2e]/50 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-blue-900/30 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Transcoding complete!</h2>
          <p className="text-gray-400 text-sm mb-6">
            Your video is ready. Publish it to make it visible to viewers.
          </p>
          <button
            onClick={() => void handlePublish()}
            className="bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-3 px-8 rounded-lg transition"
          >
            Publish video
          </button>
        </div>
      ) : (
        <div className="bg-[#16213e] rounded-xl border border-[#1a1a2e]/50 p-6">
          {/* Processing indicator */}
          {uploadState === 'processing' && (
            <div className="mb-6 bg-blue-900/20 border border-blue-700/30 rounded-lg px-4 py-4 text-center">
              <div className="flex items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-blue-300 font-medium">
                  Transcoding your video... this may take a few minutes.
                </p>
              </div>
            </div>
          )}

          {/* Upload progress */}
          {uploadState === 'uploading' && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Uploading...</span>
                <span className="text-sm font-mono text-white">{uploadProgress}%</span>
              </div>
              <div className="h-2 bg-[#0f0f23] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#e94560] rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter video title"
                disabled={isLoading}
                className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-4 py-2.5 w-full focus:outline-none focus:border-[#e94560] transition disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your video..."
                rows={4}
                disabled={isLoading}
                className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-4 py-2.5 w-full focus:outline-none focus:border-[#e94560] transition disabled:opacity-50 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Access mode</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(['free', 'ppv', 'premium', 'premium_buyable'] as AccessMode[]).map((mode) => (
                  <label
                    key={mode}
                    className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition ${
                      accessMode === mode
                        ? 'border-[#e94560] bg-[#e94560]/10'
                        : 'border-gray-700 bg-[#0f0f23] hover:border-gray-500'
                    } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <input
                      type="radio"
                      name="access_mode"
                      value={mode}
                      checked={accessMode === mode}
                      onChange={() => setAccessMode(mode)}
                      className="accent-[#e94560]"
                    />
                    <span className="text-sm text-gray-300 capitalize">
                      {mode.replace(/_/g, ' ')}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {(accessMode === 'ppv' || accessMode === 'premium_buyable') && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Price</label>
                <div className="flex gap-3">
                  <input
                    type="number"
                    value={ppvPrice}
                    onChange={(e) => setPpvPrice(e.target.value)}
                    placeholder="0.50"
                    min="0.10"
                    max="2.00"
                    step="0.01"
                    disabled={isLoading}
                    className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-4 py-2.5 flex-1 focus:outline-none focus:border-[#e94560] transition disabled:opacity-50"
                  />
                  <select
                    value={ppvCurrency}
                    onChange={(e) => setPpvCurrency(e.target.value)}
                    disabled={isLoading}
                    className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#e94560] transition disabled:opacity-50"
                  >
                    <option value="USD">USD</option>
                    <option value="ZWG">ZWG</option>
                    <option value="ZAR">ZAR</option>
                  </select>
                </div>
                <p className="mt-1 text-xs text-gray-600">
                  Price range: $0.10 – $2.00 (or equivalent)
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Video file <span className="text-red-400">*</span>
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                  file
                    ? 'border-[#e94560]/50 bg-[#e94560]/5'
                    : 'border-gray-700 hover:border-gray-500 bg-[#0f0f23]'
                } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setFile(f);
                  }}
                  disabled={isLoading}
                />
                {file ? (
                  <div>
                    <div className="w-10 h-10 rounded-full bg-[#e94560]/20 flex items-center justify-center mx-auto mb-2">
                      <svg
                        className="w-5 h-5 text-[#e94560]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <p className="text-white font-medium text-sm">{file.name}</p>
                    <p className="text-gray-500 text-xs mt-1">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="w-10 h-10 rounded-full bg-gray-700/50 flex items-center justify-center mx-auto mb-2">
                      <svg
                        className="w-5 h-5 text-gray-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                        />
                      </svg>
                    </div>
                    <p className="text-gray-400 text-sm">Click to select a video file</p>
                    <p className="text-gray-600 text-xs mt-1">
                      MP4, MOV, AVI and other formats supported
                    </p>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {uploadState === 'creating' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating...
                </>
              ) : uploadState === 'uploading' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Uploading {uploadProgress}%...
                </>
              ) : uploadState === 'complete-upload' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Finalizing...
                </>
              ) : (
                'Upload video'
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
