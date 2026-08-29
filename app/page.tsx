"use client";

import { ChangeEvent, DragEvent, startTransition, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Heart, ImagePlus, PawPrint, Sparkles, Upload, UserRound, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Stage = "home" | "samples" | "choose" | "photos" | "details" | "mood" | "theme" | "add" | "companion" | "confirm" | "generating" | "reveal" | "confirmation";
type Product = "me" | "pet" | "partner" | "family";
const lines = ["Studying the little\ndetails…", "Sketching your tiny\nuniverse…", "Adding main-character\nenergy…", "Cutting the perfect\nborders…"];
const positions = ["0% 0%", "50% 0%", "100% 0%", "0% 34%", "50% 34%", "100% 34%", "0% 68%", "50% 68%", "100% 68%", "50% 100%"];
const samples = ["01","02","03","04","05","06"];
const moodOptions = ["Cute","Funny","Cozy","Chaotic","Dreamy","Cool","Sweet","Playful"];
const genericStickerIcons = [PawPrint, Heart, Sparkles, UserRound, PawPrint, Heart, Sparkles, UserRound, PawPrint, Heart];
const MAX_PHOTOS = 6;

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
function UploadBox({ previews, pet, target = "yourself", onChange }: { previews:string[]; pet:boolean; target?:string; onChange:(f:FileList|null)=>void }) {
  const drop=(e:DragEvent<HTMLLabelElement>)=>{e.preventDefault();e.currentTarget.classList.remove("dragging");onChange(e.dataTransfer.files)};
  return <label className="upload-zone" onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("dragging")}} onDragLeave={e=>e.currentTarget.classList.remove("dragging")} onDrop={drop}><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e:ChangeEvent<HTMLInputElement>)=>onChange(e.target.files)}/><div className="upload-icon">{pet?<PawPrint/>:<ImagePlus/>}</div><b>{previews.length?`${previews.length} PHOTO${previews.length>1?"S":""} ADDED`:"DROP YOUR PHOTOS HERE"}</b><p>{previews.length?"Looking good. Drop or choose more if you want.":`Drag photos here, or click below · Add 3–6 clear photos of ${target}`}</p><span><Upload size={15}/> CHOOSE PHOTOS</span>{previews.length>0&&<div className="preview-row">{previews.slice(0,5).map((s,i)=><img src={s} alt={`Upload ${i+1}`} key={i}/>)}</div>}</label>;
}
function GenericStickerSheet() {
  return <div className="generic-sticker-sheet">{genericStickerIcons.map((Icon,index)=><div className={`generic-sticker generic-sticker-${index%4}`} key={index}><Icon/></div>)}</div>;
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
  const [companionPhotos,setCompanionPhotos]=useState<string[]>([]);
  const [companionPhotoKeys,setCompanionPhotoKeys]=useState<string[]>([]);
  const [companionPhotoDataUrls,setCompanionPhotoDataUrls]=useState<string[]>([]);
  const [companion,setCompanion]=useState<"pet"|"person"|"skip">("skip");
  const [specialRequest,setSpecialRequest]=useState("");
  const [pet,setPet]=useState({name:"",species:"Dog"});
  const [theme,setTheme]=useState("Classic");
  const [moods,setMoods]=useState<string[]>([]);
  const [ageConfirmed,setAgeConfirmed]=useState(false);
  const [paymentOpen,setPaymentOpen]=useState(false);
  const [paymentPlan,setPaymentPlan]=useState<"digital"|"physical">("physical");
  const [paymentStep,setPaymentStep]=useState<"choose"|"email"|"payment">("choose");
  const [email,setEmail]=useState("");
  const [shipping,setShipping]=useState({name:"",address:"",city:"",state:"",zip:""});
  const [signedIn,setSignedIn]=useState(false);
  const [checkoutNotice,setCheckoutNotice]=useState("");
  const [checkoutError,setCheckoutError]=useState("");
  const [checkoutLoading,setCheckoutLoading]=useState(false);
  const [subscriptionLoading,setSubscriptionLoading]=useState(false);
  const [checkoutSessionId,setCheckoutSessionId]=useState("");
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
  const total=product==="me"?7:5;
  const photoTarget=product==="pet"?"your pet":product==="partner"?"you and your partner":product==="family"?"your family and friends":"yourself";
  const requestExample=product==="pet"?"Favorite toy, signature accessory, funny habit, nickname, or anything else that feels like them.":product==="partner"?"Example: Include flowers.":product==="family"?"Example: Include matching outfits or an inside joke.":"Example: Add a tote bag and a tiny cup of matcha.";
  const currentStep=({choose:1,photos:2,details:3,mood:4,theme:5,add:6,companion:7} as Partial<Record<Stage,number>>)[stage]||1;
  const turnstileSiteKey=process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(()=>{if(stage!=="generating")return;const a=window.setInterval(()=>setTick(x=>(x+1)%4),2200);return()=>clearInterval(a)},[stage]);
  useEffect(()=>{if(!generatedImage)return;const image=new Image();image.crossOrigin="anonymous";image.onload=()=>{const slices:string[]=[];for(let index=0;index<10;index++){const column=index===9?1:index%3;const row=Math.floor(index/3);const canvas=document.createElement("canvas");canvas.width=image.naturalWidth/3;canvas.height=image.naturalHeight/4;canvas.getContext("2d")?.drawImage(image,column*canvas.width,row*canvas.height,canvas.width,canvas.height,0,0,canvas.width,canvas.height);slices.push(canvas.toDataURL("image/png"))}setGeneratedSlices(slices)};image.src=generatedImage},[generatedImage]);

  // Resolve the signed-in user from the app-owned session cookie.
  useEffect(()=>{void fetch("/api/me").then(r=>r.json()).then((data)=>{const user=(data as {user?:{email?:string}|null}).user;if(user?.email){setSignedIn(true);setEmail(current=>current||user.email!)}}).catch(()=>undefined)},[]);

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

  useEffect(()=>{const params=new URLSearchParams(window.location.search);const checkout=params.get("checkout");const sessionId=params.get("session_id");if(checkout==="cancelled"){queueMicrotask(()=>setCheckoutNotice("Checkout was cancelled. Your preview is still here if you want to try again."));window.history.replaceState({},"",window.location.pathname);return}if(!sessionId){if(checkout)window.history.replaceState({},"",window.location.pathname);return}
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
        startTransition(()=>{setStage("confirmation");setCheckoutSessionId(sessionId);if(raw.email)setEmail(raw.email);if(raw.plan)setPurchasedPlan(raw.plan);if(raw.downloadUrl)setGeneratedImage(raw.downloadUrl)});
        window.history.replaceState({},"",window.location.pathname);
      }catch{
        setCheckoutNotice("We could not confirm that payment.");
        window.history.replaceState({},"",window.location.pathname);
      }
    };
    void poll();
    return()=>{if(pollTimer.current)window.clearTimeout(pollTimer.current)};
  },[]);
  useEffect(()=>{if(["choose","photos","details","mood","theme","add","companion"].includes(stage))window.scrollTo({top:0,left:0,behavior:"auto"})},[stage]);

  type Setter=(x:string[]|((prev:string[])=>string[]))=>void;
  const load=async(files:FileList|null,setter:Setter,setKeys:Setter,setData:Setter,current:string[])=>{
    if(!files)return;
    const selected=Array.from(files).slice(0,MAX_PHOTOS-current.length);
    const previews=await Promise.all(selected.map(file=>new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(file)})));
    setter(prev=>[...prev,...previews]);
    for(const file of selected){
      const result=await uploadPhoto(file);
      if(result.key)setKeys(prev=>[...prev,result.key!]);
      else if(result.dataUrl)setData(prev=>[...prev,result.dataUrl!]);
    }
  };

  const start=(p:Product)=>{setProduct(p);setPhotos([]);setPhotoKeys([]);setPhotoDataUrls([]);setCompanionPhotos([]);setCompanionPhotoKeys([]);setCompanionPhotoDataUrls([]);setMoods([]);setGeneratedImage("");setGeneratedImageKey("");setGeneratedSlices([]);setGenerationError("");setStage("photos")};

  // Submit the generation job, then poll for completion instead of holding the
  // connection open for the full OpenAI call.
  const generate=async()=>{
    setTick(0);setGenerationError("");setStage("generating");
    try{
      const keys=product==="pet"?photoKeys:[...photoKeys,...companionPhotoKeys];
      const dataUrls=product==="pet"?photoDataUrls:[...photoDataUrls,...companionPhotoDataUrls];
      const response=await fetch("/api/generate-stickers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({photoKeys:keys,photos:dataUrls,subject,product,companion,companionName:companion==="pet"?pet.name:groupName,species:pet.species,theme,moods,specialRequest,turnstileToken})});
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

  const restart=()=>{try{sessionStorage.removeItem("stickier-reveal")}catch{}setStage("home")};
  const toggleMood=(mood:string)=>setMoods(current=>current.includes(mood)?current.filter(item=>item!==mood):[...current,mood]);
  const openPayment=()=>{setPaymentPlan("physical");setCheckoutError("");setPaymentStep("choose");setPaymentOpen(true)};
  const startCheckout=async()=>{setCheckoutLoading(true);setCheckoutError("");try{const response=await fetch("/api/create-checkout-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,subject,imageKey:generatedImageKey,plan:paymentPlan,...(paymentPlan==="physical"?shipping:{}),turnstileToken})});const data=await response.json() as {url?:string;error?:string};if(!response.ok||!data.url)throw new Error(data.error||"Unable to start checkout.");window.location.assign(data.url)}catch(error){setCheckoutError(error instanceof Error?error.message:"Unable to start checkout.");setCheckoutLoading(false)}};
  const startSubscription=async()=>{if(!signedIn){window.location.assign("/signin?return_to="+encodeURIComponent("/"));return}if(!generatedImageKey){setCheckoutError("Generate a sticker sheet first.");return}setSubscriptionLoading(true);setCheckoutError("");try{const response=await fetch("/api/create-subscription-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject,imageKey:generatedImageKey,turnstileToken})});const data=await response.json() as {url?:string;error?:string};if(!response.ok||!data.url)throw new Error(data.error||"Unable to start subscription.");window.location.assign(data.url)}catch(error){setCheckoutError(error instanceof Error?error.message:"Unable to start subscription.");setSubscriptionLoading(false)}};
  const back:Partial<Record<Stage,Stage>>={choose:"home",photos:"choose",details:"photos",mood:"details",theme:"mood",add:"theme",companion:"add",reveal:"theme"};
  // Turnstile tokens are single-use, so every gated action needs its own live
  // token from the widget mounted on that stage.
  const canVerify=turnstileSiteKey?Boolean(turnstileToken):true;
  const canGenerate=ageConfirmed&&canVerify;

  return <main className={`shell ${stage}`}><div className="grain"/>{stage!=="confirmation"&&<nav><button className="logo" onClick={restart}>STICKIER<sup>™</sup></button><span>{stage==="home"?"YOUR LIFE, BUT STICKIER":stage==="samples"?"THE SAMPLE STUDIO":product==="pet"?"THE PET STICKER STUDIO":"THE LIFE STICKER STUDIO"}</span><div className="nav-end">{signedIn?<a className="nav-account" href="/account">ACCOUNT</a>:<a className="nav-account" href="/signin">SIGN IN</a>}<button className="nav-cta" onClick={()=>stage==="home"?setStage("samples"):stage==="samples"?setStage("choose"):restart()}>{stage==="home"?"SEE SAMPLES":stage==="samples"?"CREATE MINE":"EXIT STUDIO"}</button></div></nav>}
  {checkoutNotice&&<p className="checkout-notice" role="status">{checkoutNotice}</p>}

  {stage==="home"&&<section className="split enter"><div className="copy"><h1>Any photo.<br/><em>Any idea.</em><br/>Your stickers.</h1><p>You, your people, your pets, and your little obsessions turned into custom sticker sheets.</p><div className="home-cta"><Button className="red-btn" onClick={()=>setStage("choose")}>MAKE MY STICKERS <ArrowRight/></Button></div></div><div className="art hero-home"><div className="tag t1">YOUR PHOTO</div><div className="tag t2">YOUR STICKERS</div><img className="hero-home-image" src="/sticker-reference-locked-hero-v12.webp" alt="A Polaroid and ten custom stickers of a woman and her dog"/><div className="burst">10<small>STICKERS</small></div></div></section>}

  {stage==="samples"&&<section className="samples-page enter"><header className="samples-head"><h2>See what gets<br/><em>stuck.</em></h2><p>Every sheet includes ten one-of-one stickers.</p></header><div className="sample-grid clean">{samples.map((sample,i)=><article className="sample-card" key={sample}><div className="sample-sheet"><div><span>STICKIER™</span><small>{sample} / 06</small></div><img src="/sticker-sheet.png" alt={`Sticker sheet sample ${i+1} with ten stickers`}/><footer>10 STICKERS · ONE OF ONE</footer></div></article>)}</div></section>}

  {["choose","photos","details","mood","theme","add","companion"].includes(stage)&&<section className="wizard enter"><aside><div><span>THE STICKER ERA METHOD</span><h2>{product==="pet"?<>Tiny quirks.<br/>Big personality.</>:<>The details<br/>make the era.</>}</h2></div><Sheet name={subject} className="wizard-sheet"/></aside><div className="wizard-main"><div className="wizard-rail">{back[stage]&&<button className="back" onClick={()=>setStage(back[stage]!)}><ArrowLeft/> BACK</button>}<Progress n={currentStep} total={total}/></div>
  {stage==="choose"&&<div className="wizard-content choose-content"><Progress n={1} total={4}/><h3>Who are we turning<br/>into stickers?</h3><div className="choice-grid"><button onClick={()=>start("me")}><i><UserRound/></i><b>Me</b><span>My personality, hobbies &amp; favorite things</span><ArrowRight/></button><button onClick={()=>start("pet")}><i><PawPrint/></i><b>My pet</b><span>Their personality, quirks &amp; favorite things</span><ArrowRight/></button><button onClick={()=>start("partner")}><i><Heart/></i><b>My partner</b><span>Your relationship, rituals &amp; favorite memories</span><ArrowRight/></button><button onClick={()=>start("family")}><i><UsersRound/></i><b>Family &amp; friends</b><span>Your favorite people, moments &amp; inside jokes</span><ArrowRight/></button></div></div>}
  {stage==="photos"&&<div className="wizard-content"><Progress n={2} total={total}/><h3>Add a few photos<br/>of {photoTarget}.</h3><p>Different angles and expressions give your stickers more range. At least one photo is required.</p><UploadBox pet={product==="pet"} target={photoTarget} previews={photos} onChange={f=>load(f,setPhotos,setPhotoKeys,setPhotoDataUrls,photos)}/><div className="wizard-actions"><span/><Button className="red-btn" disabled={photos.length===0} onClick={()=>setStage("details")}>NEXT <ArrowRight/></Button></div></div>}
  {stage==="details"&&product!=="pet"&&<div className="wizard-content details"><Progress n={3} total={total}/><h3>What belongs in this sticker pack?</h3><div className="pet-fields"><label><span>{product==="me"?"What should we call you?":product==="partner"?"What should we call this pack?":"What should we call this group?"}</span><input value={product==="me"?name:groupName} onChange={e=>product==="me"?setName(e.target.value):setGroupName(e.target.value)} placeholder={product==="me"?"Your name":product==="partner"?"You & Alex":"The crew"}/></label></div><label className="request-box"><span>ANY SPECIAL REQUESTS</span><textarea value={specialRequest} onChange={e=>setSpecialRequest(e.target.value)} maxLength={500} placeholder="Tell us anything you want included…"/><small>{requestExample} Optional.</small></label><p className="consent-note">Photos are sent to OpenAI to generate your stickers. See our <a href="/privacy">privacy policy</a>.</p><div className="wizard-actions"><span/><Button className="red-btn" onClick={()=>setStage("mood")}>NEXT <ArrowRight/></Button></div></div>}
  {stage==="details"&&product==="pet"&&<div className="wizard-content details pet-form"><Progress n={3} total={total}/><h3>What belongs in this sticker pack?</h3><div className="pet-fields"><label><span>What&apos;s their name?</span><input value={pet.name} onChange={e=>setPet({...pet,name:e.target.value})} placeholder="Mochi"/></label><label><span>Type of animal</span><select value={pet.species} onChange={e=>setPet({...pet,species:e.target.value})}><option>Dog</option><option>Cat</option><option>Bird</option><option>Rabbit</option><option>Other</option></select></label></div><label className="request-box"><span>ANY SPECIAL REQUESTS</span><textarea value={specialRequest} onChange={e=>setSpecialRequest(e.target.value)} maxLength={500} placeholder="Tell us anything you want included…"/><small>{requestExample} Optional.</small></label><p className="consent-note">Photos are sent to OpenAI to generate your stickers. See our <a href="/privacy">privacy policy</a>.</p><div className="wizard-actions"><span/><Button className="red-btn" onClick={()=>setStage("mood")}>NEXT <ArrowRight/></Button></div></div>}
  {stage==="mood"&&<div className="wizard-content"><Progress n={4} total={total}/><h3>What&apos;s the mood?</h3><div className="mood-options">{moodOptions.map(mood=><button className={moods.includes(mood)?"selected":""} aria-pressed={moods.includes(mood)} key={mood} onClick={()=>toggleMood(mood)}>{mood}{moods.includes(mood)&&<Check/>}</button>)}</div><div className="wizard-actions"><span/><Button className="red-btn" onClick={()=>setStage("theme")}>NEXT <ArrowRight/></Button></div></div>}
  {stage==="theme"&&<div className="wizard-content"><Progress n={5} total={total}/><h3>Choose a theme.</h3><p>We&apos;ll weave it into the colors, props, and tiny details.</p><div className="theme-grid">{[["Classic","—","Classic & neutral"],["Valentine's Day","♥","Sweet & romantic"],["Halloween","◐","Spooky & cute"],["Thanksgiving","🍂","Cozy fall energy"],["Christmas","★","Festive & bright"],["Birthday","✦","Party mode"]].map(([label,icon,copy])=><button className={theme===label?"selected":""} key={label} onClick={()=>setTheme(label)}><i>{icon}</i><b>{label}</b><span>{copy}</span>{theme===label&&<Check/>}</button>)}</div><div className="wizard-actions"><span/><Button className="red-btn" onClick={()=>product==="me"?setStage("add"):setStage("confirm")}>NEXT <ArrowRight/></Button></div></div>}
  {stage==="add"&&<div className="wizard-content"><Progress n={6} total={7}/><div className="eyebrow">YOUR SUPPORTING CAST</div><h3>Anyone else who belongs<br/>on your sheet?</h3><p>You&apos;ll still be the main character.</p><div className="choice-grid three"><button onClick={()=>{setCompanion("pet");setStage("companion")}}><i>🐶</i><b>My pet</b><span>The four-legged co-star</span></button><button onClick={()=>{setCompanion("person");setStage("companion")}}><i>♥</i><b>My person</b><span>A favorite human</span></button><button onClick={()=>{setCompanion("skip");setStage("confirm")}}><i>→</i><b>Just me</b><span>Skip and continue</span></button></div></div>}
  {stage==="companion"&&<div className="wizard-content"><Progress n={7} total={7}/><div className="eyebrow">ADD YOUR {companion==="pet"?"CO-STAR":"PERSON"}</div><h3>Upload {companion==="pet"?"your pet":"your favorite person"}.</h3><p>One or two clear photos are perfect.</p><UploadBox pet={companion==="pet"} target={companion==="pet"?"your pet":"your favorite person"} previews={companionPhotos} onChange={f=>load(f,setCompanionPhotos,setCompanionPhotoKeys,setCompanionPhotoDataUrls,companionPhotos)}/><div className="wizard-actions"><button className="skip" onClick={()=>setStage("confirm")}>SKIP</button><Button className="red-btn" onClick={()=>setStage("confirm")}>CONTINUE <ArrowRight/></Button></div></div>}
  </div></section>}

  {stage==="confirm"&&<section className="wizard confirm-wizard enter"><div className="wizard-main confirm-main"><h3>Almost there.</h3><p>Confirm you have the right to use these photos, then we&apos;ll make your sheet.</p><label className="age-gate"><input type="checkbox" checked={ageConfirmed} onChange={e=>setAgeConfirmed(e.target.checked)}/><span>I confirm everyone in these photos is an adult, or I have a parent or guardian&apos;s permission, and I have the right to use every photo.</span></label>{turnstileSiteKey?<div ref={mountTurnstile} className="turnstile-widget"/>:null}<div className="wizard-actions"><span/><Button className="red-btn" disabled={!canGenerate} onClick={generate}>GENERATE <Sparkles/></Button></div></div></section>}

  {stage==="generating"&&<section className="generate enter"><div className="printer"><div className="printer-top"><span/><span/><span/></div><div className="paper"><GenericStickerSheet/></div><div className="printer-slot"/></div><div className="generate-copy"><b>MAKING YOUR STICKER SHEET</b><h2>{lines[tick]}</h2><div className="progress"><i/></div><small className="generation-estimate">Takes approximately 30–60 seconds</small></div></section>}
  {stage==="reveal"&&<section className="reveal-page enter"><div className="reveal-head"><div><h2>{product==="pet"?`${subject}, as stickers.`:"Your life, as stickers."}</h2><p>Ten digital stickers, ready to download and use anywhere.</p>{generationError&&<p role="alert">{generationError}</p>}{checkoutError&&<p role="alert">{checkoutError}</p>}</div><div className="reveal-side"><div className="reveal-actions"><Button className="red-btn" onClick={openPayment} disabled={Boolean(generationError)||!generatedImageKey||!canVerify}>PURCHASE STICKERS <ArrowRight/></Button><Button className="subscription-btn" onClick={()=>void startSubscription()} disabled={subscriptionLoading||Boolean(generationError)||!generatedImageKey||(signedIn&&!canVerify)}>{subscriptionLoading?"OPENING…":signedIn?"SUBSCRIBE · $9.99 / MONTH":"SIGN IN TO SUBSCRIBE"}<ArrowRight/></Button></div>{turnstileSiteKey&&!generationError&&generatedImageKey?<div ref={mountTurnstile} className="turnstile-widget reveal-turnstile"/>:null}</div></div><div className="reveal-body"><div className="sticker-grid">{positions.map((pos,i)=><div className={`sticker-tile ${i===9?"sticker-tile-last":""}`} key={i}><span>{String(i+1).padStart(2,"0")}</span><div className="sticker-image" style={generatedSlices[i]?{backgroundImage:`url(${generatedSlices[i]})`,backgroundSize:"contain",backgroundPosition:"center",backgroundRepeat:"no-repeat"}:{backgroundImage:`url(${generatedImage||"/sticker-sheet.png"})`,backgroundPosition:pos,backgroundSize:"300% 400%",backgroundRepeat:"no-repeat"}}/><small className="cell-watermark cell-watermark-one" aria-hidden="true">STICKIER · PREVIEW</small><small className="cell-watermark cell-watermark-two" aria-hidden="true">STICKIER · PREVIEW</small><small className="cell-watermark cell-watermark-three" aria-hidden="true">STICKIER · PREVIEW</small></div>)}</div><aside className="full-sheet-preview"><div><span>THE FULL SHEET</span></div><Sheet name={subject} clean src={generatedImage||"/sticker-sheet.png"}/></aside></div></section>}
  {stage==="confirmation"&&<section className="confirmation enter"><div className="check"><Check/></div><div className="eyebrow">PURCHASE COMPLETE</div><h2>{purchasedPlan==="physical"?"Your stickers are officially happening ✦":"They’re yours ✦"}</h2><p>We sent a copy to <b>{email||"your email"}</b>. You can also download your sticker sheet now.</p><Sheet name={subject} className="confirmation-sheet" clean src={checkoutSessionId?`/api/download-stickers?session_id=${encodeURIComponent(checkoutSessionId)}`:(generatedImage||"/sticker-sheet.png")}/><div className="confirmation-actions"><a className="download-btn" href={checkoutSessionId?`/api/download-stickers?session_id=${encodeURIComponent(checkoutSessionId)}`:"#"} aria-disabled={!checkoutSessionId}><Download/> DOWNLOAD STICKERS</a><Button className="link" onClick={restart}>MAKE ANOTHER <ArrowRight/></Button></div></section>}

  <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent className="payment-modal">
    {paymentStep==="choose"&&<><DialogHeader><DialogTitle>How do you want them?</DialogTitle><DialogDescription>Choose your sticker format.</DialogDescription></DialogHeader><div className="purchase-options"><button className={paymentPlan==="digital"?"selected":""} onClick={()=>setPaymentPlan("digital")}><b>DIGITAL — $4.99</b><span>10 transparent PNGs<br/>Full sticker-sheet PNG<br/>Instant download</span></button><button className={paymentPlan==="physical"?"selected":""} onClick={()=>setPaymentPlan("physical")}><b>PHYSICAL + DIGITAL — $9.99</b><em>★ MOST POPULAR</em><span>10 real die-cut, waterproof stickers<br/>Digital pack included<br/>Shipped to your door</span></button></div><Button className="black-btn pay-card" onClick={()=>setPaymentStep("email")}>CONTINUE <ArrowRight/></Button></>}
    {paymentStep==="email"&&<><DialogHeader><div className="payment-kicker">{paymentPlan==="physical"?"PHYSICAL + DIGITAL":"DIGITAL"} · {paymentPlan==="physical"?"$9.99":"$4.99"}</div><DialogTitle>{paymentPlan==="physical"?"Your physical sticker pack":"Your digital sticker pack"}</DialogTitle><DialogDescription>{paymentPlan==="physical"?"10 die-cut stickers · Digital pack included":"10 transparent PNGs · Full sticker-sheet PNG · Instant download"}</DialogDescription></DialogHeader><div className="card-fields">{paymentPlan==="physical"&&<><label><span>NAME</span><input value={shipping.name} onChange={e=>setShipping({...shipping,name:e.target.value})} placeholder="Your name"/></label><label><span>ADDRESS</span><input value={shipping.address} onChange={e=>setShipping({...shipping,address:e.target.value})} placeholder="Street address"/></label><div><label><span>CITY</span><input value={shipping.city} onChange={e=>setShipping({...shipping,city:e.target.value})} placeholder="City"/></label><label><span>STATE / ZIP</span><input value={`${shipping.state}${shipping.zip?` ${shipping.zip}`:""}`} onChange={e=>{const [state,...rest]=e.target.value.split(/\s+/);setShipping({...shipping,state:state||"",zip:rest.join(" ")})}} placeholder="CA 95113"/></label></div></>}<label><span>EMAIL</span><input type="email" required autoFocus value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label></div><p className="payment-total">{paymentPlan==="physical"?"Total — $9.99 + state tax":"$4.99"}</p><Button className="black-btn pay-card" disabled={!/^\S+@\S+\.\S+$/.test(email)||(paymentPlan==="physical"&&!shipping.name)} onClick={()=>setPaymentStep("payment")}>CONTINUE TO CHECKOUT <ArrowRight/></Button></>}
    {paymentStep==="payment"&&<><DialogHeader><div className="payment-kicker">SECURE CHECKOUT</div><DialogTitle>{paymentPlan==="physical"?"Place your order":"Pay $4.99"}</DialogTitle><DialogDescription>Apple Pay, Google Pay, Link, and card are available in secure checkout.</DialogDescription></DialogHeader>{checkoutError&&<p role="alert">{checkoutError}</p>}<Button className="black-btn pay-card" disabled={checkoutLoading} onClick={startCheckout}>{checkoutLoading?"OPENING CHECKOUT…":paymentPlan==="physical"?"PLACE ORDER · $9.99":"PAY $4.99"} <ArrowRight/></Button><button className="change-email" onClick={()=>setPaymentStep("email")}>BACK</button></>}
  </DialogContent></Dialog>
  </main>;
}
