"use strict";
// circuit.js — the schematic, button-wiring, and system diagrams are STATIC SVG
// embedded in circuit.html (so they render in any viewer, with or without JS).
// This script wires every Copy-for-Figma / Download button. Each button acts on
// the SVG of ITS OWN frame when it lives inside one, else the active tab's SVG.
function activePane(){return document.querySelector(".tabpane.active")||document;}
function svgFor(btn){
  const f = btn && btn.closest(".frame");
  if(f){
    const active = f.querySelector(".wirepane.active svg");  // frame with switchable variants
    if(active) return active;
    const s = f.querySelector("svg");
    if(s) return s;
  }
  return activePane().querySelector("svg");
}
function dlNameFor(btn){
  const f = btn && btn.closest(".frame");
  const wire = f && f.querySelector(".wirepane.active");
  if(btn&&btn.dataset.name)return btn.dataset.name + (wire&&wire.dataset.wire?"_"+wire.dataset.wire:"") + ".svg";
  return activePane().id==="tab-system"?"looking_glass_system.svg":"looking_glass_schematic.svg";
}
function toastNear(btn,msg,ok){
  const bar = btn && btn.closest(".bar");
  const t = (bar&&bar.querySelector(".toast")) || activePane().querySelector(".toast");
  if(!t)return;t.textContent=msg;t.style.color=ok?"#39d98a":"#e06a5a";
  t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600);
}
async function copyForFigma(e){
  const btn=e.currentTarget, el=svgFor(btn), s=el?el.outerHTML:"";
  if(!s){toastNear(btn,"nothing to copy",false);return;}
  try{await navigator.clipboard.writeText(s);toastNear(btn,"Copied! Paste into Figma (Ctrl/Cmd+V)",true);}
  catch(err){const ta=document.createElement("textarea");ta.value=s;document.body.appendChild(ta);ta.select();
    try{document.execCommand("copy");toastNear(btn,"Copied! Paste into Figma (Ctrl/Cmd+V)",true);}catch(_){toastNear(btn,"Copy blocked — use Download",false);}
    document.body.removeChild(ta);}
}
function downloadSVG(e){
  const btn=e.currentTarget, el=svgFor(btn);
  if(!el){toastNear(btn,"nothing to download",false);return;}
  const blob=new Blob([el.outerHTML],{type:"image/svg+xml"});
  const name=dlNameFor(btn);
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000); toastNear(btn,"Downloaded "+name,true);
}
function __init(){
  document.querySelectorAll(".copyBtn").forEach(b=>b.addEventListener("click",copyForFigma));
  document.querySelectorAll(".dlBtn").forEach(b=>b.addEventListener("click",downloadSVG));
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",__init);else __init();
