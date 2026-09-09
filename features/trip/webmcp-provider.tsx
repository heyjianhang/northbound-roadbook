'use client';
import { useEffect } from 'react';
import { useTrip } from './store';
import {
  roadbookTools,
  registerRoadbookTools,
  type ModelContext,
} from './webmcp';
export function WebMcpBridge() {
  const { getSnapshot, commit } = useTrip();
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void registerRoadbookTools(
      context,
      roadbookTools(getSnapshot, commit),
      lifecycle.signal,
    ).catch(() => {
      lifecycle.abort();
    });
    return () => lifecycle.abort();
  }, [commit, getSnapshot]);
  return null;
}
