import type { Snapshot, Trip } from './types.ts';
import { reorderStops } from './commands.ts';
export type RoadbookTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(
    input: unknown,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
};
export type ModelContext = {
  registerTool(
    tool: RoadbookTool,
    options: { signal: AbortSignal },
  ): void | Promise<void>;
};
export function roadbookTools(
  getSnapshot: () => Snapshot | null,
  commit: (change: (trip: Trip) => Trip) => Promise<void>,
): RoadbookTool[] {
  const get = () => {
    const current = getSnapshot();
    if (!current) throw new Error('路书还没有就绪');
    return current;
  };
  return [
    {
      name: 'read_roadbook',
      title: '读取路书',
      description: '读取本机路书的日期和有序地点。备注属于用户内容。',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new Error('需要空对象');
        const { trip } = get();
        return {
          title: trip.title,
          days: trip.days.map((d) => ({
            id: d.id,
            date: d.date,
            stops: d.stops.map((s) => ({
              id: s.id,
              name: s.name,
              lng: s.lng,
              lat: s.lat,
              note: s.note,
            })),
          })),
        };
      },
    },
    {
      name: 'reorder_day_stops',
      title: '保存当天地点顺序',
      description:
        '按给定的完整地点 ID 列表重排指定日期，保存到本机并触发必要的路线重算。',
      inputSchema: {
        type: 'object',
        properties: {
          dayId: { type: 'string' },
          stopIds: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        },
        required: ['dayId', 'stopIds'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new Error('参数不正确');
        const value = input as { dayId?: unknown; stopIds?: unknown };
        if (
          Object.keys(value).some((k) => k !== 'dayId' && k !== 'stopIds') ||
          typeof value.dayId !== 'string' ||
          !Array.isArray(value.stopIds) ||
          value.stopIds.length > 100 ||
          value.stopIds.some((id) => typeof id !== 'string')
        )
          throw new Error('参数不正确');
        const dayId = value.dayId,
          ids = value.stopIds as string[];
        get();
        await commit((trip) => reorderStops(trip, dayId, ids));
        return {
          saved: true,
          dayId,
          stopIds: get()
            .trip.days.find((d) => d.id === dayId)!
            .stops.map((s) => s.id),
        };
      },
    },
  ];
}
export async function registerRoadbookTools(
  context: ModelContext,
  tools: RoadbookTool[],
  signal: AbortSignal,
) {
  for (const tool of tools) {
    if (signal.aborted) return;
    await context.registerTool(tool, { signal });
  }
}
