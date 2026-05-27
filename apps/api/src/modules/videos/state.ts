import { InvalidStateTransitionError } from '../auth/errors';

export type VideoState =
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'published'
  | 'unpublished'
  | 'failed';

const transitions: Record<VideoState, VideoState[]> = {
  uploading: ['processing', 'ready', 'failed'],
  processing: ['ready', 'failed'],
  ready: ['published'],
  published: ['unpublished'],
  unpublished: ['published'],
  failed: [],
};

export function assertTransition(from: VideoState, to: VideoState): void {
  if (!transitions[from]?.includes(to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}
