"use client";

import { ChangeEvent, DragEvent, MouseEvent, RefObject, useEffect, useRef, useState } from "react";
import { ArrowRight, ImagePlus, Star, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";

const ACCEPTED_PHOTO_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif";
const MAX_PHOTOS = 3;

const HERO_IMAGE_SRC = "/sticker-reference-locked-hero-v12.webp";
const HERO_IMAGE_SRC_SET = "/hero-photo-to-stickers-mobile.webp 768w, /sticker-reference-locked-hero-v12.webp 1536w";
const HERO_IMAGE_SIZES = "(max-width: 900px) 100vw, 50vw";

type LandingV2Props = {
  photos: string[];
  photoBusy: boolean;
  photoError: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  onContinue: () => void;
};

// Only real generated sheets from the product; no staged customer examples.
const EXAMPLES = [
  {
    src: "/latest-dog-person-sticker-sheet-v13.webp",
    width: 1226,
    height: 1283,
    label: "You + your pet",
    alt: "Custom sticker sheet of a woman in a blue dress with her cream-colored puppy in ten illustrated poses",
  },
  {
    src: "/halloween-girl-dog-sticker-sheet-v15.webp",
    width: 1023,
    height: 1537,
    label: "Holiday you",
    alt: "Custom Halloween sticker sheet of a witch and her dog in a ghost costume",
  },
  {
    src: "/classic-sticker-sheet-v1.webp",
    width: 800,
    height: 1000,
    label: "Your latest era",
    alt: "Custom sticker sheet of a girl holding her orange cat with big-sister themed stickers",
  },
];

const STEPS = [
  { n: "01", title: "Upload your photos", body: "Pick up to 3 favorites from your camera roll." },
  { n: "02", title: "See your stickers", body: "We turn them into 10 one-of-one designs — free to preview." },
  { n: "03", title: "Get the ones you love", body: "Download instantly, or get a physical pack with free shipping." },
];

// Every answer here is backed by the live product flow or the privacy page;
// do not add claims that are not true of the actual product.
const FAQ: [string, string][] = [
  [
    "When do I pay?",
    "Only after you have seen your stickers. Uploading a photo and generating your preview are free — you pay nothing until you love the result.",
  ],
  [
    "What photos work best?",
    "Any clear, well-lit photo from your camera roll — selfies, pets, friends all work. JPG, PNG, or HEIC, up to 3 photos per sheet.",
  ],
  [
    "What happens to my photos?",
    "They are used only to create your stickers. Unpaid previews may be deleted after 24 hours, and you can email us anytime to delete your photos and artwork.",
  ],
  [
    "How much does it cost?",
    "Every sheet is 10 custom stickers. The digital pack is $4.99 with instant download; physical + digital is $9.99 with free shipping.",
  ],
  [
    "What file format and resolution do I receive?",
    "Digital downloads are PNG files. The print-ready sheet is 1200 x 1800 pixels at 300 DPI, and individual sticker files include transparent padding.",
  ],
  [
    "What are the physical sheet dimensions and material?",
    "The physical sheet is 4 x 6 inches and is printed on premium sticker material, with ten die-cut stickers on each sheet.",
  ],
  [
    "Where do you ship, and how long does delivery take?",
    "Physical orders currently ship within the United States. Delivery typically takes 5-8 business days after your order is processed.",
  ],
  [
    "Are the stickers waterproof or weatherproof?",
    "The stickers are designed for everyday indoor use. They are not rated as waterproof or weatherproof, so avoid prolonged exposure to water, rain, or harsh weather.",
  ],
];

export function LandingV2({ photos, photoBusy, photoError, fileInputRef, onFiles, onRemove, onContinue }: LandingV2Props) {
  const [showStickyCta, setShowStickyCta] = useState(false);
  const ctaRef = useRef<HTMLDivElement>(null);
  const hasPhotos = photos.length > 0;

  // The sticky CTA only appears once the hero uploader has scrolled above the
  // viewport, and disappears as soon as photos exist.
  useEffect(() => {
    const node = ctaRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyCta(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.currentTarget.classList.remove("dragging");
    onFiles(event.dataTransfer.files);
  };

  const handleZoneClick = (event: MouseEvent<HTMLLabelElement>) => {
    const target = event.target as HTMLElement;
    // Label activation dispatches a second synthetic click on the input
    // itself; ignore it so one user action never double-fires events.
    if (target === fileInputRef.current) return;
    if (target.closest(".v2-upload-action")) {
      track("hero_upload_click", { cta_placement: "hero" });
    } else {
      track("dropzone_click");
    }
  };

  return (
    <>
      <section className="v2-hero enter">
        <div className="v2-copy">
          <h1 className="v2-h1">
            <span>Turn your photo</span>
            <span>into 10 custom stickers.</span>
          </h1>
          <p className="v2-subhead">Upload a selfie, your pet, your bestie, or anything from your camera roll.</p>
        </div>

        <div className="v2-art">
          <div
            className="hero-story-composite v2-composite"
            role="img"
            aria-label="A candid photo of a woman holding her puppy turning into a sheet of ten custom illustrated stickers"
          >
            <img
              className="hero-story-slice hero-polaroid"
              src={HERO_IMAGE_SRC}
              srcSet={HERO_IMAGE_SRC_SET}
              sizes={HERO_IMAGE_SIZES}
              fetchPriority="high"
              decoding="async"
              alt=""
            />
            <img className="hero-arrow-cutout" src="/curved-arrow-transparent-v14.png" width={81} height={42} decoding="async" alt="" />
            <img
              className="hero-story-slice hero-sheet"
              src={HERO_IMAGE_SRC}
              srcSet={HERO_IMAGE_SRC_SET}
              sizes={HERO_IMAGE_SIZES}
              fetchPriority="high"
              decoding="async"
              alt=""
            />
            <span className="v2-tag v2-tag-photo" aria-hidden="true">YOUR PHOTO</span>
            <span className="v2-tag v2-tag-stickers" aria-hidden="true">YOUR STICKERS</span>
            <span className="v2-burst" aria-hidden="true">10<small>STICKERS</small></span>
          </div>
        </div>

        <div className="v2-cta" ref={ctaRef}>
          <label
            className={`v2-dropzone${hasPhotos ? " has-photo" : ""}`}
            onClick={handleZoneClick}
            onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); }}
            onDragLeave={(event) => event.currentTarget.classList.remove("dragging")}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_PHOTO_TYPES}
              multiple
              disabled={photos.length >= MAX_PHOTOS}
              aria-label="Upload photos"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                onFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            {hasPhotos ? (
              <>
                <div className="preview-row">
                  {photos.map((src, index) => (
                    <div className="preview-item" key={src}>
                      <img src={src} alt={`Upload ${index + 1}`} />
                      <button
                        type="button"
                        aria-label={`Delete photo ${index + 1}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onRemove(index);
                        }}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  ))}
                </div>
                <b className="v2-added">✓ {photos.length} PHOTO{photos.length > 1 ? "S" : ""} ADDED</b>
                {photos.length < MAX_PHOTOS && <span className="v2-add-more">+ ADD ANOTHER PHOTO</span>}
              </>
            ) : (
              <>
                <span className="v2-upload-icon" aria-hidden="true"><ImagePlus /></span>
                <b className="v2-drop-label">Drop your photos here</b>
                <span className="v2-upload-action"><Upload size={15} aria-hidden="true" /> Upload photos</span>
              </>
            )}
            <span className="v2-microcopy">10 custom stickers · See them before you pay</span>
          </label>
          {photoBusy && <p className="upload-status">Converting your photo…</p>}
          {photoError && <p className="upload-error" role="alert">{photoError}</p>}
          {hasPhotos && (
            <Button className="red-btn v2-continue" onClick={onContinue}>
              MAKE MY STICKERS <ArrowRight aria-hidden="true" />
            </Button>
          )}
          <p className="v2-privacy">Your photos are only used to make your stickers.</p>
          <div className="v2-social-proof" aria-hidden="false">
            <span className="v2-social-stars" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, index) => (
                <Star key={index} size={14} fill="currentColor" strokeWidth={0} />
              ))}
            </span>
            <span className="v2-social-text">Loved by <b>150K+</b> users</span>
          </div>
        </div>
      </section>

      <section className="v2-section v2-examples" aria-labelledby="v2-examples-title">
        <h2 id="v2-examples-title">Anything in your camera roll can be <em>a sticker.</em></h2>
        <div className="v2-example-grid">
          {EXAMPLES.map((example) => (
            <figure className="v2-example-card" key={example.src}>
              <img
                src={example.src}
                width={example.width}
                height={example.height}
                loading="lazy"
                decoding="async"
                alt={example.alt}
              />
              <figcaption>{example.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="v2-section v2-how" aria-labelledby="v2-how-title">
        <h2 className="v2-eyebrow" id="v2-how-title">How it works</h2>
        <ol className="v2-steps">
          {STEPS.map((step) => (
            <li key={step.n}>
              <b>{step.n}</b>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="v2-section v2-faq" aria-labelledby="v2-faq-title">
        <h2 id="v2-faq-title">Questions, answered.</h2>
        <div className="v2-faq-list">
          {FAQ.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      {showStickyCta && !hasPhotos && (
        <div className="v2-sticky-cta">
          <button
            type="button"
            onClick={() => {
              track("hero_upload_click", { cta_placement: "sticky" });
              fileInputRef.current?.click();
            }}
          >
            <Upload size={15} aria-hidden="true" /> Upload photos
          </button>
        </div>
      )}
    </>
  );
}
