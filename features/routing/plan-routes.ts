import type { Trip } from '../trip/types.ts';
import { allLegs } from '../trip/selectors.ts';
/** Results belong to a directed pair in the current document, not a past index. */
export function routeStillCurrent(
  trip: Trip,
  legId: string,
  key: string,
): boolean {
  return allLegs(trip).some((leg) => leg.id === legId && leg.key === key);
}
