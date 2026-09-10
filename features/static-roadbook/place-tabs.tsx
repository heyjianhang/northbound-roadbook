'use client';
import { lazy, Suspense, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams } from '@/lib/navigation';
const PlaceNote = lazy(() =>
  import('@/features/notes/place-note').then((module) => ({
    default: module.PlaceNote,
  })),
);

export function PlaceTabs({
  stopId,
  children,
}: {
  stopId: string;
  children: ReactNode;
}) {
  const params = useSearchParams();
  const selected = params.get('tab') === 'notes' ? 'notes' : 'posts';
  return (
    <Tabs
      className="place-tabs"
      value={selected}
      onValueChange={(value) => {
        const url = new URL(window.location.href);
        if (value === 'notes') url.searchParams.set('tab', 'notes');
        else url.searchParams.delete('tab');
        window.history.pushState(window.history.state, '', url);
        window.dispatchEvent(new Event('northbound:url-change'));
      }}
    >
      <TabsList
        className="grid w-full grid-cols-2 group-data-horizontal/tabs:h-11"
        aria-label="地点资料"
      >
        <TabsTrigger value="posts">帖子</TabsTrigger>
        <TabsTrigger value="notes">笔记</TabsTrigger>
      </TabsList>
      <TabsContent value="posts">{children}</TabsContent>
      <TabsContent value="notes" keepMounted>
        <Suspense fallback={<output>正在打开笔记…</output>}>
          <PlaceNote stopId={stopId} active={selected === 'notes'} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
