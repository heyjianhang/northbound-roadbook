import { Suspense } from 'react';
import { StaticRoadbook } from '@/features/static-roadbook/screen';
export default function Page() {
  return (
    <Suspense>
      <StaticRoadbook initialView="roadbook" />
    </Suspense>
  );
}
