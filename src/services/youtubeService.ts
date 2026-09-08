import { env } from "./env";

const BASE_URL = "https://www.googleapis.com/youtube/v3";
const RECENT_WINDOW_DAYS = 30;
const FALLBACK_VIDEO_COUNT = 10;

export interface ChannelInfo {
  channelId: string;
  title: string;
  handle?: string;
  uploadsPlaylistId: string;
}

export interface ChannelVideo {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  publishedAt: string;
  thumbnailUrl: string;
}

export interface ChannelVideosResult {
  videos: ChannelVideo[];
  usedFallback: boolean;
}

export interface ParsedChannelInput {
  forHandle?: string;
  id?: string;
  forUsername?: string;
}

export interface PlaylistItemRef {
  videoId: string;
  publishedAt: string;
}

export function parseChannelInput(input: string): ParsedChannelInput {
  const trimmed = input.trim();

  const handleMatch = trimmed.match(/(?:youtube\.com\/)?@([\w.-]+)/i);
  if (handleMatch) {
    return { forHandle: handleMatch[1] };
  }

  const channelIdMatch = trimmed.match(/(?:youtube\.com\/channel\/)?(UC[\w-]{22})/);
  if (channelIdMatch) {
    return { id: channelIdMatch[1] };
  }

  const userMatch = trimmed.match(/youtube\.com\/user\/([\w-]+)/i);
  if (userMatch) {
    return { forUsername: userMatch[1] };
  }

  const customMatch = trimmed.match(/youtube\.com\/c\/([\w-]+)/i);
  if (customMatch) {
    return { forUsername: customMatch[1] };
  }

  return { forUsername: trimmed };
}

export function selectVideosForAnalysis(
  items: PlaylistItemRef[],
  now: Date,
): { selected: PlaylistItemRef[]; usedFallback: boolean } {
  const cutoff = new Date(now.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recent = items.filter((item) => new Date(item.publishedAt) >= cutoff);

  if (recent.length > 0) {
    return { selected: recent, usedFallback: false };
  }
  return { selected: items.slice(0, FALLBACK_VIDEO_COUNT), usedFallback: true };
}

async function fetchChannelInfo(parsed: ParsedChannelInput): Promise<ChannelInfo | null> {
  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    key: env.youtubeApiKey,
  });
  if (parsed.forHandle) params.set("forHandle", parsed.forHandle);
  else if (parsed.id) params.set("id", parsed.id);
  else if (parsed.forUsername) params.set("forUsername", parsed.forUsername);
  else return null;

  const res = await fetch(`${BASE_URL}/channels?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`YouTube channels.list falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items: {
      id: string;
      snippet: { title: string; customUrl?: string };
      contentDetails: { relatedPlaylists: { uploads: string } };
    }[];
  };
  const item = data.items[0];
  if (!item) return null;

  return {
    channelId: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

async function searchChannelIdByName(name: string): Promise<string | null> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "channel",
    q: name,
    maxResults: "1",
    key: env.youtubeApiKey,
  });
  const res = await fetch(`${BASE_URL}/search?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`YouTube search.list falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { items: { snippet: { channelId: string } }[] };
  return data.items[0]?.snippet.channelId ?? null;
}

export async function resolveChannel(input: string): Promise<ChannelInfo> {
  const parsed = parseChannelInput(input);

  let info = await fetchChannelInfo(parsed);
  if (!info && parsed.forUsername) {
    const channelId = await searchChannelIdByName(parsed.forUsername);
    if (channelId) {
      info = await fetchChannelInfo({ id: channelId });
    }
  }

  if (!info) {
    throw new Error(`No se encontró el canal de YouTube para "${input}"`);
  }
  return info;
}

async function fetchVideoDetails(videoIds: string[]): Promise<ChannelVideo[]> {
  const params = new URLSearchParams({
    part: "snippet",
    id: videoIds.join(","),
    key: env.youtubeApiKey,
  });
  const res = await fetch(`${BASE_URL}/videos?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`YouTube videos.list falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items: {
      id: string;
      snippet: {
        title: string;
        description: string;
        tags?: string[];
        publishedAt: string;
        thumbnails: { high?: { url: string }; default: { url: string } };
      };
    }[];
  };

  return data.items.map((item) => ({
    videoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    tags: item.snippet.tags ?? [],
    publishedAt: item.snippet.publishedAt,
    thumbnailUrl: item.snippet.thumbnails.high?.url ?? item.snippet.thumbnails.default.url,
  }));
}

export async function listRecentVideos(channel: ChannelInfo): Promise<ChannelVideosResult> {
  const params = new URLSearchParams({
    part: "contentDetails",
    playlistId: channel.uploadsPlaylistId,
    maxResults: "50",
    key: env.youtubeApiKey,
  });
  const res = await fetch(`${BASE_URL}/playlistItems?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`YouTube playlistItems.list falló: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items: { contentDetails: { videoId: string; videoPublishedAt: string } }[];
  };

  const refs: PlaylistItemRef[] = data.items.map((item) => ({
    videoId: item.contentDetails.videoId,
    publishedAt: item.contentDetails.videoPublishedAt,
  }));

  if (refs.length === 0) {
    throw new Error(`El canal "${channel.title}" no tiene ningún video`);
  }

  const { selected, usedFallback } = selectVideosForAnalysis(refs, new Date());
  const videos = await fetchVideoDetails(selected.map((v) => v.videoId));
  return { videos, usedFallback };
}
