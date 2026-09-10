import content from '../../data/place-posts.json';

export type PlacePost = {
  id: string;
  title: string;
  url: string;
  tags: string[];
  dateLabel?: string;
  author?: string;
};

const placePosts: Record<string, PlacePost[]> = content;

export function postsForPlace(name: string): PlacePost[] {
  return placePosts[name] ?? [];
}
