"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";

interface HomeSlideshowProps {
  images: string[];
}

function getSlideStep(track: HTMLDivElement): number {
  const slide = track.querySelector<HTMLElement>("[data-slide='true']");
  const trackStyles = getComputedStyle(track);
  const gap = Number.parseFloat(trackStyles.columnGap || trackStyles.gap || "0");
  return (slide?.getBoundingClientRect().width ?? 320) + gap;
}

function normalizeScroll(track: HTMLDivElement) {
  const singleSetWidth = track.scrollWidth / 2;
  if (singleSetWidth <= 0) return;

  if (track.scrollLeft > singleSetWidth) {
    track.scrollLeft -= singleSetWidth;
  } else if (track.scrollLeft <= 0) {
    track.scrollLeft += singleSetWidth;
  }
}

export default function HomeSlideshow({ images }: HomeSlideshowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pauseUntilRef = useRef(0);
  const interactionRef = useRef({
    hovering: false,
    focused: false,
    dragging: false,
  });
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const slides = useMemo(() => [...images, ...images], [images]);
  const isPaused = isHovering || isFocused || isDragging;

  useEffect(() => {
    interactionRef.current.hovering = isHovering;
    interactionRef.current.focused = isFocused;
    interactionRef.current.dragging = isDragging;
  }, [isDragging, isFocused, isHovering]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || images.length === 0) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frameId = 0;
    let lastTs = performance.now();
    const speedPxPerSec = 24;

    let exactScrollLeft = track.scrollLeft;

    const tick = (ts: number) => {
      const dt = ts - lastTs;
      lastTs = ts;

      const isManualPause = Date.now() < pauseUntilRef.current;
      const isInteractionPaused =
        interactionRef.current.hovering ||
        interactionRef.current.focused ||
        interactionRef.current.dragging;
      const singleSetWidth = track.scrollWidth / 2;
      const hasOverflow = singleSetWidth > track.clientWidth;

      if (!mediaQuery.matches && !isManualPause && !isInteractionPaused && hasOverflow) {
        exactScrollLeft += (speedPxPerSec * dt) / 1000;
        
        if (exactScrollLeft > singleSetWidth) {
          exactScrollLeft -= singleSetWidth;
        } else if (exactScrollLeft <= 0) {
          exactScrollLeft += singleSetWidth;
        }

        track.scrollLeft = exactScrollLeft;
      } else {
        exactScrollLeft = track.scrollLeft;
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [images.length]);

  if (!images || images.length === 0) {
    return null;
  }

  const navigate = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;

    const singleSetWidth = track.scrollWidth / 2;
    if (direction < 0 && track.scrollLeft <= 1) {
      track.scrollLeft += singleSetWidth;
    }

    pauseUntilRef.current = Date.now() + 1600;
    track.scrollBy({
      left: getSlideStep(track) * direction,
      behavior: "smooth",
    });

    window.setTimeout(() => normalizeScroll(track), 450);
  };

  return (
    <section
      className={`${styles.slideshowContainer} animate-fade-in stagger-3`}
      aria-label="App screenshots"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocused(false);
        }
      }}
    >
      <div className={styles.slideshowControls}>
        <button
          type="button"
          className={styles.slideshowButton}
          onClick={() => navigate(-1)}
          aria-label="Previous screenshot"
        >
          Prev
        </button>
        <button
          type="button"
          className={styles.slideshowButton}
          onClick={() => navigate(1)}
          aria-label="Next screenshot"
        >
          Next
        </button>
      </div>

      <div
        ref={trackRef}
        className={`${styles.slideshowTrack} ${isPaused ? styles.slideshowTrackPaused : ""}`}
        onPointerDown={() => setIsDragging(true)}
        onPointerUp={() => setIsDragging(false)}
        onPointerCancel={() => setIsDragging(false)}
        onWheel={(event) => {
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.preventDefault();
            event.currentTarget.scrollLeft += event.deltaY;
            pauseUntilRef.current = Date.now() + 900;
          }
        }}
      >
        {slides.map((imgSrc, i) => (
          <div key={`${imgSrc}-${i}`} className={styles.slide} data-slide="true">
            {imgSrc.startsWith("/") ? (
              <Image src={imgSrc} alt={`App screenshot ${((i % images.length) + 1).toString()}`} fill style={{ objectFit: "cover" }} />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  backgroundColor: "rgba(0,0,0,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>{imgSrc}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
