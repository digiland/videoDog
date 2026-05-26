'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../src/lib/api';
import type { Video } from '../../../src/types/api';
import { formatDuration, formatMoney } from '../../../src/lib/format';

const STATE_COLORS: Record<Video['state'], string> = {
  uploading: 'bg-blue-900/60 text-blue-300',
  processing: 'bg-yellow-900/60 text-yellow-300',
  ready: 'bg-green-900/60 text-green-300',
  published: 'bg-emerald-900/60 text-emerald-300',
  unpublished: 'bg-gray-900/60 text-gray-400',
  failed: 'bg-red-900/60 text-red-300',
};

export default function StudioVideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    title: string;
    description: string;
    access_mode: Video['access_mode'];
    ppv_price: string;
    ppv_currency: string;
  }>({
    title: '',
    description: '',
    access_mode: 'free',
    ppv_price: '',
    ppv_currency: 'USD',
  });

  useEffect(() => {
    void loadVideos();
  }, []);

  async function loadVideos() {
    setLoading(true);
    try {
      const data = await api.get<{ items: Video[]; next_cursor: string | null } | Video[]>(
        '/videos?creator=me&limit=50',
      );
      if (Array.isArray(data)) {
        setVideos(data);
      } else {
        setVideos(data.items);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handlePublish(id: string) {
    setActionLoading(id);
    try {
      await api.post(`/videos/${id}/publish`);
      await loadVideos();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnpublish(id: string) {
    setActionLoading(id);
    try {
      await api.post(`/videos/${id}/unpublish`);
      await loadVideos();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }

  function startEdit(video: Video) {
    setEditingId(video.id);
    setEditForm({
      title: video.title,
      description: video.description ?? '',
      access_mode: video.access_mode,
      ppv_price: video.ppv_price_minor_units
        ? String(Number(video.ppv_price_minor_units) / 100)
        : '',
      ppv_currency: video.ppv_price_currency ?? 'USD',
    });
  }

  async function handleSaveEdit(id: string) {
    setActionLoading(id);
    try {
      const body: Record<string, unknown> = {
        title: editForm.title,
        description: editForm.description || null,
        access_mode: editForm.access_mode,
      };
      if (editForm.access_mode === 'ppv' || editForm.access_mode === 'premium_buyable') {
        body.ppv_price_minor_units = Math.round(parseFloat(editForm.ppv_price) * 100);
        body.ppv_price_currency = editForm.ppv_currency;
      }
      await api.patch(`/videos/${id}`, body);
      setEditingId(null);
      await loadVideos();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#e94560] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">My Videos</h1>
        <a
          href="/studio/upload"
          className="bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-2 px-4 rounded-lg transition text-sm"
        >
          Upload new
        </a>
      </div>

      {videos.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500">No videos yet. Upload your first one!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {videos.map((video) => (
            <div
              key={video.id}
              className="bg-[#16213e] rounded-xl border border-[#1a1a2e]/50 overflow-hidden"
            >
              {editingId === video.id ? (
                /* Edit form */
                <div className="p-4 space-y-3">
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 w-full focus:outline-none focus:border-[#e94560] transition"
                    placeholder="Title"
                  />
                  <textarea
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        description: e.target.value,
                      }))
                    }
                    className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 w-full focus:outline-none focus:border-[#e94560] transition resize-none"
                    placeholder="Description"
                    rows={3}
                  />
                  <div className="flex gap-3 flex-wrap">
                    <select
                      value={editForm.access_mode}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          access_mode: e.target.value as Video['access_mode'],
                        }))
                      }
                      className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-[#e94560] transition"
                    >
                      <option value="free">Free</option>
                      <option value="ppv">PPV</option>
                      <option value="premium">Premium</option>
                      <option value="premium_buyable">Premium + Buyable</option>
                    </select>
                    {(editForm.access_mode === 'ppv' ||
                      editForm.access_mode === 'premium_buyable') && (
                      <>
                        <input
                          type="number"
                          value={editForm.ppv_price}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              ppv_price: e.target.value,
                            }))
                          }
                          placeholder="Price"
                          min="0"
                          step="0.01"
                          className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 w-28 focus:outline-none focus:border-[#e94560] transition"
                        />
                        <select
                          value={editForm.ppv_currency}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              ppv_currency: e.target.value,
                            }))
                          }
                          className="bg-[#0f0f23] border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-[#e94560] transition"
                        >
                          <option value="USD">USD</option>
                          <option value="ZWG">ZWG</option>
                          <option value="ZAR">ZAR</option>
                        </select>
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleSaveEdit(video.id)}
                      disabled={actionLoading === video.id}
                      className="bg-[#e94560] hover:bg-[#c73652] text-white font-semibold py-2 px-4 rounded-lg transition text-sm disabled:opacity-50"
                    >
                      {actionLoading === video.id ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="bg-[#0f0f23] hover:bg-[#1a2744] text-gray-400 font-semibold py-2 px-4 rounded-lg transition text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* View row */
                <div className="flex items-center gap-3 p-3">
                  {/* Thumbnail */}
                  <div className="w-16 h-10 rounded bg-gray-800 shrink-0 overflow-hidden">
                    {video.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={video.thumbnail_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg
                          className="w-5 h-5 text-gray-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M4 6h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z"
                          />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{video.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_COLORS[video.state]}`}
                      >
                        {video.state}
                      </span>
                      <span className="text-xs text-gray-500 capitalize">
                        {video.access_mode.replace(/_/g, ' ')}
                      </span>
                      {video.ppv_price_minor_units && video.ppv_price_currency && (
                        <span className="text-xs text-yellow-400">
                          {formatMoney(video.ppv_price_minor_units, video.ppv_price_currency)}
                        </span>
                      )}
                      {video.duration_seconds != null && (
                        <span className="text-xs text-gray-600">
                          {formatDuration(video.duration_seconds)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => startEdit(video)}
                      className="text-xs text-gray-400 hover:text-white bg-[#0f0f23] hover:bg-[#1a2744] px-3 py-1.5 rounded-lg transition"
                    >
                      Edit
                    </button>
                    {video.state === 'ready' || video.state === 'unpublished' ? (
                      <button
                        onClick={() => void handlePublish(video.id)}
                        disabled={actionLoading === video.id}
                        className="text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-900/30 hover:bg-emerald-900/50 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        Publish
                      </button>
                    ) : video.state === 'published' ? (
                      <button
                        onClick={() => void handleUnpublish(video.id)}
                        disabled={actionLoading === video.id}
                        className="text-xs text-gray-400 hover:text-white bg-[#0f0f23] hover:bg-[#1a2744] px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        Unpublish
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
