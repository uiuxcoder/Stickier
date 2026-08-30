"use client";

import { ChangeEvent, DragEvent, startTransition, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, ImagePlus, PawPrint, Sparkles, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { normalizePhoto, UnsupportedPhotoError } from "@/lib/photo-normalize";

type Stage = "home" | "samples" | "photos" | "details" | "mood" | "generating" | "reveal" | "confirmation";
type Product = "me" | "pet" | "partner" | "family";
const loadingSteps = ["Getting to know your photo", "Picking up the details", "Bringing your stickers to life...", "Adding the finishing touches"];
const positions = ["0% 0%", "50% 0%", "100% 0%", "0% 34%", "50% 34%", "100% 34%", "0% 68%", "50% 68%", "100% 68%", "50% 100%"];
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

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

// Shared across every widget mount so the API script is only appended once.
let turnstileScript: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileScript) {
    turnstileScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        turnstileScript = null;
        reject(new Error("Turnstile failed to load."));
      };
      document.head.appendChild(script);
    });
  }
  return turnstileScript;
}

function Sheet({ name, className = "", clean = false, src = "/latest-dog-person-sticker-sheet-v13.webp" }: { name: string; className?: string; clean?: boolean; src?: string }) {
  return <div className={`sheet ${className} ${clean?"clean-sheet":""}`}>{!clean&&<div className="sheet-head"><b>{name.toUpperCase()}&apos;S ERA</b><span>01 / 01</span></div>}<img src={src} alt={`${name}'s custom sticker sheet`} />{!clean&&<div className="sheet-foot">ONE OF ONE · MADE FOR YOU ✦</div>}</div>;
}
function Progress({ n, total }: { n: number; total: number }) {
  return <div className="wizard-progress"><span>STEP {String(n).padStart(2,"0")} / {String(total).padStart(2,"0")}</span><div><i style={{width:`${n/total*100}%`}}/></div></div>;
}
function UploadBox({ previews, pet=false, onChange, onRemove }: { previews:string[]; pet?:boolean; onChange:(f:FileList|null)=>void; onRemove:(index:number)=>void }) {
  const drop=(e:DragEvent<HTMLLabelElement>)=>{e.preventDefault();e.currentTarget.classList.remove("dragging");onChange(e.dataTransfer.files)};
  return <label className="upload-zone" onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("dragging")}} onDragLeave={e=>e.currentTarget.classList.remove("dragging")} onDrop={drop}><input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif" multiple disabled={previews.length>=MAX_PHOTOS} onChange={(e:ChangeEvent<HTMLInputElement>)=>{onChange(e.target.files);e.currentTarget.value=""}}/><div className="upload-icon">{pet?<PawPrint/>:<ImagePlus/>}</div><b>{previews.length?`✓ ${previews.length} PHOTO${previews.length>1?"S":""} ADDED`:"DROP YOUR PHOTOS HERE"}</b><span><Upload size={15}/>{previews.length===0?"UPLOAD PHOTOS":previews.length<MAX_PHOTOS?"ADD ANOTHER PHOTO":"3 PHOTO LIMIT"}</span>{previews.length>0&&<div className="preview-row">{previews.map((src,index)=><div className="preview-item" key={src}><img src={src} alt={`Upload ${index+1}`}/><button type="button" aria-label={`Delete photo ${index+1}`} onClick={event=>{event.preventDefault();event.stopPropagation();onRemove(index)}}><Trash2/></button></div>)}</div>}</label>;
}
function GenericStickerSheet() {
  return <div className="printer-placeholder-grid" aria-label="Ten empty sticker placeholders">{Array.from({length:10},(_,index)=><span key={index}/>)}</div>;
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
  const [paymentPlan,setPaymentPlan]=useState<"digital"|"physical"|"membership">("physical");
  const [email,setEmail]=useState("");
  const [signedIn,setSignedIn]=useState(false);
  const [checkoutNotice,setCheckoutNotice]=useState("");
  const [checkoutError,setCheckoutError]=useState("");
  const [checkoutLoading,setCheckoutLoading]=useState(false);
  const [subscriptionLoading,setSubscriptionLoading]=useState(false);
  const [checkoutSessionId,setCheckoutSessionId]=useState("");
  const [downloadUrl,setDownloadUrl]=useState("");
  const [purchasedPlan,setPurchasedPlan]=useState<"digital"|"physical">("digital");
  const [generatedImage,setGeneratedImage]=useState("");
  const [generatedImageKey,setGeneratedImageKey]=useState("");
  const [generatedSlices,setGeneratedSlices]=useState<string[]>([]);
  const [generationError,setGenerationError]=useState("");
  const [tick,setTick]=useState(0);
  const [turnstileToken,setTurnstileToken]=useState("");
  const turnstileWidgetId=useRef<string|undefined>(undefined);
  const pollTimer=useRef<number|undefined>(undefined);

  const subject=product==="pet"?(pet.name||"Your pet"):product==="partner"?(groupName||"My partner"):product==="family"?(groupName||"Family & friends"):(name||"You");
  const total=3;
  const requestExample='Examples: “Put us in Halloween costumes,” “Give my plant a cute pot.”';
  const currentStep=({photos:1,details:2,mood:3} as Partial<Record<Stage,number>>)[stage]||1;
  const turnstileSiteKey=process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const isLocalDev=typeof window!=="undefined"&&["localhost","127.0.0.1"].includes(window.location.hostname);

  useEffect(()=>{if(stage!=="generating")return;const a=window.setInterval(()=>setTick(x=>Math.min(x+1,3)),2200);return()=>clearInterval(a)},[stage]);
  useEffect(()=>{if(!generatedImage)return;const image=new Image();image.crossOrigin="anonymous";image.onload=()=>{const slices:string[]=[];for(let index=0;index<10;index++){const column=index===9?1:index%3;const row=Math.floor(index/3);const canvas=document.createElement("canvas");canvas.width=image.naturalWidth/3;canvas.height=image.naturalHeight/4;canvas.getContext("2d")?.drawImage(image,column*canvas.width,row*canvas.height,canvas.width,canvas.height,0,0,canvas.width,canvas.height);slices.push(canvas.toDataURL("image/png"))}setGeneratedSlices(slices)};image.src=generatedImage},[generatedImage]);

  // Resolve the signed-in user from the app-owned session cookie.
  useEffect(()=>{void fetch("/api/me").then(r=>r.json()).then((data)=>{const user=(data as {user?:{email?:string}|null}).user;if(user?.email){setSignedIn(true);setEmail(current=>current||user.email!)}}).catch(()=>undefined)},[]);

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
    let saved:{generatedImage?:string;generatedImageKey?:string;product?:Product;name?:string;groupName?:string;pet?:{name:string;species:string};theme?:string;moods?:string[];email?:string};
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
    if(!generatedImageKey)return;
    try{
      sessionStorage.setItem("stickier-reveal",JSON.stringify({generatedImage,generatedImageKey,product,name,groupName,pet,theme,moods,email}));
    }catch{
      // Ignore quota errors; sign-in can still proceed without restoring the sheet.
    }
  },[generatedImage,generatedImageKey,product,name,groupName,pet,theme,moods,email]);

  // A callback ref, not an effect: the widget container only exists on the
  // stages that need a token, so mounting has to follow the container rather
  // than run once when the page loads. Each mount issues its own token, which
  // keeps the single-use tokens for generation and for checkout distinct.
  const mountTurnstile=useCallback((node:HTMLDivElement|null)=>{
    if(!turnstileSiteKey)return;
    if(!node){
      if(turnstileWidgetId.current&&window.turnstile)window.turnstile.remove(turnstileWidgetId.current);
      turnstileWidgetId.current=undefined;
      setTurnstileToken("");
      return;
    }
    void loadTurnstile().then(()=>{
      if(!window.turnstile||turnstileWidgetId.current||!node.isConnected)return;
      turnstileWidgetId.current=window.turnstile.render(node,{sitekey:turnstileSiteKey,callback:(token:string)=>setTurnstileToken(token),"expired-callback":()=>setTurnstileToken("")});
    }).catch(()=>setGenerationError("We could not load the human-verification widget. Please refresh and try again."));
  },[turnstileSiteKey]);

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
        startTransition(()=>{setStage("confirmation");setCheckoutSessionId(sessionId);if(raw.email)setEmail(raw.email);if(raw.plan)setPurchasedPlan(raw.plan);if(raw.downloadUrl)setDownloadUrl(raw.downloadUrl);});
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

  type Setter=(x:string[]|((prev:string[])=>string[]))=>void;
  const load=async(files:FileList|null,setter:Setter,setKeys:Setter,setData:Setter,current:string[])=>{
    if(!files)return;
    setPhotoError("");
    const chosen=Array.from(files).slice(0,MAX_PHOTOS-current.length);
    if(!chosen.length)return;
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
    for(const file of selected){
      const result=await uploadPhoto(file);
      if(result.key)setKeys(prev=>[...prev,result.key!]);
      else if(result.dataUrl)setData(prev=>[...prev,result.dataUrl!]);
    }
  };
  const removeMainPhoto=(index:number)=>{const remaining=photos.filter((_,i)=>i!==index);setPhotos(remaining);setPhotoKeys([]);setPhotoDataUrls(remaining)};
  const removeReferencePhoto=(index:number)=>{const remaining=referencePhotos.filter((_,i)=>i!==index);setReferencePhotos(remaining);setReferencePhotoKeys([]);setReferencePhotoDataUrls(remaining)};

  // Submit the generation job, then poll for completion instead of holding the
  // connection open for the full OpenAI call.
  const generate=async()=>{
    setTick(0);setGenerationError("");setStage("generating");
    try{
      const keys=[...photoKeys,...referencePhotoKeys];
      const dataUrls=[...photoDataUrls,...referencePhotoDataUrls];
      const response=await fetch("/api/generate-stickers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoKeys:keys,photos:dataUrls,subject,product,companion:"skip",species:pet.species,theme,moods,specialRequest,turnstileToken})});
      const data=await response.json() as {jobId?:string;error?:string};
      if(!response.ok||!data.jobId)throw new Error(data.error||"Unable to start generation.");
      const jobId=data.jobId;
      let attempts=0;
      const poll=async()=>{
        try{
          const status=await fetch(`/api/generation-status?jobId=${encodeURIComponent(jobId)}`).then(r=>r.json()) as {status?:string;imageKey?:string;previewUrl?:string;error?:string};
          if(status.status==="succeeded"&&status.imageKey&&status.previewUrl){
            setGeneratedImage(status.previewUrl);setGeneratedImageKey(status.imageKey);setStage("reveal");return;
          }
          if(status.status==="failed")throw new Error(status.error||"Generation failed.");
          if(attempts++<90){pollTimer.current=window.setTimeout(poll,2000);return}
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

  const restart=()=>{try{sessionStorage.removeItem("stickier-reveal")}catch{}setPhotos([]);setPhotoKeys([]);setPhotoDataUrls([]);setReferencePhotos([]);setReferencePhotoKeys([]);setReferencePhotoDataUrls([]);setSpecialRequest("");setMoods([]);setGeneratedImage("");setGeneratedImageKey("");setGeneratedSlices([]);setGenerationError("");setCheckoutSessionId("");setDownloadUrl("");setCheckoutNotice("");setCheckoutError("");setPaymentOpen(false);setSkipPhotoStep(false);setStage("home")};
  const beginAnotherSheet=()=>{try{sessionStorage.removeItem("stickier-reveal")}catch{}setPhotos([]);setPhotoKeys([]);setPhotoDataUrls([]);setReferencePhotos([]);setReferencePhotoKeys([]);setReferencePhotoDataUrls([]);setSpecialRequest("");setMoods([]);setGeneratedImage("");setGeneratedImageKey("");setGeneratedSlices([]);setGenerationError("");setCheckoutSessionId("");setDownloadUrl("");setCheckoutNotice("");setCheckoutError("");setPaymentOpen(false);setSkipPhotoStep(false);setProduct("me");setName("");setGroupName("");setPet({name:"",species:"Dog"});setTheme("Classic");setStage("photos")};
  const toggleMood=(mood:string)=>setMoods(current=>current.includes(mood)?current.filter(item=>item!==mood):[...current,mood]);
  const openPayment=()=>{setPaymentPlan("physical");setCheckoutError("");setPaymentOpen(true)};
  const startCheckout=async()=>{setCheckoutLoading(true);setCheckoutError("");try{const response=await fetch("/api/create-checkout-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject,imageKey:generatedImageKey,plan:paymentPlan,turnstileToken})});const data=await response.json() as {url?:string;error?:string};if(!response.ok||!data.url)throw new Error(data.error||"Unable to start checkout.");window.location.assign(data.url)}catch(error){setCheckoutError(error instanceof Error?error.message:"Unable to start checkout.");setCheckoutLoading(false)}};
  const startSubscription=async()=>{if(!generatedImageKey){setCheckoutError("Generate a sticker sheet first.");return}setSubscriptionLoading(true);setCheckoutError("");try{const response=await fetch("/api/create-subscription-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject,imageKey:generatedImageKey,turnstileToken})});const data=await response.json() as {url?:string;error?:string};if(!response.ok||!data.url)throw new Error(data.error||"Unable to start subscription.");window.location.assign(data.url)}catch(error){setCheckoutError(error instanceof Error?error.message:"Unable to start subscription.");setSubscriptionLoading(false)}};
  const back:Partial<Record<Stage,Stage>>={photos:"home",details:skipPhotoStep?"home":"photos",mood:"details",reveal:"mood"};
  const confirmationSheetSrc = checkoutSessionId
    ? `/api/download-stickers?session_id=${encodeURIComponent(checkoutSessionId)}`
    : downloadUrl || generatedImage || "/sticker-sheet.png";
  // Turnstile tokens are single-use, so every gated action needs its own live
  // token from the widget mounted on that stage.
  const canVerify=isLocalDev?true:(turnstileSiteKey?Boolean(turnstileToken):true);
  const canGenerate=canVerify;

  return <main className={`shell ${stage}`}><div className="grain"/>{stage!=="confirmation"&&<nav><button className="logo" onClick={restart}>STICKIER<sup>™</sup></button><span aria-hidden="true"/><div className="nav-end">{signedIn?<a className="nav-account" href="/account">ACCOUNT</a>:<a className="nav-account" href="/signin">SIGN IN</a>}<button className="nav-cta" onClick={()=>stage==="home"||stage==="samples"?(setSkipPhotoStep(false),setStage("photos")):restart()}>{stage==="home"||stage==="samples"?"CREATE MINE":"EXIT STUDIO"}</button></div></nav>}
  {checkoutNotice&&<p className="checkout-notice" role="status">{checkoutNotice}</p>}

  {stage==="home"&&<section className="split enter"><div className="copy home-copy"><h1><span>Any photo. <em>Any idea.</em></span><span>Turned into stickers.</span></h1><p>You, your people, your pets, and your little obsessions turned into custom stickers.</p><div className="home-proof">10 CUSTOM STICKERS · PREVIEW BEFORE YOU BUY</div><div className="home-upload"><UploadBox previews={photos} onChange={files=>load(files,setPhotos,setPhotoKeys,setPhotoDataUrls,photos)} onRemove={removeMainPhoto}/></div>{photos.length>0&&<div className="home-cta"><Button className="red-btn" onClick={()=>{setProduct("me");setSkipPhotoStep(true);setStage("details")}}>MAKE MY STICKERS <ArrowRight/></Button></div>}</div><div className="art hero-story"><div className="hero-story-composite" role="img" aria-label="A candid Polaroid of a brunette woman with her puppy transforming into ten soft illustrated stickers"><img className="hero-story-slice hero-polaroid" src="/sticker-reference-locked-hero-v12.webp" alt=""/><img className="hero-arrow-cutout" src="/curved-arrow-transparent-v14.png" alt=""/><img className="hero-story-slice hero-sheet" src="/sticker-reference-locked-hero-v12.webp" alt=""/></div><div className="tag t1">YOUR PHOTO</div><div className="tag t2">YOUR STICKERS</div><div className="burst">10<small>STICKERS</small></div></div></section>}

  {stage==="samples"&&<section className="samples-page enter"><header className="samples-head"><h2>See what gets<br/><em>stuck.</em></h2><p>Every sheet includes ten one-of-one stickers.</p></header><div className="sample-grid clean">{samples.map((sample,i)=><article className="sample-card" key={sample}><div className="sample-sheet"><div><span>STICKIER™</span><small>{sample} / 06</small></div><img src="/sticker-sheet.png" alt={`Sticker sheet sample ${i+1} with ten stickers`}/><footer>10 STICKERS · ONE OF ONE</footer></div></article>)}</div></section>}

  {["photos","details","mood"].includes(stage)&&<section className="wizard enter"><aside><div><h2>This is where it gets personal.</h2></div><img className="wizard-latest-sheet" src="/halloween-girl-dog-sticker-sheet-v15.webp" alt="Ten Halloween stickers featuring a witch and her dog in a ghost costume"/></aside><div className="wizard-main"><div className="wizard-rail">{back[stage]&&<button className="back" onClick={()=>back[stage]==="home"?restart():setStage(back[stage]!)}><ArrowLeft/> BACK</button>}<Progress n={currentStep} total={total}/></div>
  {stage==="photos"&&<div className="wizard-content"><Progress n={1} total={total}/><h3>Add your photos.</h3><p>Choose up to 3 clear photos of whoever belongs in your sticker pack.</p><UploadBox previews={photos} onChange={files=>load(files,setPhotos,setPhotoKeys,setPhotoDataUrls,photos)} onRemove={removeMainPhoto}/>{photoBusy&&<p className="upload-status">Converting your photo…</p>}{photoError&&<p className="upload-error">{photoError}</p>}<div className="wizard-actions"><span/><Button className="red-btn" disabled={photos.length===0} onClick={()=>{setSkipPhotoStep(false);setStage("details")}}>NEXT <ArrowRight/></Button></div></div>}
  {stage==="details"&&<div className="wizard-content details"><Progress n={2} total={total}/><h3>Any details you want us to include?</h3><label className="request-box"><textarea value={specialRequest} onChange={e=>setSpecialRequest(e.target.value)} maxLength={500} placeholder="Tell us anything you want included…"/><small>{requestExample}</small></label><ReferencePhotos previews={referencePhotos} onChange={files=>load(files,setReferencePhotos,setReferencePhotoKeys,setReferencePhotoDataUrls,referencePhotos)} onRemove={removeReferencePhoto}/><div className="wizard-actions"><span/><Button className="red-btn" onClick={()=>setStage("mood")}>NEXT <ArrowRight/></Button></div></div>}
  {stage==="mood"&&<div className="wizard-content mood-content"><Progress n={3} total={total}/><h3>What&apos;s the mood?</h3><div className="mood-options">{moodOptions.map(mood=><button className={moods.includes(mood)?"selected":""} aria-pressed={moods.includes(mood)} key={mood} onClick={()=>toggleMood(mood)}><b>{mood}</b>{moods.includes(mood)&&<Check/>}</button>)}</div>{turnstileSiteKey?<div ref={mountTurnstile} className="turnstile-widget"/>:null}<div className="wizard-actions"><span/><Button className="red-btn" disabled={!canGenerate} onClick={generate}>GENERATE <Sparkles/></Button></div></div>}
  </div></section>}

  {stage==="generating"&&<section className="generate loading-state enter"><div className="printer" aria-label="Blank sticker sheet printing"><div className="printer-top"><span/><span/><span/></div><div className="paper"><GenericStickerSheet/></div><div className="printer-slot"/></div><div className="generate-copy loading-copy"><h2>Your stickers are coming to life.</h2><strong>Usually ready in 30–60 seconds</strong><ol className="loading-steps">{loadingSteps.map((step,index)=><li className={index<tick?"complete":index===tick?"active":"upcoming"} key={step}>{index<tick?<span>✓</span>:index===tick?<span className="loading-spinner"/>:<span>○</span>}{index===tick?<b>{step}</b>:step}</li>)}</ol><b className="hang-tight">Hang tight — don&apos;t refresh.</b></div></section>}
  {stage==="reveal"&&<section className="reveal-page enter"><div className="reveal-head"><div><h2>Your stickers are ready!</h2>{generationError&&<p role="alert">{generationError}</p>}{checkoutError&&<p role="alert">{checkoutError}</p>}</div><div className="reveal-side"><div className="reveal-actions"><Button className="red-btn" onClick={openPayment} disabled={Boolean(generationError)||!generatedImageKey}>MAKE THEM MINE <ArrowRight/></Button></div>{paymentOpen&&turnstileSiteKey&&!generationError&&generatedImageKey?<div ref={mountTurnstile} className="turnstile-widget reveal-turnstile"/>:null}</div></div><div className="reveal-body"><div className="sticker-grid">{positions.map((pos,i)=><div className={`sticker-tile ${i===9?"sticker-tile-last":""}`} key={i}><span>{String(i+1).padStart(2,"0")}</span><div className="sticker-image" style={generatedSlices[i]?{backgroundImage:`url(${generatedSlices[i]})`,backgroundSize:"contain",backgroundPosition:"center",backgroundRepeat:"no-repeat"}:{backgroundImage:`url(${generatedImage||"/sticker-sheet.png"})`,backgroundPosition:pos,backgroundSize:"300% 400%",backgroundRepeat:"no-repeat"}}/><small className="cell-watermark cell-watermark-one" aria-hidden="true">STICKIER · PREVIEW</small><small className="cell-watermark cell-watermark-two" aria-hidden="true">STICKIER · PREVIEW</small><small className="cell-watermark cell-watermark-three" aria-hidden="true">STICKIER · PREVIEW</small></div>)}</div><aside className="full-sheet-preview"><div><span>THE FULL SHEET</span></div><Sheet name={subject} clean src={generatedImage||"/sticker-sheet.png"}/></aside></div></section>}
  {stage==="confirmation"&&<section className="confirmation enter"><div className="check"><Check/></div><div className="eyebrow">PURCHASE COMPLETE</div><h2>{purchasedPlan==="physical"?"Your stickers are officially yours":"They’re yours"}</h2>{purchasedPlan==="physical"?<><p><b>Your physical sticker pack is being made.</b></p><p>Your digital stickers are ready now, and we sent a copy to <b>{email||"your email"}</b>. You can also download your sticker sheet now.</p></>:<p>We sent a copy to <b>{email||"your email"}</b>. You can also download your sticker sheet now.</p>}<Sheet name={subject} className="confirmation-sheet" clean src={confirmationSheetSrc}/><div className="confirmation-actions"><a className="download-btn" href={checkoutSessionId?`/api/download-stickers?session_id=${encodeURIComponent(checkoutSessionId)}`:downloadUrl||"#"} aria-disabled={!checkoutSessionId&&!downloadUrl} download><Download/> DOWNLOAD STICKERS</a><Button className="link" onClick={beginAnotherSheet}>MAKE ANOTHER <ArrowRight/></Button></div></section>}

  <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent className="payment-modal">
    <><DialogHeader><DialogTitle>How do you want your stickers?</DialogTitle></DialogHeader><div className="purchase-options"><button className={paymentPlan==="digital"?"selected":""} onClick={()=>setPaymentPlan("digital")}><b>DIGITAL — $4.99</b><span>10 transparent PNG stickers<br/>Full sticker-sheet PNG<br/><strong>Instant download</strong></span></button><button className={paymentPlan==="physical"?"selected":""} onClick={()=>setPaymentPlan("physical")}><b>PHYSICAL + DIGITAL — $9.99</b><em>★ MOST POPULAR</em><span>10 waterproof die-cut stickers<br/>Digital pack included<br/><strong>Free shipping</strong></span></button><button type="button" className={`membership-upsell ${paymentPlan==="membership"?"selected":""}`} onClick={()=>setPaymentPlan("membership")}><p className="membership-title">♡ MAKE IT MONTHLY</p><p className="membership-head">Join Stickier Club — $14.99/month</p><p className="membership-free">This sticker order is included free when you join today.</p><p>3 custom sticker sheets every month</p><p>Create up to <strong>20 versions</strong> and choose your favorites</p><p>All digital stickers included</p><p className="membership-cancel"><strong>Free shipping · Cancel anytime</strong></p></button></div>{checkoutError&&<p role="alert">{checkoutError}</p>}<Button className="black-btn pay-card" disabled={paymentPlan==="membership"?(subscriptionLoading||!canVerify):(checkoutLoading||!canVerify)} onClick={()=>paymentPlan==="membership"?void startSubscription():void startCheckout()}>{paymentPlan==="membership"?(subscriptionLoading?"OPENING…":"JOIN STICKIER CLUB — $14.99"):(checkoutLoading?"OPENING STRIPE…":paymentPlan==="physical"?"GET MY STICKERS — $9.99":"GET DIGITAL STICKERS — $4.99")} <ArrowRight/></Button></>
  </DialogContent></Dialog>
  </main>;
}
