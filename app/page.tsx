"use client";

import { ChangeEvent, DragEvent, startTransition, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, ImagePlus, Package, PawPrint, Sparkles, Star, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LandingV2 } from "@/components/landing-v2";
import { setLandingVariant, track, trackOnce } from "@/lib/analytics";
import { normalizePhoto, UnsupportedPhotoError } from "@/lib/photo-normalize";
import posthog from "posthog-js";

type Stage = "home" | "samples" | "photos" | "details" | "mood" | "generating" | "reveal" | "confirmation";
type Product = "me" | "pet" | "partner" | "family";
const loadingSteps = ["Getting to know your photo", "Picking up the details", "Bringing your stickers to life...", "Adding the finishing touches"];
// Must match CONTENT_POLICY_MESSAGE in lib/moderation.ts so the reveal stage
// can show a dedicated error state instead of an empty sticker grid.
const CONTENT_POLICY_MESSAGE = "That photo or request can't be used to generate stickers. Please try a different photo or description.";
// Roughly the average real generation time; split evenly across the loading
// lines so they advance once each and hold on the last line instead of looping.
const ESTIMATED_GENERATION_MS = 60000;
const LOADING_STEP_INTERVAL_MS = ESTIMATED_GENERATION_MS / loadingSteps.length;
const positions = ["0% 0%", "50% 0%", "100% 0%", "0% 33.3333%", "50% 33.3333%", "100% 33.3333%", "0% 66.6667%", "50% 66.6667%", "100% 66.6667%", "50% 100%"];
const samples = ["01","02","03","04","05","06"];
const moodOptions = [
  "Cute",
  "Funny",
  "Happy",
  "Cozy",
  "Angry",
  "Chaotic",
];
const MAX_PHOTOS = 3;
// Landing experiment switch: ?landing=v1|v2 selects a variant and is remembered
// for the rest of the session so funnel events stay attributed. Flip this
// constant to make V2 the default experience.
const DEFAULT_LANDING_VARIANT: "v1" | "v2" = "v1";
const LANDING_VARIANT_KEY = "stickier-landing-variant";
// Runs before paint on the client, no-op during SSR prerender.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function readLandingVariant(): "v1" | "v2" {
  if (typeof window === "undefined") return DEFAULT_LANDING_VARIANT;
  const param = new URLSearchParams(window.location.search).get("landing");
  if (param === "v1" || param === "v2") {
    try { sessionStorage.setItem(LANDING_VARIANT_KEY, param); } catch { /* private mode */ }
    return param;
  }
  try {
    const saved = sessionStorage.getItem(LANDING_VARIANT_KEY);
    if (saved === "v1" || saved === "v2") return saved;
  } catch { /* private mode */ }
  return DEFAULT_LANDING_VARIANT;
}

function Sheet({ name, className = "", clean = false, src = "/latest-dog-person-sticker-sheet-v13.webp" }: { name: string; className?: string; clean?: boolean; src?: string }) {
  return <div className={`sheet ${className} ${clean?"clean-sheet":""}`}>{!clean&&<div className="sheet-head"><b>{name.toUpperCase()}&apos;S ERA</b><span>01 / 01</span></div>}<img src={src} alt={`${name}'s custom sticker sheet`} />{!clean&&<div className="sheet-foot">ONE OF ONE · MADE FOR YOU ✦</div>}</div>;
}
function Progress({ n, total }: { n: number; total: number }) {
  return <div className="wizard-progress"><span>STEP {String(n).padStart(2,"0")} / {String(total).padStart(2,"0")}</span><div><i style={{width:`${n/total*100}%`}}/></div></div>;
}
function UploadBox({ previews, pet=false, onChange, onRemove }: { previews:string[]; pet?:boolean; onChange:(f:FileList|null)=>void; onRemove:(index:number)=>void }) {
  const drop=(e:DragEvent<HTMLLabelElement>)=>{e.preventDefault();e.currentTarget.classList.remove("dragging");onChange(e.dataTransfer.files)};
  return <label className="upload-zone" onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("dragging")}} onDragLeave={e=>e.currentTarget.classList.remove("dragging")} onDrop={drop}><input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif" multiple disabled={previews.length>=MAX_PHOTOS} onChange={(e:ChangeEvent<HTMLInputElement>)=>{onChange(e.target.files);e.currentTarget.value=""}}/><div className="upload-icon">{pet?<PawPrint/>:<ImagePlus/>}</div><b>{previews.length?`✓ ${previews.length} PHOTO${previews.length>1?"S":""} ADDED`:"DROP YOUR PHOTOS HERE"}</b><span><Upload size={15}/>{previews.length===0?"CHOOSE A PHOTO":previews.length<MAX_PHOTOS?"ADD ANOTHER PHOTO":"3 PHOTO LIMIT"}</span>{previews.length>0&&<div className="preview-row">{previews.map((src,index)=><div className="preview-item" key={src}><img src={src} alt={`Upload ${index+1}`}/><button type="button" aria-label={`Delete photo ${index+1}`} onClick={event=>{event.preventDefault();event.stopPropagation();onRemove(index)}}><Trash2/></button></div>)}</div>}</label>;
}
function GenericStickerSheet() {
  return <div className="printer-placeholder-grid" aria-label="Ten empty sticker placeholders">{Array.from({length:10},(_,index)=><span key={index}/>)}</div>;
}

async function readCheckoutResponse(response: Response): Promise<{url?:string;error?:string}> {
  const body = await response.text();
  if (!body) return {error:"The checkout service did not respond. Please try again."};
  try {
    return JSON.parse(body) as {url?:string;error?:string};
  } catch {
    return {error:"The checkout service returned an invalid response. Please try again."};
  }
}

// The model rarely centers each sticker inside its grid cell, so a fixed grid
// cut looks off-center, and a neighbouring sticker can bleed a sliver across the
// gutter. Erase anything that bled in, then trim the white margin and re-center
// on a square canvas with an even white border standing in for the die-cut
// outline. This mirrors the download pipeline so the preview shows what the
// customer receives.
function centerStickerArtwork(cell: HTMLCanvasElement, outputSize = 0): string {
  const context = cell.getContext("2d", { willReadFrequently: true });
  if (!context) return cell.toDataURL("image/png");
  const width = cell.width;
  const height = cell.height;
  let image: ImageData;
  try {
    image = context.getImageData(0, 0, width, height);
  } catch {
    return cell.toDataURL("image/png");
  }
  const pixels = image.data;
  const total = width * height;
  const isArtwork = (pixel: number) => {
    const offset = pixel * 4;
    if (pixels[offset + 3] <= 16) return false;
    return pixels[offset] < 238 || pixels[offset + 1] < 238 || pixels[offset + 2] < 238;
  };

  const label = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const sizes: number[] = [];
  const touchesEdge: boolean[] = [];
  for (let start = 0; start < total; start++) {
    if (label[start] !== -1 || !isArtwork(start)) continue;
    const current = sizes.length;
    let head = 0;
    let tail = 0;
    let edge = false;
    label[start] = current;
    queue[tail++] = start;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      const visit = (neighbour: number) => {
        if (label[neighbour] !== -1 || !isArtwork(neighbour)) return;
        label[neighbour] = current;
        queue[tail++] = neighbour;
      };
      if (x > 0) visit(pixel - 1);
      if (x + 1 < width) visit(pixel + 1);
      if (y > 0) visit(pixel - width);
      if (y + 1 < height) visit(pixel + width);
    }
    sizes.push(tail);
    touchesEdge.push(edge);
  }
  if (!sizes.length) return cell.toDataURL("image/png");

  let largest = 0;
  for (let index = 1; index < sizes.length; index++) if (sizes[index] > sizes[largest]) largest = index;
  // A sliver bleeding in from the next cell has to cross this cell's edge, while
  // a prop that floats free of the character sits wholly inside it. Keep the
  // sticker itself plus any interior piece big enough not to be resampling
  // speckle, and drop everything that reaches an edge.
  const minInteriorSize = Math.max(8, sizes[largest] * 0.005);
  const kept = sizes.map((size, index) => index === largest || (!touchesEdge[index] && size >= minInteriorSize));

  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let pixel = 0; pixel < total; pixel++) {
    const component = label[pixel];
    if (component === -1) continue;
    if (kept[component]) {
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    } else {
      const offset = pixel * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
  }
  if (right < 0) return cell.toDataURL("image/png");
  context.putImageData(image, 0, 0);
  const artWidth = right - left + 1;
  const artHeight = bottom - top + 1;
  const margin = Math.max(10, Math.round(Math.max(artWidth, artHeight) * 0.09));
  const size = Math.max(outputSize, Math.max(artWidth, artHeight) + margin * 2);
  const square = document.createElement("canvas");
  square.width = size;
  square.height = size;
  const squareContext = square.getContext("2d");
  if (!squareContext) return cell.toDataURL("image/png");
  squareContext.fillStyle = "#ffffff";
  squareContext.fillRect(0, 0, size, size);
  squareContext.drawImage(cell, left, top, artWidth, artHeight, Math.round((size - artWidth) / 2), Math.round((size - artHeight) / 2), artWidth, artHeight);
  return square.toDataURL("image/png");
}

function ReferencePhotos({previews,onChange,onRemove}:{previews:string[];onChange:(files:FileList|null)=>void;onRemove:(index:number)=>void}){
  return <div className="reference-upload">{previews.length>0&&<div className="reference-preview-row">{previews.map((src,index)=><div className="reference-preview-item" key={src}><img src={src} alt={`Reference photo ${index+1}`}/><button type="button" aria-label={`Delete reference photo ${index+1}`} onClick={()=>onRemove(index)}><Trash2/></button></div>)}</div>}<label className={`reference-photo-button ${previews.length>=MAX_PHOTOS?"disabled":""}`}><input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif" multiple disabled={previews.length>=MAX_PHOTOS} onChange={event=>{onChange(event.target.files);event.currentTarget.value=""}}/><ImagePlus/>{previews.length?"ADD MORE REFERENCE PHOTOS":"ADD REFERENCE PHOTOS"}<small>{previews.length}/3 · OPTIONAL</small></label></div>;
}

// Convert each selection independently so one unreadable file cannot discard
// the rest of the batch.
async function normalizePhotos(files:File[]):Promise<{photos:File[];errors:string[]}>{
  const photos:File[]=[];
  const errors:string[]=[];
  for(const file of files){
    try{
      photos.push(await normalizePhoto(file));
    }catch(error){
      const reason=error instanceof UnsupportedPhotoError?error.message:"We could not read that photo.";
      errors.push(`${file.name}: ${reason}`);
    }
  }
  return {photos,errors};
}

// Upload a photo directly to R2 via the signed upload endpoint, returning its
// object key. Falls back to an inline data URL when the upload fails so local
// development without R2 still works.
async function uploadPhoto(file: File): Promise<{ key?: string; dataUrl?: string }> {
  try {
    const prep = await fetch("/api/upload-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type || "image/png" }),
    });
    if (prep.ok) {
      const { key, token } = (await prep.json()) as { key: string; token: string };
      const put = await fetch(`/api/upload-photo?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (put.ok) return { key };
    }
  } catch {
    // fall through to inline
  }
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  return { dataUrl };
}

export default function Home(){
  const [stage,setStage]=useState<Stage>("home");
  const [product,setProduct]=useState<Product>("me");
  const [name,setName]=useState("");
  const [groupName,setGroupName]=useState("");
  const [photos,setPhotos]=useState<string[]>([]);
  const [photoKeys,setPhotoKeys]=useState<string[]>([]);
  const [photoDataUrls,setPhotoDataUrls]=useState<string[]>([]);
  const [referencePhotos,setReferencePhotos]=useState<string[]>([]);
  const [referencePhotoKeys,setReferencePhotoKeys]=useState<string[]>([]);
  const [referencePhotoDataUrls,setReferencePhotoDataUrls]=useState<string[]>([]);
  const [skipPhotoStep,setSkipPhotoStep]=useState(false);
  const [photoError,setPhotoError]=useState("");
  const [photoBusy,setPhotoBusy]=useState(false);
  const [specialRequest,setSpecialRequest]=useState("");
  const [pet,setPet]=useState({name:"",species:"Dog"});
  const [theme,setTheme]=useState("Classic");
  const [moods,setMoods]=useState<string[]>([]);
  const [paymentOpen,setPaymentOpen]=useState(false);
  const [paymentPlan,setPaymentPlan]=useState<"digital"|"physical"|"membership"|null>(null);
  const [email,setEmail]=useState("");
  const [signedIn,setSignedIn]=useState(false);
  const [isActiveMember,setIsActiveMember]=useState(false);
  const [checkoutNotice,setCheckoutNotice]=useState("");
  const [checkoutError,setCheckoutError]=useState("");
  const [checkoutLoading,setCheckoutLoading]=useState(false);
  const [subscriptionLoading,setSubscriptionLoading]=useState(false);
  const [checkoutSessionId,setCheckoutSessionId]=useState("");
  const [downloadUrl,setDownloadUrl]=useState("");
  const [purchasedPlan,setPurchasedPlan]=useState<"digital"|"physical">("digital");
  const [generatedImage,setGeneratedImage]=useState("");
  const [generatedImageKey,setGeneratedImageKey]=useState("");
  const [generationSaved,setGenerationSaved]=useState(false);
  const [generationJobId,setGenerationJobId]=useState("");
  const [generatedSlices,setGeneratedSlices]=useState<string[]>([]);
  const [generatedSlicesSource,setGeneratedSlicesSource]=useState("");
  const [generationError,setGenerationError]=useState("");
  const [tick,setTick]=useState(0);
  const pollTimer=useRef<number|undefined>(undefined);
  // Always initialize to the default so SSR and hydration match; the real
  // variant is applied in a layout effect before the first client paint.
  const [landingVariant,setLandingVariantState]=useState<"v1"|"v2">(DEFAULT_LANDING_VARIANT);
  const heroFileInputRef=useRef<HTMLInputElement|null>(null);
  const isV2Home=landingVariant==="v2"&&stage==="home";

  const subject=product==="pet"?(pet.name||"Your pet"):product==="partner"?(groupName||"My partner"):product==="family"?(groupName||"Family & friends"):(name||"You");
  const total=3;
  const requestExample='Examples: “Put us in Halloween costumes,” “Give my plant a cute pot.”';
  const currentStep=({photos:1,details:2,mood:3} as Partial<Record<Stage,number>>)[stage]||1;
  const turnstileSiteKey=false;
  const mountTurnstile=()=>undefined;
  const canVerify=true;

  useEffect(()=>{if(stage!=="generating")return;const a=window.setInterval(()=>setTick(current=>current<loadingSteps.length-1?current+1:current),LOADING_STEP_INTERVAL_MS);return()=>clearInterval(a)},[stage]);
  useEffect(()=>{
    setGeneratedSlices([]);
    setGeneratedSlicesSource("");
    if(!generatedImage)return;
    let cancelled=false;
    const image=new Image();
    image.crossOrigin="anonymous";
    image.onload=()=>{
      if(cancelled)return;
      const cellWidth=image.naturalWidth/3;
      const cellHeight=image.naturalHeight/4;
      const cell=document.createElement("canvas");
      const context=cell.getContext("2d");
      if(!context)return;
      const slices:string[]=[];
      for(let index=0;index<10;index++){
        const column=index===9?1:index%3;
        const row=Math.floor(index/3);
        const gutterX=cellWidth*.14;
        const gutterY=cellHeight*.14;
        const sourceX=Math.max(0,column*cellWidth-gutterX);
        const sourceY=Math.max(0,row*cellHeight-gutterY);
        const sourceRight=Math.min(image.naturalWidth,(column+1)*cellWidth+gutterX);
        const sourceBottom=Math.min(image.naturalHeight,(row+1)*cellHeight+gutterY);
        cell.width=Math.ceil(sourceRight-sourceX);
        cell.height=Math.ceil(sourceBottom-sourceY);
        context.drawImage(image,sourceX,sourceY,sourceRight-sourceX,sourceBottom-sourceY,0,0,cell.width,cell.height);
        slices.push(centerStickerArtwork(cell, Math.ceil(Math.max(cellWidth,cellHeight)*1.4)));
      }
      if(!cancelled){setGeneratedSlices(slices);setGeneratedSlicesSource(generatedImage)};
    };
    image.src=generatedImage;
    return()=>{cancelled=true};
  },[generatedImage]);

  // Resolve the signed-in user from the app-owned session cookie.
  useEffect(()=>{void fetch("/api/me").then(r=>r.json()).then((data)=>{const result=data as {user?:{email?:string}|null;isActiveMember?:boolean};if(result.user?.email){setSignedIn(true);setEmail(current=>current||result.user!.email!);setIsActiveMember(Boolean(result.isActiveMember))}}).catch(()=>undefined)},[]);

  useEffect(()=>{
    if(!signedIn||!isActiveMember||!generationJobId||!generatedImageKey)return;
    void fetch("/api/generations/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobId:generationJobId})})
      .then(response=>response.ok?response.json():Promise.reject())
      .catch(()=>undefined)
  },[signedIn,isActiveMember,generationJobId,generatedImageKey]);

  // Resolve the landing variant before first paint (the boot script in the
  // root layout hides the V1 hero until this runs), then fire landing_view so
  // the event always carries the resolved variant. trackOnce guards against
  // StrictMode double-mounts.
  useIsoLayoutEffect(()=>{
    const variant=readLandingVariant();
    setLandingVariant(variant);
    setLandingVariantState(current=>current===variant?current:variant);
    document.documentElement.classList.remove("landing-v2-boot");
    trackOnce("landing_view");
  },[]);

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- These mount-only effects restore state from browser URL and session storage. */
  // Land directly on the photo-upload step when arriving from an external
  // "make another sheet" link (e.g. the post-checkout success page).
  useEffect(()=>{
    if(new URLSearchParams(window.location.search).get("start")!=="upload")return;
    try{sessionStorage.removeItem("stickier-reveal")}catch{}
    setSkipPhotoStep(false);
    setStage("photos");
    window.history.replaceState({},"",window.location.pathname);
  },[]);

  // Restore a generated sheet after a sign-in redirect so subscribe can continue.
  // Slices are not stored; the effect above rebuilds them from generatedImage.
  useEffect(()=>{
    if(new URLSearchParams(window.location.search).get("session_id"))return;
    if(new URLSearchParams(window.location.search).get("recover_job"))return;
    let saved:{generatedImage?:string;generatedImageKey?:string;generationJobId?:string;product?:Product;name?:string;groupName?:string;pet?:{name:string;species:string};theme?:string;moods?:string[];email?:string};
    try{
      const raw=sessionStorage.getItem("stickier-reveal");
      if(!raw)return;
      saved=JSON.parse(raw);
    }catch{
      sessionStorage.removeItem("stickier-reveal");
      return;
    }
    if(!saved.generatedImageKey)return;
    queueMicrotask(()=>{
      setGeneratedImage(saved.generatedImage||"");
      setGeneratedImageKey(saved.generatedImageKey!);
      if(saved.generationJobId)setGenerationJobId(saved.generationJobId);
      if(saved.product)setProduct(saved.product);
      if(saved.name)setName(saved.name);
      if(saved.groupName)setGroupName(saved.groupName);
      if(saved.pet)setPet(saved.pet);
      if(saved.theme)setTheme(saved.theme);
      if(saved.moods)setMoods(saved.moods);
      if(saved.email)setEmail(current=>current||saved.email!);
      setStage("reveal");
    });
  },[]);

  useEffect(()=>{
    const jobId=new URLSearchParams(window.location.search).get("recover_job");
    if(!jobId||!/^[0-9a-f-]{36}$/i.test(jobId))return;
    let cancelled=false;
    let attempts=0;
    setGenerationError("");
    setStage("generating");
    const poll=async()=>{
      try{
        const response=await fetch(`/api/generation-status?jobId=${encodeURIComponent(jobId)}`);
        const status=await response.json() as {status?:string;imageKey?:string;previewUrl?:string;saved?:boolean;error?:string};
        if(cancelled)return;
        if(status.status==="succeeded"&&status.imageKey&&status.previewUrl){if(!status.saved)setIsActiveMember(false);setGeneratedImage(status.previewUrl);setGeneratedImageKey(status.imageKey);setGenerationSaved(Boolean(status.saved));setStage("reveal");window.history.replaceState({},"",window.location.pathname);return}
        if(status.status==="failed")throw new Error(status.error||"Generation failed.");
        if(attempts++<180){pollTimer.current=window.setTimeout(poll,2000);return}
        throw new Error("Generation is taking longer than expected. Please try again.");
      }catch(error){
        if(cancelled)return;
        setGenerationError(error instanceof Error?error.message:"Unable to recover this generation.");
        setStage("reveal");
      }
    };
    void poll();
    return()=>{cancelled=true;if(pollTimer.current)window.clearTimeout(pollTimer.current)};
  },[]);

  useEffect(()=>{
    if(!generatedImageKey)return;
    try{
      sessionStorage.setItem("stickier-reveal",JSON.stringify({generatedImage,generatedImageKey,generationJobId,product,name,groupName,pet,theme,moods,email}));
    }catch{
      // Ignore quota errors; sign-in can still proceed without restoring the sheet.
    }
  },[generatedImage,generatedImageKey,generationJobId,product,name,groupName,pet,theme,moods,email]);

  useEffect(()=>{const params=new URLSearchParams(window.location.search);const checkout=params.get("checkout");const sessionId=params.get("session_id");const cancelledImageKey=params.get("image_key");const restoreRevealFromSession=()=>{if(generatedImageKey){setStage("reveal");return true}try{const raw=sessionStorage.getItem("stickier-reveal");if(!raw)return false;const saved=JSON.parse(raw) as {generatedImage?:string;generatedImageKey?:string;product?:Product;name?:string;groupName?:string;pet?:{name:string;species:string};theme?:string;moods?:string[];email?:string};if(!saved.generatedImageKey)return false;setGeneratedImage(saved.generatedImage||`/api/preview-stickers?key=${encodeURIComponent(saved.generatedImageKey)}`);setGeneratedImageKey(saved.generatedImageKey);if(saved.product)setProduct(saved.product);if(saved.name)setName(saved.name);if(saved.groupName)setGroupName(saved.groupName);if(saved.pet)setPet(saved.pet);if(saved.theme)setTheme(saved.theme);if(saved.moods)setMoods(saved.moods);if(saved.email)setEmail(current=>current||saved.email!);setStage("reveal");return true}catch{sessionStorage.removeItem("stickier-reveal");return false}};const restoreRevealFromCancelledKey=(key:string|null)=>{if(!key)return false;if(!/^stickers\/.+\.png$/i.test(key))return false;setGeneratedImage(`/api/preview-stickers?key=${encodeURIComponent(key)}`);setGeneratedImageKey(key);setStage("reveal");return true};if(checkout==="cancelled"){const restored=restoreRevealFromSession()||restoreRevealFromCancelledKey(cancelledImageKey);if(!restored){setCheckoutNotice("Checkout was cancelled. Regenerate your preview to continue.")}else{queueMicrotask(()=>setCheckoutNotice("Checkout was cancelled. Your preview is still here if you want to try again."))}window.history.replaceState({},"",window.location.pathname);return}if(!sessionId){if(checkout)window.history.replaceState({},"",window.location.pathname);return}
    // Poll checkout-status until the webhook has recorded the order.
    let attempts=0;
    const poll=async()=>{
      try{
        const raw=await fetch(`/api/checkout-status?session_id=${encodeURIComponent(sessionId)}`).then(r=>r.json()) as {paid?:boolean;pending?:boolean;email?:string|null;downloadUrl?:string;plan?:"digital"|"physical"};
        if(!raw.paid){
          if(attempts++<10){pollTimer.current=window.setTimeout(poll,1500);return}
          setCheckoutNotice("We could not confirm that payment yet. If you were charged, check your email.");
          window.history.replaceState({},"",window.location.pathname);
          return;
        }
        startTransition(()=>{setStage("confirmation");setCheckoutSessionId(sessionId);if(raw.email)setEmail(raw.email);if(raw.plan)setPurchasedPlan(raw.plan);if(raw.downloadUrl)setDownloadUrl(raw.downloadUrl);trackOnce("purchase_completed",{plan:raw.plan},`purchase_completed:${sessionId}`)});
        window.history.replaceState({},"",window.location.pathname);
      }catch{
        setCheckoutNotice("We could not confirm that payment.");
        window.history.replaceState({},"",window.location.pathname);
      }
    };
    void poll();
    return()=>{if(pollTimer.current)window.clearTimeout(pollTimer.current)};
  },[]);
  useEffect(()=>{if(["photos","details","mood"].includes(stage))window.scrollTo({top:0,left:0,behavior:"auto"})},[stage]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  type Setter=(x:string[]|((prev:string[])=>string[]))=>void;
  const load=async(files:FileList|null,setter:Setter,setKeys:Setter,setData:Setter,current:string[],source?:"home"|"hero"|"wizard"|"reference")=>{
    if(!files)return;
    setPhotoError("");
    const chosen=Array.from(files).slice(0,MAX_PHOTOS-current.length);
    if(!chosen.length)return;
    track("photo_selected",{number_of_photos:chosen.length,source});
    setPhotoBusy(true);
    let selected:File[];
    try{
      const {photos:normalized,errors}=await normalizePhotos(chosen);
      if(errors.length)setPhotoError(errors.join(" "));
      selected=normalized;
    }finally{
      setPhotoBusy(false);
    }
    if(!selected.length)return;
    const previews=await Promise.all(selected.map(file=>new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(file)})));
    setter(prev=>[...prev,...previews]);
    track("upload_started",{number_of_photos:selected.length,source});
    let uploaded=0;
    for(const file of selected){
      const result=await uploadPhoto(file);
      if(result.key){setKeys(prev=>[...prev,result.key!]);uploaded++}
      else if(result.dataUrl){setData(prev=>[...prev,result.dataUrl!]);uploaded++}
    }
    track("upload_completed",{number_of_photos:uploaded,source});
  };
  const removeMainPhoto=(index:number)=>{const remaining=photos.filter((_,i)=>i!==index);setPhotos(remaining);setPhotoKeys([]);setPhotoDataUrls(remaining)};
  const removeReferencePhoto=(index:number)=>{const remaining=referencePhotos.filter((_,i)=>i!==index);setReferencePhotos(remaining);setReferencePhotoKeys([]);setReferencePhotoDataUrls(remaining)};

  // Submit the generation job, then poll for completion instead of holding the
  // connection open for the full OpenAI call.
  const generate=async()=>{
    setTick(0);setGenerationError("");setStage("generating");
    track("preview_started");
    try{
      const keys=[...photoKeys,...referencePhotoKeys];
      const dataUrls=[...photoDataUrls,...referencePhotoDataUrls];
      const response=await fetch("/api/generate-stickers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoKeys:keys,photos:dataUrls,subject,product,companion:"skip",species:pet.species,theme,moods,specialRequest})});
      const data=await response.json() as {jobId?:string;error?:string};
      if(!response.ok||!data.jobId)throw new Error(data.error||"Unable to start generation.");
      const jobId=data.jobId;
      setGenerationJobId(jobId);
      let attempts=0;
      const poll=async()=>{
        try{
          const status=await fetch(`/api/generation-status?jobId=${encodeURIComponent(jobId)}`).then(r=>r.json()) as {status?:string;imageKey?:string;previewUrl?:string;saved?:boolean;error?:string};
          if(status.status==="succeeded"&&status.imageKey&&status.previewUrl){
            if(!status.saved)setIsActiveMember(false);setGeneratedImage(status.previewUrl);setGeneratedImageKey(status.imageKey);setGenerationSaved(Boolean(status.saved));setStage("reveal");track("preview_rendered");return;
          }
          if(status.status==="failed")throw new Error(status.error||"Generation failed.");
          if(attempts++<180){pollTimer.current=window.setTimeout(poll,2000);return}
          throw new Error("Generation is taking longer than expected. Please try again.");
        }catch(error){
          setGenerationError(error instanceof Error?error.message:"Unable to generate stickers.");setStage("reveal");
        }
      };
      void poll();
    }catch(error){
      setGenerationError(error instanceof Error?error.message:"Unable to generate stickers.");setStage("reveal");
    }
  };

  const restart=()=>{try{sessionStorage.removeItem("stickier-reveal")}catch{}setPhotos([]);setPhotoKeys([]);setPhotoDataUrls([]);setReferencePhotos([]);setReferencePhotoKeys([]);setReferencePhotoDataUrls([]);setSpecialRequest("");setMoods([]);setGeneratedImage("");setGeneratedImageKey("");setGenerationJobId("");setGeneratedSlices([]);setGeneratedSlicesSource("");setGenerationError("");setCheckoutSessionId("");setDownloadUrl("");setCheckoutNotice("");setCheckoutError("");setPaymentOpen(false);setSkipPhotoStep(false);setStage("home")};
  // Content-policy rejections likely mean the photo or text was the problem, so
  // send the user back to the photo step with a clean slate rather than mood/details.
  const tryAgainAfterModeration=()=>{try{sessionStorage.removeItem("stickier-reveal")}catch{}setPhotos([]);setPhotoKeys([]);setPhotoDataUrls([]);setReferencePhotos([]);setReferencePhotoKeys([]);setReferencePhotoDataUrls([]);setSpecialRequest("");setMoods([]);setGeneratedImage("");setGeneratedImageKey("");setGenerationJobId("");setGeneratedSlices([]);setGeneratedSlicesSource("");setGenerationError("");setSkipPhotoStep(false);setStage("photos")};
  const beginAnotherSheet=()=>{try{sessionStorage.removeItem("stickier-reveal")}catch{}setPhotos([]);setPhotoKeys([]);setPhotoDataUrls([]);setReferencePhotos([]);setReferencePhotoKeys([]);setReferencePhotoDataUrls([]);setSpecialRequest("");setMoods([]);setGeneratedImage("");setGeneratedImageKey("");setGenerationJobId("");setGeneratedSlices([]);setGeneratedSlicesSource("");setGenerationError("");setCheckoutSessionId("");setDownloadUrl("");setCheckoutNotice("");setCheckoutError("");setPaymentOpen(false);setSkipPhotoStep(false);setProduct("me");setName("");setGroupName("");setPet({name:"",species:"Dog"});setTheme("Classic");setStage("photos")};
  const toggleMood=(mood:string)=>setMoods(current=>current.includes(mood)?current.filter(item=>item!==mood):[...current,mood]);
  const openPayment=()=>{if(isActiveMember)return;setPaymentPlan(null);setCheckoutError("");setPaymentOpen(true)};
  const startCheckout=async()=>{if(paymentPlan!=="digital"&&paymentPlan!=="physical"){setCheckoutError("Choose a sticker option first.");return}if(!generatedImageKey){setCheckoutError("Generate a sticker sheet first.");return}setCheckoutLoading(true);setCheckoutError("");track("checkout_started",{plan:paymentPlan});try{const response=await fetch("/api/create-checkout-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject,imageKey:generatedImageKey,plan:paymentPlan})});const data=await readCheckoutResponse(response);if(!response.ok||!data.url)throw new Error(data.error||"Unable to start checkout.");window.location.assign(data.url)}catch(error){setCheckoutError(error instanceof Error?error.message:"Unable to start checkout.");setCheckoutLoading(false)}};
  const startSubscription=()=>{if(!generatedImageKey){setCheckoutError("Generate a sticker sheet first.");return}setSubscriptionLoading(true);setCheckoutError("");track("checkout_started",{plan:"membership"});const params=new URLSearchParams({image_key:generatedImageKey,subject,source:"purchase-modal"});window.location.assign(`/membership/checkout?${params}`)};
  const back:Partial<Record<Stage,Stage>>={photos:"home",details:skipPhotoStep?"home":"photos",mood:"details",reveal:"mood"};
  const confirmationSheetSrc = checkoutSessionId
    ? `/api/download-stickers?session_id=${encodeURIComponent(checkoutSessionId)}`
    : downloadUrl || generatedImage || "/sticker-sheet.png";
  const moderationBlocked = generationError === CONTENT_POLICY_MESSAGE;
  return <main className={`shell ${stage}${isV2Home?" landing-v2":""}`}><div className="grain"/>{stage!=="confirmation"&&<nav><button className="logo" onClick={restart}>SALTY STICKER<sup>™</sup></button><span aria-hidden="true"/><div className="nav-end">{signedIn ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="nav-account-trigger">SALTY STICKER CLUB <ChevronDown size={12} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="nav-account-menu">
        <a className="nav-account-menu-item" href="/account">Dashboard</a>
        <form action="/api/auth/signout" method="post" className="nav-account-signout-form" onSubmit={()=>posthog.reset()}>
          <button type="submit" className="nav-account-menu-item nav-account-signout-button">Sign out</button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : <a className="nav-account" href="/signin?return_to=/account">LOGIN</a>}<button className="nav-cta" onClick={()=>{
    if(stage==="home"&&landingVariant==="v2"){track("header_upload_click");if(heroFileInputRef.current){heroFileInputRef.current.click();return}}
    if(stage==="home"||stage==="samples"){setSkipPhotoStep(false);setStage("photos")}else{restart()}
  }}>{stage==="home"||stage==="samples"?(landingVariant==="v2"?"MAKE STICKERS":"CREATE MY STICKERS"):"EXIT STUDIO"}</button></div></nav>}
  {checkoutNotice&&<p className="checkout-notice" role="status">{checkoutNotice}</p>}

  {stage==="home"&&landingVariant==="v2"&&<LandingV2 photos={photos} photoBusy={photoBusy} photoError={photoError} fileInputRef={heroFileInputRef} onFiles={files=>load(files,setPhotos,setPhotoKeys,setPhotoDataUrls,photos,"hero")} onRemove={removeMainPhoto} onContinue={()=>{setProduct("me");setSkipPhotoStep(true);setStage("details")}}/>}
  {stage==="home"&&landingVariant==="v1"&&<section className="split enter"><div className="copy home-copy"><h1><span>Turn your photo</span><span>into 10 custom stickers.</span></h1><p>Upload yourself, your pet, or anything you love. We’ll turn it into 10 unique stickers.</p><div className="home-proof">NO PAYMENT REQUIRED</div><div className="home-upload"><UploadBox previews={photos} onChange={(files)=>{load(files,setPhotos,setPhotoKeys,setPhotoDataUrls,photos,"home"); if (files && files.length > 0) { setProduct("me"); setSkipPhotoStep(false); setStage("details"); } }} onRemove={removeMainPhoto}/></div>{photos.length>0&&<div className="home-cta"><Button className="red-btn" onClick={()=>{setProduct("me");setSkipPhotoStep(true);setStage("details")}}>CREATE MY STICKERS <ArrowRight/></Button></div>}<div className="v2-social-proof"><span className="v2-social-stars" aria-hidden="true">{Array.from({length:5}).map((_,index)=><Star key={index} size={14} fill="currentColor" strokeWidth={0}/>)}</span><span className="v2-social-text">Loved by <b>150K+</b> users</span></div></div><div className="art hero-story"><div className="hero-story-composite" role="img" aria-label="A candid Polaroid of a brunette woman with her puppy transforming into ten soft illustrated stickers"><img className="hero-story-slice hero-polaroid" src="/sticker-reference-locked-hero-v12.webp" alt=""/><img className="hero-arrow-cutout" src="/curved-arrow-transparent-v14.png" alt=""/><img className="hero-story-slice hero-sheet" src="/sticker-reference-locked-hero-v12.webp" alt=""/></div><div className="tag t1">YOUR PHOTO</div><div className="tag t2">YOUR STICKERS</div><div className="burst">10<small>STICKERS</small></div></div></section>}

  {stage==="samples"&&<section className="samples-page enter"><header className="samples-head"><h2>See what gets<br/><em>stuck.</em></h2><p>Every sheet includes ten one-of-one stickers.</p></header><div className="sample-grid clean">{samples.map((sample,i)=><article className="sample-card" key={sample}><div className="sample-sheet"><div><span>SALTY STICKER™</span><small>{sample} / 06</small></div><img src="/sticker-sheet.png" alt={`Sticker sheet sample ${i+1} with ten stickers`}/><footer>10 STICKERS · ONE OF ONE</footer></div></article>)}</div></section>}

  {["photos","details","mood"].includes(stage)&&<section className="wizard enter"><aside><div className="wizard-visual" aria-hidden="true"><div className="wizard-photo-stack">{photos.length ? photos.slice(0,3).map((photo,index,array)=><figure key={`${photo}-${index}`} className={`wizard-photo-card wizard-photo-${index} ${array.length>1?"stacked":""}`}><img src={photo} alt=""/></figure>) : <figure className="wizard-photo-card wizard-photo-empty"><span>YOUR PHOTO</span></figure>}</div><svg className="wizard-arrow" viewBox="0 0 140 120" role="presentation" aria-hidden="true"><path d="M12 96C31 78 49 83 54 98C61 119 25 116 30 91C38 51 88 56 126 20"/><path d="M110 20L127 19L123 37"/></svg><div className="wizard-sheet-mock"><header><b>SALTY STICKER™</b><span>01 / 01</span></header><div className="wizard-sheet-silhouettes">{Array.from({length:10},(_,index)=><span className={`shape-${index+1}`} key={index}/>)}</div><footer>ONE OF ONE · MADE FOR YOU</footer></div></div></aside><div className="wizard-main"><div className="wizard-rail">{back[stage]&&<button className="back" onClick={()=>back[stage]==="home"?restart():setStage(back[stage]!)}><ArrowLeft/> BACK</button>}<Progress n={currentStep} total={total}/></div>
  {stage==="photos"&&<div className="wizard-content"><Progress n={1} total={total}/><h3>Add your photos.</h3><p>Choose up to 3 clear photos of whoever belongs in your sticker pack.</p><UploadBox previews={photos} onChange={files=>load(files,setPhotos,setPhotoKeys,setPhotoDataUrls,photos,"wizard")} onRemove={removeMainPhoto}/>{photoBusy&&<p className="upload-status">Converting your photo…</p>}{photoError&&<p className="upload-error">{photoError}</p>}<div className="wizard-actions"><span/><Button className="red-btn" disabled={photos.length===0} onClick={()=>{setSkipPhotoStep(false);setStage("details")}}>NEXT <ArrowRight/></Button></div></div>}
  {stage==="details"&&<div className="wizard-content details"><Progress n={2} total={total}/><h3>Any details you want us to include?</h3><label className="request-box"><textarea value={specialRequest} onChange={e=>setSpecialRequest(e.target.value)} maxLength={500} placeholder="Tell us anything you want included…"/><small>{requestExample}</small></label><ReferencePhotos previews={referencePhotos} onChange={files=>load(files,setReferencePhotos,setReferencePhotoKeys,setReferencePhotoDataUrls,referencePhotos,"reference")} onRemove={removeReferencePhoto}/><div className="wizard-actions"><span/><Button className="red-btn" onClick={()=>setStage("mood")}>NEXT <ArrowRight/></Button></div></div>}
  {stage==="mood"&&<div className="wizard-content mood-content"><Progress n={3} total={total}/><h3>What&apos;s the mood?</h3><div className="mood-options">{moodOptions.map(mood=><button className={moods.includes(mood)?"selected":""} aria-pressed={moods.includes(mood)} key={mood} onClick={()=>toggleMood(mood)}><b>{mood}</b>{moods.includes(mood)&&<Check/>}</button>)}</div><div className="wizard-actions"><span/><Button className="red-btn" onClick={generate}>GENERATE <Sparkles/></Button></div></div>}
  </div></section>}

  {stage==="generating"&&<section className="generate loading-state enter"><div className="printer" aria-label="Blank sticker sheet printing"><div className="printer-top"><span/><span/><span/></div><div className="paper"><GenericStickerSheet/></div><div className="printer-slot"/></div><div className="generate-copy loading-copy"><h2>Your stickers are coming to life.</h2><strong>Usually ready in about 1 minute</strong><ol className="loading-steps">{loadingSteps.map((step,index)=><li className={index<tick?"complete":index===tick?"active":"upcoming"} key={step}>{index<tick?<span>✓</span>:index===tick?<span className="loading-spinner"/>:<span>○</span>}{index===tick?<b>{step}</b>:step}</li>)}</ol><b className="hang-tight">Hang tight — don&apos;t refresh.</b></div></section>}
  {stage==="reveal"&&moderationBlocked&&<section className="reveal-page enter moderation-error"><div className="moderation-error-body"><h2>We couldn&apos;t create your stickers</h2><p role="alert">{generationError}</p><Button className="red-btn" onClick={tryAgainAfterModeration}>TRY AGAIN <ArrowRight/></Button></div></section>}
  {stage==="reveal"&&!moderationBlocked&&<section className="reveal-page enter"><div className="reveal-head"><div><h2>{isActiveMember?"We've added them to your creations!":<>Your sticker<br/>sheet <span className="reveal-ready-line">is ready!</span></>}</h2>{isActiveMember?<p>These are included in your subscription.</p>:null}{generationError&&<p role="alert">{generationError}</p>}{checkoutError&&<p role="alert">{checkoutError}</p>}</div><div className="reveal-side">{isActiveMember?<div className="member-reveal-saved"><a className="member-download-primary" href={`/api/download-stickers?image_key=${encodeURIComponent(generatedImageKey)}`} download><Download/> DOWNLOAD STICKERS</a><a className="member-portal-secondary" href="/account">RETURN TO PORTAL <ArrowRight/></a></div>:<><div className="reveal-actions"><Button className="red-btn" onClick={openPayment} disabled={Boolean(generationError)}>GET MY STICKERS <ArrowRight/></Button></div>{paymentOpen&&turnstileSiteKey&&!generationError&&generatedImageKey?<div ref={mountTurnstile} className="turnstile-widget reveal-turnstile"/>:null}</>}</div></div><div className="reveal-body"><div className="sticker-grid">{positions.map((pos,i)=><div className={`sticker-tile ${i===9?"sticker-tile-last":""}`} key={i}><span>{String(i+1).padStart(2,"0")}</span><div className="sticker-image" style={generatedSlices[i]?{backgroundImage:`url(${generatedSlices[i]})`,backgroundSize:"contain",backgroundPosition:"center",backgroundRepeat:"no-repeat"}:{backgroundImage:`url(${generatedImage||"/sticker-sheet.png"})`,backgroundPosition:pos,backgroundSize:"300% 400%",backgroundRepeat:"no-repeat"}}/><small className="cell-watermark cell-watermark-one" aria-hidden="true">SALTY STICKER · PREVIEW</small><small className="cell-watermark cell-watermark-two" aria-hidden="true">SALTY STICKER · PREVIEW</small><small className="cell-watermark cell-watermark-three" aria-hidden="true">SALTY STICKER · PREVIEW</small></div>)}</div><aside className="full-sheet-preview"><article className="reveal-sheet-card"><header><span>SALTY STICKER™</span><b>01 / 01</b></header><img src={generatedImage||"/sticker-sheet.png"} alt={`${subject}'s full sticker sheet`} onError={event=>{event.currentTarget.src="/sticker-sheet.png"}}/><footer>ONE OF ONE · MADE FOR YOU</footer></article></aside></div></section>}
  {stage==="confirmation"&&<section className="confirmation enter"><div className="check"><Check/></div><div className="eyebrow">PURCHASE COMPLETE</div><h2>{purchasedPlan==="physical"?"Your stickers are officially yours":"They’re yours"}</h2>{purchasedPlan==="physical"?<><p><b>Your physical sticker pack is being made.</b></p><p>Your digital stickers are ready now, and we sent a copy to <b>{email||"your email"}</b>. You can also download your sticker sheet now.</p></>:<p>We sent a copy to <b>{email||"your email"}</b>. You can also download your sticker sheet now.</p>}<Sheet name={subject} className="confirmation-sheet" clean src={confirmationSheetSrc}/><div className="confirmation-actions"><a className="download-btn" href={checkoutSessionId?`/api/download-stickers?session_id=${encodeURIComponent(checkoutSessionId)}`:downloadUrl||"#"} aria-disabled={!checkoutSessionId&&!downloadUrl} download><Download/> DOWNLOAD STICKERS</a><Button className="link" onClick={beginAnotherSheet}>MAKE ANOTHER <ArrowRight/></Button></div></section>}

  <Dialog open={!isActiveMember&&paymentOpen} onOpenChange={setPaymentOpen}><DialogContent className="payment-modal">
    <><DialogHeader><DialogTitle>How do you want your stickers?</DialogTitle></DialogHeader><div className="purchase-options"><button type="button" className={paymentPlan==="digital"?"selected":""} onClick={()=>setPaymentPlan("digital")}><span className="purchase-card-top"><span className="purchase-icon"><Download/></span></span><b>DIGITAL</b><strong className="purchase-price">$4.99</strong><ul><li>10 transparent PNG stickers</li><li>Full sticker-sheet PNG</li><li><strong>Instant download</strong></li></ul></button><button type="button" className={paymentPlan==="physical"?"selected":""} onClick={()=>setPaymentPlan("physical")}><span className="purchase-card-top"><span className="purchase-icon"><Package/></span><em>★ MOST POPULAR</em></span><b>PHYSICAL + DIGITAL</b><strong className="purchase-price">$9.99</strong><ul><li>10 waterproof die-cut stickers</li><li>Digital pack included</li><li><strong>Free shipping</strong></li></ul></button><button type="button" className={`membership-upsell ${paymentPlan==="membership"?"selected":""}`} onClick={()=>setPaymentPlan("membership")}><span className="purchase-card-top"><span className="purchase-icon"><Sparkles/></span><span className="membership-free">Today's physical + digital sticker sheet free</span></span><b>SALTY STICKER CLUB</b><strong className="purchase-price"><s className="purchase-price-was">$19.99</s> $11.99/mo</strong><ul><li>20 sticker generations, unlimited downloads</li><li>1 regeneration per sticker</li><li>Pick 2 to receive at your doorstep every month</li><li>Free shipping</li><li><strong>Cancel anytime</strong></li></ul></button></div>{checkoutError&&<p role="alert">{checkoutError}</p>}<Button className="black-btn pay-card" disabled={!paymentPlan||paymentPlan==="membership"?(subscriptionLoading||!canVerify||!paymentPlan):(checkoutLoading||!canVerify)} onClick={()=>paymentPlan==="membership"?void startSubscription():void startCheckout()}>{!paymentPlan?"CHOOSE A STICKER OPTION":(subscriptionLoading||checkoutLoading)?"OPENING…":"CHECKOUT"} <ArrowRight/></Button></>
  </DialogContent></Dialog>
  </main>;
}
