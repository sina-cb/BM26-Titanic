"use strict";
// circuit.js — buttons only. The schematic + pinout are STATIC SVG embedded in
// circuit.html (so they render in any viewer, with or without JS). This script
// just wires the Copy-for-Figma / Download buttons, which serialize the inline
// schematic SVG.
function svgString(){const s=document.querySelector('#schematicPro svg');return s?s.outerHTML:'';}
function toast(msg,ok){const t=document.getElementById("toast");if(!t)return;t.textContent=msg;t.style.color=ok?"#39d98a":"#e06a5a";t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600);}
async function copyForFigma(){
  const s=svgString(); if(!s){toast("nothing to copy",false);return;}
  try{await navigator.clipboard.writeText(s);toast("Copied! Paste into Figma (Ctrl/Cmd+V)",true);}
  catch(e){const ta=document.createElement("textarea");ta.value=s;document.body.appendChild(ta);ta.select();
    try{document.execCommand("copy");toast("Copied! Paste into Figma (Ctrl/Cmd+V)",true);}catch(_){toast("Copy blocked — use Download",false);}
    document.body.removeChild(ta);}
}
function downloadSVG(){
  const s=svgString(); const blob=new Blob([s],{type:"image/svg+xml"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="looking_glass_schematic.svg";a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000); toast("Downloaded looking_glass_schematic.svg",true);
}
function __init(){
  const cb=document.getElementById("copyBtn"); if(cb)cb.addEventListener("click",copyForFigma);
  const db=document.getElementById("dlBtn");   if(db)db.addEventListener("click",downloadSVG);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",__init);else __init();
