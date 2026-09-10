'use client';
import Image from 'next/image';
import { lazy, Suspense, useEffect, useRef } from 'react';
import {
  ArrowRight,
  BookOpen,
  CarFront,
  Compass,
  MapPin,
  Navigation,
  UserRound,
  MessageCircle,
} from 'lucide-react';
import Link, { useSearchParams } from '@/lib/navigation';
import { PostLink } from './post-link';
import { useMobilePlatform } from '@/lib/use-mobile-platform';
import { dayHeading, duration, legsForDay } from '@/features/trip/selectors';
import type { Day, Stop } from '@/features/trip/types';
import {
  amapLink,
  pageUrl,
  placeBackUrl,
  roadbook,
  selectedPage,
  type View,
} from './data';
import { dayPhotos } from './photos';
import { AccountPage } from '@/features/accounts/account-page';
import { PlaceCover } from './place-cover';
import { PlaceTabs } from './place-tabs';
import { postsForPlace } from './posts';
import { RouteMap } from './route-map';

const ChatScreen = lazy(() =>
  import('@/features/agent/chat-screen').then((module) => ({
    default: module.ChatScreen,
  })),
);

function AmapLink({
  stop,
  compact = false,
}: {
  stop: Stop;
  compact?: boolean;
}) {
  const platform = useMobilePlatform();
  const link = amapLink(stop, platform);
  return (
    <a
      className="text-link"
      href={link.href}
      aria-label={compact ? `${stop.name} · ${link.label}` : undefined}
      target={link.target}
      rel="noopener noreferrer"
    >
      <Navigation />
      {compact ? (stop.lng === null ? '找地点' : '导航') : link.label}
    </a>
  );
}
function Dates({ day, view }: { day: Day; view: View }) {
  return (
    <nav className="day-tabs" aria-label="选择日期">
      {roadbook.days.map((d, i) => (
        <Link
          key={d.id}
          href={pageUrl(view, d.id)}
          aria-current={d.id === day.id ? 'date' : undefined}
        >
          <span>DAY {String(i + 1).padStart(2, '0')}</span>
          <strong>10月{Number(d.date.slice(8))}日</strong>
        </Link>
      ))}
    </nav>
  );
}
function Stops({ day }: { day: Day }) {
  const legs = legsForDay(day, roadbook.routeRecords);
  return (
    <ol className="stop-list stop-list--compact">
      {day.stops.map((stop, i) => (
        <li key={stop.id}>
          <div className="stop-row">
            <span className="stop-number">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="stop-main">
              <Link
                className="stop-title"
                href={pageUrl('place', day.id, stop.id)}
              >
                {stop.name}
                <ArrowRight />
              </Link>
              <div className="stop-summary">
                <p className="stop-meta">
                  <MapPin />
                  <span>{stop.area}</span>
                  {stop.durationMin > 0 && (
                    <span>· {duration(stop.durationMin)}</span>
                  )}
                </p>
                <AmapLink stop={stop} compact />
              </div>
            </div>
          </div>
          {i < legs.length && legs[i].record && (
            <div className="leg-row">
              <CarFront />
              <span>
                {`参考 ${legs[i].record!.distanceKm} km · ${duration(legs[i].record!.drivingMin)}`}
              </span>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
function RouteIndex({ day }: { day: Day }) {
  return (
    <div className="route-index">
      {day.stops.map((s, i) => (
        <Link key={s.id} href={pageUrl('place', day.id, s.id)}>
          <span>{i + 1}</span>
          <div>
            <strong>{s.name}</strong>
            <small>{s.area}</small>
          </div>
          <ArrowRight />
        </Link>
      ))}
    </div>
  );
}
function Daily({ day }: { day: Day }) {
  const index = roadbook.days.indexOf(day),
    photo = dayPhotos[day.id];
  return (
    <>
      <section className="trip-heading">
        <div>
          <p className="eyebrow">2026 · AUTUMN ROAD TRIP</p>
          <h1>北行，去看秋天。</h1>
        </div>
      </section>
      <Dates day={day} view="roadbook" />
      <div className="roadbook-layout">
        <section className="daily-roadbook">
          <figure className="day-figure">
            <div className="day-cover">
              <Image
                src={photo.src}
                alt={photo.alt}
                width={photo.width}
                height={photo.height}
                style={{ objectPosition: photo.position || 'center' }}
                fetchPriority="high"
                unoptimized
              />
              <span className="cover-caption">{photo.caption}</span>
              <div className="cover-title">
                <span>DAY {String(index + 1).padStart(2, '0')}</span>
                <h2>{day.subtitle}</h2>
              </div>
            </div>
            <figcaption className="photo-credit">
              <span>{photo.takenAt} 实拍</span>
              <span>摄影：{photo.author}</span>
              <a
                href={photo.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                照片来源
              </a>
              <a
                href={photo.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {photo.license}
              </a>
            </figcaption>
          </figure>
          <div className="daily-heading">
            <div>
              <p className="eyebrow">{day.date.replaceAll('-', '.')}</p>
              <h2>{dayHeading(day)}</h2>
            </div>
          </div>
          <Stops day={day} />
        </section>
        <aside className="day-aside">
          <div className="aside-heading">
            <p className="eyebrow">ON THE ROAD</p>
            <h2>今天的路线</h2>
          </div>
          <RouteIndex day={day} />
          <Link className="primary-link" href={pageUrl('route', day.id)}>
            <MapPin />
            查看六天路线
          </Link>
        </aside>
      </div>
    </>
  );
}
function RouteOverview({ day }: { day: Day }) {
  return <RouteMap day={day} />;
}
function Place({
  day,
  stop,
  backHref,
}: {
  day: Day;
  stop?: Stop;
  backHref: string;
}) {
  if (!stop)
    return (
      <div className="narrow-page">
        <h1>没有找到这个地点</h1>
        <Link className="primary-link" href={pageUrl('roadbook', day.id)}>
          回到当天路书
        </Link>
      </div>
    );
  return (
    <article className="narrow-page place-detail">
      <PlaceCover key={stop.id} name={stop.name} backHref={backHref} />
      <PlaceTabs key={stop.name} stopId={stop.id}>
        <section className="place-posts" aria-label="小红书帖子">
          {postsForPlace(stop.name).length > 0 ? (
            <div className="guide-links xhs-posts">
              {postsForPlace(stop.name).map((post) => (
                <PostLink key={post.id} post={post} />
              ))}
            </div>
          ) : (
            <p className="muted">暂无收录</p>
          )}
        </section>
      </PlaceTabs>
    </article>
  );
}
export function StaticRoadbook({
  initialView = 'roadbook',
}: {
  initialView?: View;
}) {
  const params = useSearchParams(),
    { day, view, stop } = selectedPage(params, initialView);
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== view) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      previousView.current = view;
    }
  }, [view]);
  return (
    <div
      className={`app-shell${view === 'route' ? ' app-shell--map' : ''}${view === 'agent' ? ' app-shell--agent' : ''}`}
    >
      <header className="site-header">
        <Link
          className="brand"
          href={pageUrl('roadbook', day.id)}
          aria-label="北行路书首页"
        >
          <span className="brand-symbol">
            <Compass />
          </span>
          <span>
            北行<span className="brand-sub">路书</span>
          </span>
        </Link>
        <nav className="desktop-nav" aria-label="主导航">
          <Link
            href={pageUrl('roadbook', day.id)}
            aria-current={view === 'roadbook' ? 'page' : undefined}
          >
            每日路书
          </Link>
          <Link
            href={pageUrl('route', day.id)}
            aria-current={view === 'route' ? 'page' : undefined}
          >
            路线总览
          </Link>
          <Link
            href={pageUrl('agent', day.id)}
            aria-current={view === 'agent' ? 'page' : undefined}
          >
            旅行助手
          </Link>
          <Link
            href={pageUrl('account', day.id)}
            aria-current={view === 'account' ? 'page' : undefined}
          >
            账户
          </Link>
        </nav>
      </header>
      <main id="main-content">
        {view === 'roadbook' ? (
          <Daily day={day} />
        ) : view === 'route' ? (
          <RouteOverview day={day} />
        ) : view === 'agent' ? (
          <Suspense
            fallback={
              <p className="p-6 text-sm text-muted-foreground">正在打开助手…</p>
            }
          >
            <ChatScreen dayId={day.id} />
          </Suspense>
        ) : view === 'account' ? (
          <AccountPage />
        ) : (
          <Place
            day={day}
            stop={stop}
            backHref={placeBackUrl(params, day.id)}
          />
        )}
      </main>
      <nav className="mobile-nav" aria-label="底部导航">
        <Link
          href={pageUrl('roadbook', day.id)}
          aria-current={view === 'roadbook' ? 'page' : undefined}
        >
          <BookOpen />
          路书
        </Link>
        <Link
          href={pageUrl('route', day.id)}
          aria-current={view === 'route' ? 'page' : undefined}
        >
          <MapPin />
          路线
        </Link>
        <Link
          href={pageUrl('agent', day.id)}
          aria-current={view === 'agent' ? 'page' : undefined}
        >
          <MessageCircle />
          助手
        </Link>
        <Link
          href={pageUrl('account', day.id)}
          aria-current={view === 'account' ? 'page' : undefined}
        >
          <UserRound />
          账户
        </Link>
      </nav>
    </div>
  );
}
