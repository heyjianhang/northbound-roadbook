'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, MapPin, Search } from 'lucide-react';
import { searchPois, type Poi, type XY } from '@/lib/amap';
import { useTrip } from '@/features/trip/store';
import { emptyStop } from '@/features/trip/commands';
import type { Day, Stop } from '@/features/trip/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MapCanvas } from '@/features/map/map-canvas';
export function LocationPicker({
  day,
  onChoose,
  onManual,
}: {
  day: Day;
  onChoose: (stop: Stop) => void;
  onManual?: () => void;
}) {
  const { snapshot, online } = useTrip();
  const [keyword, setKeyword] = useState(''),
    [area, setArea] = useState(day.stops[0]?.area || '呼伦贝尔'),
    [results, setResults] = useState<Poi[]>([]),
    [searching, setSearching] = useState(false),
    [searched, setSearched] = useState(false),
    [error, setError] = useState(''),
    [point, setPoint] = useState<XY | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function search(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!keyword.trim()) return;
    const request = ++generation.current;
    setSearching(true);
    setError('');
    setResults([]);
    setSearched(false);
    try {
      const pois = await searchPois(keyword.trim(), area.trim());
      if (request === generation.current) {
        setResults(pois);
        setSearched(true);
      }
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : '搜索失败');
    } finally {
      if (request === generation.current) setSearching(false);
    }
  }
  return (
    <div className="location-picker">
      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search">
            <Search />
            搜索地点
          </TabsTrigger>
          <TabsTrigger value="map">
            <MapPin />
            地图选点
          </TabsTrigger>
        </TabsList>
        <TabsContent value="search">
          <form onSubmit={search}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="poi-keyword">地点关键词</FieldLabel>
                <div className="search-line">
                  <Input
                    id="poi-keyword"
                    value={keyword}
                    onChange={(e) => {
                      generation.current++;
                      setSearching(false);
                      setResults([]);
                      setSearched(false);
                      setKeyword(e.target.value);
                    }}
                    placeholder="景点、城市或停车场"
                    required
                    maxLength={100}
                  />
                  <Button type="submit" disabled={searching || !online}>
                    {searching ? '搜索中…' : '搜索'}
                  </Button>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="poi-area">搜索区域</FieldLabel>
                <Input
                  id="poi-area"
                  value={area}
                  maxLength={100}
                  onChange={(e) => {
                    generation.current++;
                    setSearching(false);
                    setResults([]);
                    setSearched(false);
                    setArea(e.target.value);
                  }}
                />
              </Field>
            </FieldGroup>
          </form>
          {!online && (
            <p className="helper-text">
              离线时可先手动添加名称，联网后再选择位置。
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="search-results" aria-live="polite">
            {results.map((p) => (
              <button
                className="search-result"
                key={p.id}
                type="button"
                onClick={() =>
                  onChoose({
                    ...emptyStop(),
                    name: p.name,
                    lng: p.location.lng,
                    lat: p.location.lat,
                    amapId: p.id,
                    area: p.adname || p.cityname || '',
                    note: typeof p.address === 'string' ? p.address : '',
                    links: [],
                  })
                }
              >
                <MapPin />
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {p.adname || p.cityname}{' '}
                    {typeof p.address === 'string' ? p.address : ''}
                  </small>
                </div>
                <ArrowRight />
              </button>
            ))}
            {searched && !results.length && (
              <p className="helper-text">
                没有找到地点，换个关键词或在地图上选点。
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="map">
          <MapCanvas
            day={day}
            records={snapshot?.records || []}
            pick={point}
            onPick={setPoint}
          />
          <div className="map-pick-footer">
            <span>
              {point
                ? `${point[0].toFixed(6)}, ${point[1].toFixed(6)}`
                : '点击地图选择位置'}
            </span>
            <Button
              disabled={!point}
              onClick={() => {
                if (point)
                  onChoose({
                    ...emptyStop(),
                    name: '',
                    lng: point[0],
                    lat: point[1],
                    area,
                  });
              }}
            >
              使用此位置
            </Button>
          </div>
        </TabsContent>
      </Tabs>
      {onManual && (
        <Button className="manual-add" variant="outline" onClick={onManual}>
          手动添加地点
        </Button>
      )}
    </div>
  );
}
