import photos from '../../data/day-photos.json';
type DayPhoto = {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
  position?: string;
  author: string;
  takenAt: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
};
export const dayPhotos: Record<string, DayPhoto> = photos;
