'use client';

import Image from 'next/image';
import { ArrowLeft, ArrowUpRight, X } from 'lucide-react';
import Link from '@/lib/navigation';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from '@/components/ui/drawer';
import { placeDetails } from './place-details';

export function PlaceCover({
  name,
  backHref,
}: {
  name: string;
  backHref: string;
}) {
  const detail = placeDetails[name];
  if (!detail)
    return (
      <>
        <Link href={backHref} aria-label="返回">
          <ArrowLeft />
        </Link>
        <h1>{name}</h1>
      </>
    );
  const { photo } = detail;
  return (
    <Drawer showSwipeHandle>
      <div className="place-cover">
        <Image
          src={photo.src}
          alt={photo.alt}
          width={photo.width}
          height={photo.height}
          style={{ objectPosition: photo.position || 'center' }}
          fetchPriority="high"
          unoptimized
        />
        <h1>
          <DrawerTrigger
            className="place-cover-trigger"
            aria-label={`了解${name}`}
          >
            <span className="place-cover-copy">
              <span className="place-cover-name">{name}</span>
              <span className="place-cover-hint">
                了解这里 <ArrowUpRight aria-hidden="true" />
              </span>
            </span>
          </DrawerTrigger>
        </h1>
        <Link className="place-cover-back" href={backHref} aria-label="返回">
          <ArrowLeft aria-hidden="true" />
        </Link>
      </div>
      <DrawerContent className="place-intro-sheet">
        <div className="place-intro-heading">
          <DrawerTitle className="place-intro-title">{name}</DrawerTitle>
          <DrawerClose className="place-intro-close" aria-label="关闭简介">
            <X aria-hidden="true" />
          </DrawerClose>
        </div>
        <div className="place-intro-body">
          <DrawerDescription className="place-intro-description">
            {detail.intro}
          </DrawerDescription>
          <div className="place-intro-credit">
            <p>{photo.alt}</p>
            <p>
              摄影：{photo.author} · {photo.takenAt} · 封面裁切展示
            </p>
            <div>
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
              {detail.sourceUrl && (
                <a
                  href={detail.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  介绍参考
                </a>
              )}
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
