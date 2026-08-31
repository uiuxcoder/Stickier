"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Sparkles, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { normalizePhoto, UnsupportedPhotoError } from "@/lib/photo-normalize";

type CreatorStage = "photos" | "details" | "mood" | "generating";

type MemberStickerCreatorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

const MAX_PHOTOS = 3;
const MOODS = ["Cute", "Funny", "Happy", "Cozy", "Angry", "Chaotic"];
const LOADING_STEPS = [
  "Getting to know your photo",
  "Picking up the details",
  "Bringing your stickers to life",
  "Adding the finishing touches",
];

async function uploadPhoto(file: File) {
  const prep = await fetch("/api/upload-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type || "image/png" }),
  });
  if (!prep.ok) throw new Error("We could not prepare that photo for upload.");
  const { key, token } = (await prep.json()) as { key: string; token: string };
  const upload = await fetch(`/api/upload-photo?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/png" },
    body: file,
  });
  if (!upload.ok) throw new Error("We could not upload that photo.");
  return key;
}

export function MemberStickerCreator({ open, onOpenChange, onCreated }: MemberStickerCreatorProps) {
  const [stage, setStage] = useState<CreatorStage>("photos");
  const [photos, setPhotos] = useState<{ key: string; preview: string }[]>([]);
  const [description, setDescription] = useState("");
  const [moods, setMoods] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [loadingStep, setLoadingStep] = useState(0);
  const pollTimer = useRef<number>();

  function reset() {
    photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setStage("photos");
    setPhotos([]);
    setDescription("");
    setMoods([]);
    setUploading(false);
    setError("");
    setLoadingStep(0);
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen && stage === "generating") return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  useEffect(() => () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
  }, []);

  useEffect(() => {
    if (stage !== "generating") return;
    const interval = window.setInterval(() => setLoadingStep((current) => Math.min(current + 1, LOADING_STEPS.length - 1)), 2200);
    return () => window.clearInterval(interval);
  }, [stage]);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files).slice(0, MAX_PHOTOS - photos.length);
    if (!selected.length) return;
    setUploading(true);
    setError("");
    try {
      const additions: { key: string; preview: string }[] = [];
      for (const file of selected) {
        try {
          const normalized = await normalizePhoto(file);
          additions.push({ key: await uploadPhoto(normalized), preview: URL.createObjectURL(normalized) });
        } catch (photoError) {
          throw new Error(photoError instanceof UnsupportedPhotoError ? photoError.message : "We could not upload that photo.");
        }
      }
      setPhotos((current) => [...current, ...additions]);
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "We could not upload that photo.");
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      URL.revokeObjectURL(current[index].preview);
      return current.filter((_, photoIndex) => photoIndex !== index);
    });
  }

  function toggleMood(mood: string) {
    setMoods((current) => current.includes(mood) ? current.filter((item) => item !== mood) : [...current, mood]);
  }

  async function generate() {
    setError("");
    setLoadingStep(0);
    setStage("generating");
    try {
      const response = await fetch("/api/generate-stickers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoKeys: photos.map((photo) => photo.key),
          photos: [],
          subject: "You",
          product: "me",
          companion: "skip",
          theme: "Classic",
          moods,
          specialRequest: description,
        }),
      });
      const data = (await response.json()) as { jobId?: string; error?: string };
      if (!response.ok || !data.jobId) throw new Error(data.error || "Unable to start generation.");

      let attempts = 0;
      const poll = async () => {
        try {
          const status = await fetch(`/api/generation-status?jobId=${encodeURIComponent(data.jobId!)}`).then((result) => result.json()) as {
            status?: string;
            error?: string;
          };
          if (status.status === "succeeded") {
            reset();
            onOpenChange(false);
            onCreated();
            return;
          }
          if (status.status === "failed") throw new Error(status.error || "Generation failed.");
          if (attempts++ >= 90) throw new Error("Generation is taking longer than expected. Please try again.");
          pollTimer.current = window.setTimeout(poll, 2000);
        } catch (pollError) {
          setError(pollError instanceof Error ? pollError.message : "Unable to generate stickers.");
          setStage("mood");
        }
      };
      void poll();
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Unable to generate stickers.");
      setStage("mood");
    }
  }

  const step = stage === "photos" ? 1 : stage === "details" ? 2 : 3;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="club-create-modal" showCloseButton={stage !== "generating"}>
        {stage !== "generating" ? (
          <>
            <DialogHeader>
              <div className="club-create-progress"><span>Step {step} of 3</span><i><b style={{ width: `${(step / 3) * 100}%` }} /></i></div>
              <DialogTitle>{stage === "photos" ? "Add your photos." : stage === "details" ? "Any details to include?" : "What's the mood?"}</DialogTitle>
              <DialogDescription>
                {stage === "photos" ? "Choose up to 3 clear photos." : stage === "details" ? "Give us any direction that will make the stickers feel like you." : "Choose one or more, or leave it open."}
              </DialogDescription>
            </DialogHeader>

            {stage === "photos" ? (
              <label className="club-create-upload" onDragOver={(event: DragEvent<HTMLLabelElement>) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addPhotos(event.dataTransfer.files); }}>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple disabled={uploading || photos.length >= MAX_PHOTOS} onChange={(event: ChangeEvent<HTMLInputElement>) => { void addPhotos(event.target.files); event.currentTarget.value = ""; }} />
                <ImagePlus />
                <strong>{uploading ? "Uploading..." : photos.length ? "Add another photo" : "Drop photos here"}</strong>
                <span><Upload size={14} /> {photos.length}/3 photos</span>
                {photos.length > 0 ? <div>{photos.map((photo, index) => <figure key={photo.preview}><img src={photo.preview} alt={`Upload ${index + 1}`} /><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={(event) => { event.preventDefault(); removePhoto(index); }}><Trash2 /></button></figure>)}</div> : null}
              </label>
            ) : null}

            {stage === "details" ? (
              <label className="club-create-description">
                <span>Description or special request</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Examples: Put us in Halloween costumes, add my favorite coffee mug..." autoFocus />
                <small>{description.length}/500</small>
              </label>
            ) : null}

            {stage === "mood" ? (
              <div className="club-create-moods">
                {MOODS.map((mood) => <button type="button" key={mood} className={moods.includes(mood) ? "selected" : ""} aria-pressed={moods.includes(mood)} onClick={() => toggleMood(mood)}>{mood}{moods.includes(mood) ? <Check /> : null}</button>)}
              </div>
            ) : null}

            {error ? <p className="club-create-error" role="alert">{error}</p> : null}
            <div className="club-create-actions">
              {stage !== "photos" ? <button type="button" className="club-secondary-button" onClick={() => setStage(stage === "mood" ? "details" : "photos")}><ArrowLeft size={14} /> Back</button> : <span />}
              <button type="button" className="club-primary-button" disabled={stage === "photos" ? photos.length === 0 || uploading : false} onClick={() => stage === "photos" ? setStage("details") : stage === "details" ? setStage("mood") : void generate()}>
                {stage === "mood" ? <>Create stickers <Sparkles size={14} /></> : <>Next <ArrowRight size={14} /></>}
              </button>
            </div>
          </>
        ) : (
          <div className="club-create-loading" role="status" aria-live="polite">
            <div className="loading-spinner" />
            <DialogTitle>Your stickers are coming to life.</DialogTitle>
            <DialogDescription>Usually ready in 30–60 seconds. Don&apos;t close this window.</DialogDescription>
            <ol>{LOADING_STEPS.map((item, index) => <li className={index < loadingStep ? "complete" : index === loadingStep ? "active" : ""} key={item}><span>{index < loadingStep ? "✓" : index === loadingStep ? "•" : "○"}</span>{item}</li>)}</ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}