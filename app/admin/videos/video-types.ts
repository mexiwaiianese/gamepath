import type { Readiness, VideoAsset } from '@/lib/admin-video';

export type TaggerState = 'running' | 'stuck' | 'stopped';
export type TaggerStatus = { id: string; state: TaggerState; running: boolean; url: string; owned: boolean; asset: string | null; review: string | null; log: string };
export type Video = VideoAsset & { fileExists: boolean; readiness: Readiness };
export type TaggerAction = 'start' | 'stop' | 'force-stop';
