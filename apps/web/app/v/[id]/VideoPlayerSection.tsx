'use client';
import dynamic from 'next/dynamic';

const Player = dynamic(() => import('../../components/Player'), {
  ssr: false,
  loading: () => (
    <div className="aspect-video bg-black rounded-xl flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#e94560] border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

interface VideoPlayerSectionProps {
  src: string;
  videoId: string;
}

export default function VideoPlayerSection({ src, videoId }: VideoPlayerSectionProps) {
  return <Player src={src} videoId={videoId} />;
}
