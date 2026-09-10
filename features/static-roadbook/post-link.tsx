'use client';
import { ExternalLink } from 'lucide-react';
import { useMobilePlatform } from '@/lib/use-mobile-platform';
import { xiaohongshuLinks } from '@/lib/xiaohongshu-links';
import type { PlacePost } from './posts';

export function PostLink({ post }: { post: PlacePost }) {
  const platform = useMobilePlatform();
  const links = xiaohongshuLinks(post.url, post.id);
  return (
    <a
      href={platform === 'desktop' ? links.web : links.app}
      target={platform === 'desktop' ? '_blank' : '_self'}
      rel="noopener noreferrer"
      aria-label={`${post.title} · 打开小红书`}
    >
      <div>
        <span className="post-platform">小红书</span>
        <strong>{post.title}</strong>
        <small>
          {[post.dateLabel, ...post.tags].filter(Boolean).join(' · ')}
        </small>
      </div>
      <ExternalLink aria-hidden="true" />
    </a>
  );
}
