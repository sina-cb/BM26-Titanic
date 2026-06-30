"use strict";
// gen_circuit.cjs — single source of truth for the STATIC schematic + pinout SVG
// embedded in circuit.html. The viewer the operator uses blocks page JS, so the
// schematic and pinout MUST render with zero JS: this script bakes the inline
// <svg> straight into circuit.html.
//
// Usage:  node tools/gen_circuit.cjs <abs path to circuit.html>
//
// The drawing logic here is mirrored by renderSchematicPro / renderPinout in
// circuit.js (kept byte-for-byte in sync). circuit.js only powers the
// Copy/Download buttons, which serialize the inline schematic <svg>.

const fs = require("fs");
const SVGNS = "http://www.w3.org/2000/svg";

// ---- minimal DOM-to-string shim ----
function elem(name){return{name,attrs:{},kids:[],text:null,
  setAttribute(k,v){this.attrs[k]=v;},
  appendChild(c){this.kids.push(c);return c;},
  set textContent(t){this.text=t;}, get textContent(){return this.text;}};}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function escA(s){return esc(s).replace(/"/g,"&quot;");}
function serialize(n){let a="";for(const k in n.attrs)a+=" "+k+'="'+escA(n.attrs[k])+'"';
  if(n.text!=null)return "<"+n.name+a+">"+esc(n.text)+"</"+n.name+">";
  if(!n.kids.length)return "<"+n.name+a+"></"+n.name+">";
  return "<"+n.name+a+">"+n.kids.map(serialize).join("")+"</"+n.name+">";}
function el(n,a){const e=elem(n);for(const k in a)e.setAttribute(k,a[k]);return e;}

// ===================================================================
//  Ground-truth ESP32-S3-Pico header (two physical rows, exact order)
//  Each pin: [name, role, net?]
//  roles: psram | uart | strap | usb | gnd | sys | btn | led | pwr | free
// ===================================================================
const top=[["33","psram"],["34","psram"],["GND","gnd"],["35","psram"],["36","psram"],["37","psram"],["38","btn","MODE"],["GND","gnd"],["39","btn","ARCADE_1"],["40","lamp","LAMP1"],["41","btn","ARCADE_2"],["42","lamp","LAMP2"],["GND","gnd"],["45","strap"],["46","strap"],["47","btn","ARCADE_3"],["48","lamp","LAMP3"],["GND","gnd"],["19","usb"],["20","usb"]];
const bot=[["43","uart"],["44","uart"],["GND","gnd"],["0","strap"],["1","free"],["2","free"],["3","strap"],["GND","gnd"],["15","btn","ARCADE_4"],["RUN","sys"],["18","lamp","LAMP4"],["16","btn","ARCADE_5"],["GND","gnd"],["17","lamp","LAMP5"],["21","led","WS2812"],["3V3","pwr"],["3V3_EN","sys"],["GND","gnd"],["VSYS","pwr","+5V"],["VBUS","pwr"]];
// (GPIO18, bottom-row index 10, is the illuminated-button LAMP output — see role "lamp")

// reserved roles read as "do not use"
const RESERVED=new Set(["psram","uart","strap","usb"]);

// ===================================================================
//  SCHEMATIC — light Figma-style artboard, datasheet-style IC symbol
//  with the FULL header pinout in exact physical order/placement.
// ===================================================================
function renderSchematicPro(g){
  const W=1660,H=1180;
  const INK="#263043",WIRE="#3b4759",PWR="#c0392b",GNDC="#263043",AMB="#9a6b12",
        MUT="#7a8699",ICF="#eef2f7",ICS="#9aa7b8",BLKF="#f1f4f8",BLKS="#aab6c6",GRN="#2e8b57",
        RESC="#b06a6a",RESLN="#c98a8a";
  const SANS="ui-sans-serif,Segoe UI,sans-serif",MONO="ui-monospace,Consolas,monospace";
  const L=(x1,y1,x2,y2,c,w,d)=>g.appendChild(el("line",{x1,y1,x2,y2,stroke:c||WIRE,"stroke-width":w||1.8,"stroke-linecap":"round","stroke-dasharray":d||"0"}));
  const T=(x,y,s,c,sz,w,a,it)=>{const e=el("text",{x,y,fill:c||INK,"font-size":sz||12,"font-weight":w||400,"text-anchor":a||"start","font-family":SANS});if(it)e.setAttribute("font-style","italic");e.textContent=s;g.appendChild(e);};
  const M=(x,y,s,c,sz,w,a)=>{const e=el("text",{x,y,fill:c||INK,"font-size":sz||12,"font-weight":w||600,"text-anchor":a||"start","font-family":MONO});e.textContent=s;g.appendChild(e);};
  const MROT=(x,y,s,c,sz,w,a)=>{const e=el("text",{x,y,fill:c||INK,"font-size":sz||12,"font-weight":w||600,"text-anchor":a||"middle","font-family":MONO,transform:"rotate(-90 "+x+" "+y+")"});e.textContent=s;g.appendChild(e);};
  const DOT=(x,y,c)=>g.appendChild(el("circle",{cx:x,cy:y,r:3.2,fill:c||WIRE}));
  const RING=(x,y)=>g.appendChild(el("circle",{cx:x,cy:y,r:3.4,fill:"#fff",stroke:INK,"stroke-width":1.4}));
  const BOX=(x,y,w,h,f,s,d)=>g.appendChild(el("rect",{x,y,width:w,height:h,rx:8,fill:f||BLKF,stroke:s||BLKS,"stroke-width":1.4,"stroke-dasharray":d||"0"}));
  const GND=(x,y,c)=>{c=c||GNDC;L(x,y,x,y+9,c);L(x-11,y+9,x+11,y+9,c);L(x-7,y+13,x+7,y+13,c);L(x-3,y+17,x+3,y+17,c);};
  const FLAG=(x,y,label,c)=>{c=c||PWR;L(x,y,x,y-9,c);L(x-13,y-9,x+13,y-9,c,2);T(x,y-15,label,c,11,700,"middle");};
  function LED(x,y){L(x,y,x+12,y,WIRE);
    g.appendChild(el("path",{d:"M "+(x+12)+" "+(y-12)+" L "+(x+12)+" "+(y+12)+" L "+(x+36)+" "+y+" Z",fill:"none",stroke:INK,"stroke-width":1.6}));
    L(x+36,y-12,x+36,y+12,INK,2);L(x+36,y,x+50,y,WIRE);
    L(x+24,y-16,x+33,y-25,GRN,1.4);L(x+33,y-25,x+28.5,y-23,GRN,1.4);L(x+33,y-25,x+31,y-20.5,GRN,1.4);
    L(x+31,y-13,x+40,y-22,GRN,1.4);L(x+40,y-22,x+35.5,y-20,GRN,1.4);L(x+40,y-22,x+38,y-17.5,GRN,1.4);}

  // ---------- header / title ----------
  T(70,52,"LookingGlass — Control Panel · Schematic",INK,17,800);
  T(70,72,"ESP32-S3-Pico (ESP32-S3R8) · Rev 0.1 · active-low buttons · full header pinout",MUT,12,500);
  L(70,86,1570,86,"#e6e9ef",1);

  // ---------- IC symbol: full two-row header ----------
  // chip body
  const N=20, pitch=58, padW=40, padH=24;
  const x0=200;                       // x of first pin centre
  const chipX=x0-pitch/2, chipW=N*pitch;
  const chipY=470, chipH=200;         // body between the two pin rows
  const topRowY=chipY, botRowY=chipY+chipH; // edges where pins attach
  const stub=20;                      // pin stub length out of the body
  BOX(chipX,chipY,chipW,chipH,ICF,ICS);
  // pin-1 notch
  g.appendChild(el("circle",{cx:chipX+18,cy:chipY+18,r:5,fill:"none",stroke:ICS,"stroke-width":1.4}));
  T(chipX+chipW/2,chipY+chipH/2-6,"ESP32-S3-Pico",INK,20,800,"middle");
  T(chipX+chipW/2,chipY+chipH/2+16,"(ESP32-S3R8) · Waveshare module",MUT,12,500,"middle");
  T(chipX+chipW/2,chipY+chipH/2+38,"TOP HEADER ROW (above) · BOTTOM HEADER ROW (below) — exact physical order",MUT,10.5,600,"middle",true);

  // colour helpers for pin pads
  const padFill=role=>RESERVED.has(role)?"#fbeeee":role==="gnd"?"#eef1f5":role==="pwr"?"#fbeceb":role==="btn"?"#fbf3e0":role==="lamp"?"#fdecd6":role==="led"?"#e7f8ef":role==="sys"?"#e9f1fb":"#f1f4f8";
  const padStroke=role=>RESERVED.has(role)?RESLN:role==="btn"?"#caa040":role==="lamp"?"#e08a2e":role==="led"?"#39d98a":role==="pwr"?"#e06a5a":role==="sys"?"#5aa0e0":ICS;
  const padInk=role=>RESERVED.has(role)?RESC:INK;

  // draw one pin pad + stub. isTop: pad sits above the body.
  // returns the x of pin centre and the y of the free end of the stub.
  function pin(i,p,isTop){
    const name=p[0],role=p[1];
    const cx=x0+i*pitch;
    const edgeY=isTop?topRowY:botRowY;
    const endY=isTop?topRowY-stub:botRowY+stub;          // free end of stub
    const padCY=isTop?edgeY-stub-padH/2-2:edgeY+stub+padH/2+2;
    const reserved=RESERVED.has(role);
    // stub from body edge to pad
    L(cx,edgeY,cx,isTop?padCY+padH/2:padCY-padH/2,reserved?RESLN:WIRE,1.6,reserved?"3 2":"0");
    // pad
    g.appendChild(el("rect",{x:cx-padW/2,y:padCY-padH/2,width:padW,height:padH,rx:4,
      fill:padFill(role),stroke:padStroke(role),"stroke-width":1.4,"stroke-dasharray":reserved?"3 2":"0"}));
    // label inside pad
    M(cx,padCY+4,name,padInk(role),name.length>3?9.5:11.5,700,"middle");
    return {cx,padTop:padCY-padH/2,padBot:padCY+padH/2};
  }

  // index → pin geometry (for wiring used pins to nets)
  const T_=top.map((p,i)=>pin(i,p,true));
  const B_=bot.map((p,i)=>pin(i,p,false));

  // small reserved hint
  T(chipX,chipY-stub-padH-22,"dashed / dimmed pins = reserved — do not use",RESC,10.5,600,"start",true);

  // index → pin geometry by name (for wiring used pins to nets / switches)
  const byName={};
  top.forEach((p,i)=>{byName[p[0]]={geo:T_[i],isTop:true,p};});
  bot.forEach((p,i)=>{byName[p[0]]={geo:B_[i],isTop:false,p};});

  // ===========================================================
  //  BUTTONS ×6 — each switch sits at its own header pin and
  //  closes that GPIO to a local GND symbol (active-low). Top-row
  //  pins get the switch above the chip; bottom-row pins below.
  //  No long crossing wires — datasheet-clean.
  // ===========================================================
  T(70,150,"BUTTONS — 5 arcade + 1 mode · active-low (INPUT_PULLUP)",MUT,12,700);
  T(70,168,"inputs pulled HIGH internally; each switch closes its GPIO to GND (pressed = LOW)",MUT,10,500,"start",true);
  // Vertical momentary-switch drawn from a pin pad outward to a GND tick.
  // dir = -1 routes upward (top row), +1 downward (bottom row).
  function VSW(cx,padEdgeY,dir,sw,net){
    const a=padEdgeY+dir*16;            // first node off the pad
    const b=padEdgeY+dir*40;            // lower contact
    const c=padEdgeY+dir*54;            // upper contact (open-switch gap)
    const gy=padEdgeY+dir*82;           // GND tie
    L(cx,padEdgeY,cx,a,WIRE);
    RING(cx,a);
    // open momentary contact: terminal + a lifted blade across the gap
    L(cx,a,cx,b,INK,1.4);
    L(cx-9,c,cx+9,c,INK,2.2);           // blade
    L(cx,c,cx,gy-6,INK,1.4);
    RING(cx,gy-6);
    L(cx,gy-6,cx,gy,GNDC,1.6);
    GND(cx,gy,GNDC);
    // net label runs vertically alongside the switch stem (no horizontal
    // collision with adjacent switches); SW id centred beyond the GND tick.
    const mid=(a+c)/2;
    MROT(cx+14,mid,net,AMB,9.5,700);
    T(cx,dir<0?gy-18:gy+30,sw,AMB,10.5,800,"middle");
  }
  const btnDefs=[
    {pin:"39",net:"ARCADE_1",sw:"SW1"},{pin:"41",net:"ARCADE_2",sw:"SW2"},
    {pin:"47",net:"ARCADE_3",sw:"SW3"},{pin:"15",net:"ARCADE_4",sw:"SW4"},
    {pin:"16",net:"ARCADE_5",sw:"SW5"},{pin:"38",net:"MODE",sw:"SW6"}];
  btnDefs.forEach(b=>{const n=byName[b.pin];
    if(n.isTop)VSW(n.geo.cx,n.geo.padTop,-1,b.sw,b.net);
    else        VSW(n.geo.cx,n.geo.padBot,+1,b.sw,b.net);});

  // Lamp-control GPIOs (outputs) — named nets LAMP1..5 that feed the low-side
  // MOSFET drivers in the lamp section below.
  [["40","LAMP1"],["42","LAMP2"],["48","LAMP3"],["18","LAMP4"],["17","LAMP5"]].forEach(pr=>{
    const n=byName[pr[0]],lg=n.geo,ey=n.isTop?lg.padTop:lg.padBot,dir=n.isTop?-1:1;
    L(lg.cx,ey,lg.cx,ey+dir*16,"#e08a2e",1.8);DOT(lg.cx,ey,"#e08a2e");
    T(lg.cx,ey+dir*(n.isTop?14:28),pr[1],AMB,9,800,"middle");});

  // pin geometry shortcuts
  const vsysGeo=byName["VSYS"].geo;        // bottom row, idx 18
  const ledGeo =byName["21"].geo;          // bottom row, idx 14 (WS2812)
  const usb19=byName["19"].geo,usb20=byName["20"].geo; // top row, idx 18/19

  // ===========================================================
  //  POWER chain: 24V → buck → 5V → VSYS  (bottom-right band)
  //  Short +5V rail stays right of the bottom-row button switches.
  // ===========================================================
  const pbX=1356, pbY=748;                  // power block (right of the chip)
  T(pbX,pbY-8,"POWER",MUT,12,700);
  BOX(pbX,pbY,180,58,BLKF,BLKS);
  T(pbX+90,pbY+25,"DC-DC buck",INK,13,700,"middle");T(pbX+90,pbY+43,"24 V → 5 V",MUT,11,500,"middle");
  // 24V input on the right
  L(pbX+180,pbY+29,pbX+230,pbY+29,PWR,2);FLAG(pbX+230,pbY+29,"+24 V",PWR);
  // buck GND tie
  L(pbX+90,pbY+58,pbX+90,pbY+86,GNDC);GND(pbX+90,pbY+86);T(pbX+106,pbY+90,"common GND",MUT,10,500);
  // +5V out of buck → left into VSYS pad (short rail, clear of switches)
  const railY=pbY+29;
  L(pbX,railY,vsysGeo.cx,railY,PWR,2);
  L(vsysGeo.cx,railY,vsysGeo.cx,vsysGeo.padBot,PWR,2);
  DOT(vsysGeo.cx,vsysGeo.padBot,PWR);
  T((pbX+vsysGeo.cx)/2,railY-8,"+5V → VSYS",PWR,11,800,"middle");

  // ===========================================================
  //  PERIPHERAL: WS2812 status LED on GPIO21 (bottom band, right
  //  of the button switches so nothing overlaps)
  // ===========================================================
  const wbY=770;
  BOX(ledGeo.cx-90,wbY,180,46,BLKF,"#39d98a","5 4");
  T(ledGeo.cx,wbY+20,"WS2812",GRN,13,700,"middle");T(ledGeo.cx,wbY+36,"onboard status LED",MUT,10,500,"middle");
  // GPIO21 pad → straight down into the WS2812 box
  L(ledGeo.cx,ledGeo.padBot,ledGeo.cx,wbY,GRN,1.8);
  DOT(ledGeo.cx,ledGeo.padBot,GRN);
  T(ledGeo.cx+34,(ledGeo.padBot+wbY)/2+4,"GPIO21",GRN,10.5,700,"start");

  // ===========================================================
  //  PERIPHERAL: USB-C (native USB on 19/20) — top band, right
  // ===========================================================
  const ubX=usb19.cx-90, ubY=224;           // top band, below the title block
  BOX(ubX,ubY,210,50,BLKF,BLKS);
  T(ubX+105,ubY+21,"USB-C",INK,13,700,"middle");T(ubX+105,ubY+37,"flash + serial (D-/D+)",MUT,10,500,"middle");
  // two leads from the box bottom straight down into the 19 & 20 pad tops
  L(usb19.cx,ubY+50,usb19.cx,usb19.padTop,WIRE,1.8);DOT(usb19.cx,usb19.padTop,WIRE);
  L(usb20.cx,ubY+50,usb20.cx,usb20.padTop,WIRE,1.8);DOT(usb20.cx,usb20.padTop,WIRE);
  T(usb19.cx-7,(ubY+50+usb19.padTop)/2,"D-",MUT,10,600,"end");
  T(usb20.cx+7,(ubY+50+usb20.padTop)/2,"D+",MUT,10,600,"start");

  // ===========================================================
  //  Common-GND illustration: ground tick on a bottom-row GND pad
  // ===========================================================
  const gndIdx=bot.findIndex((p,i)=>p[0]==="GND"&&i===17);
  if(gndIdx>=0){const gg=B_[gndIdx];L(gg.cx,gg.padBot,gg.cx,gg.padBot+14,GNDC);GND(gg.cx,gg.padBot+14);}

  // ===========================================================
  //  TITLE BLOCK (top-right)
  // ===========================================================
  BOX(1300,104,270,94,"#ffffff",BLKS);L(1300,136,1570,136,BLKS,1);L(1300,168,1570,168,BLKS,1);
  T(1312,124,"LookingGlass — Control Panel",INK,12,800);
  T(1312,156,"Board: ESP32-S3-Pico (R8)",MUT,11,500);
  T(1312,188,"Rev 0.1 · Sheet 1/1 · active-low",MUT,11,500);

  // ===========================================================
  //  LAMP DRIVERS — low-side N-MOSFET per lamp (×5)
  //  Lamps run from a separate 5V/12V rail; each lamp GPIO PWMs a
  //  logic-level MOSFET gate -> per-button dim/full. Common ground.
  // ===========================================================
  BOX(70,860,1500,300,"#f4f6f9","#aab6c6","6 4");
  T(88,890,"LAMP DRIVERS — low-side N-MOSFET per lamp (×5, one per arcade button)",INK,13,800);
  T(88,908,"lamps powered from a separate 5 V / 12 V rail · each lamp GPIO PWMs the MOSFET gate → per-button dim/full · common GND",MUT,11,500);

  // one representative driver
  const ly=1040,mx=470,dT=ly-30,dB=ly+30,drnX=mx+36;
  // lamp rail + LED (the lamp) feeding the drain, drawn vertically above it
  FLAG(drnX,dT-66,"+5 / 12 V",PWR);
  L(drnX,dT-66,drnX,dT-48,PWR,2);
  g.appendChild(el("path",{d:"M "+(drnX-11)+" "+(dT-48)+" L "+(drnX+11)+" "+(dT-48)+" L "+drnX+" "+(dT-28)+" Z",fill:"none",stroke:INK,"stroke-width":1.6}));
  L(drnX-11,dT-28,drnX+11,dT-28,INK,2);L(drnX,dT-28,drnX,dT,WIRE);
  L(drnX+16,dT-46,drnX+25,dT-55,GRN,1.4);L(drnX+16,dT-36,drnX+25,dT-45,GRN,1.4);
  T(drnX+18,dT-26,"button lamp",MUT,10,500,"start");
  // MOSFET (low-side N-channel): drain top, source bottom, gate left
  L(mx,ly-16,mx,ly+16,INK,2);
  L(mx+10,ly-16,mx+10,ly-6,INK,1.8);L(mx+10,ly-4,mx+10,ly+4,INK,1.8);L(mx+10,ly+6,mx+10,ly+16,INK,1.8);
  L(mx+10,ly-11,mx+36,ly-11,INK,1.6);L(mx+36,ly-11,mx+36,dT,INK,1.6);
  L(mx+10,ly+11,mx+36,ly+11,INK,1.6);L(mx+36,ly+11,mx+36,dB,INK,1.6);
  L(mx+10,ly,mx+36,ly,INK,1.4);
  g.appendChild(el("path",{d:"M "+(mx+24)+" "+(ly-4)+" L "+(mx+15)+" "+ly+" L "+(mx+24)+" "+(ly+4)+" Z",fill:INK}));
  GND(mx+36,dB);
  T(mx+48,dT+4,"M1 — logic-level N-MOS",INK,10,700,"start");
  T(mx+48,dT+18,"(e.g. AO3400 / IRLZ44N)",MUT,9.5,500,"start");
  // gate drive: GPIO -> 150Ω -> gate ; gate -> 10k -> GND (off at boot)
  L(mx-120,ly,mx,ly,INK,1.6);
  g.appendChild(el("rect",{x:mx-92,y:ly-9,width:42,height:18,rx:2,fill:"#fff",stroke:INK,"stroke-width":1.4}));
  T(mx-71,ly-14,"150 Ω",MUT,9,600,"middle");
  T(mx-126,ly+4,"GPIO (PWM)",AMB,11,800,"end");
  L(mx-40,ly,mx-40,ly+34,INK,1.4);
  g.appendChild(el("rect",{x:mx-49,y:ly+34,width:18,height:40,rx:2,fill:"#fff",stroke:INK,"stroke-width":1.4}));
  T(mx-56,ly+58,"10 kΩ",MUT,9,600,"end");
  L(mx-40,ly+74,mx-40,ly+88,GNDC);GND(mx-40,ly+88);
  T(mx-16,ly+96,"gate pulldown — lamps OFF at boot",MUT,9,500,"start");

  // the 5 lamp drivers map
  T(840,924,"×5 — one driver per arcade lamp:",INK,12,800);
  [["LAMP1","GPIO40 · Arcade 1"],["LAMP2","GPIO42 · Arcade 2"],["LAMP3","GPIO48 · Arcade 3"],["LAMP4","GPIO18 · Arcade 4"],["LAMP5","GPIO17 · Arcade 5"]].forEach((r,i)=>{
    T(840,956+i*26,r[0]+"   =   "+r[1],MUT,11.5,600);});
  T(840,956+5*26+10,"logic-level MOSFET (Vgs(th) < 2.5 V) · 150 Ω gate series · 10 kΩ pulldown",MUT,10,500);
  T(840,956+5*26+28,"common ground with the ESP32 · lamp rail 5 V or 12 V to match the buttons",MUT,10,500);
  T(840,956+5*26+50,"FUTURE — one ULN2803A 8-ch driver board replaces all ×5 (no gate R/pulldown needed):",INK,10.5,700);
  T(840,956+5*26+66,"amazon.com/ULN2803A-.../dp/B08C5B1S47",("#2f6df0"),10,700);

  return [W,H];
}

// ===================================================================
//  PINOUT — dark reference strip (separate from the schematic)
// ===================================================================
const COL={btn:"#e0b54a",lamp:"#e0902e",led:"#39d98a",pwr:"#e06a5a",gnd:"#6b7a90",sys:"#5aa0e0",psram:"res",usb:"res",uart:"res",strap:"res",free:"free"};
const WHY={btn:"button GPIO",lamp:"button-lamp PWM output (illuminated button)",led:"onboard WS2812 status LED",pwr:"power",gnd:"ground",sys:"system control",free:"available GPIO",psram:"octal PSRAM — do not use",usb:"native USB D-/D+ — do not use",uart:"UART0 — do not use",strap:"strapping pin — do not use"};
const fillFor=r=>{const c=COL[r];return c==="res"?"#241a1a":c==="free"?"#131c26":c;};
const strokeFor=r=>{const c=COL[r];return c==="res"?"#7a3b3b":c==="free"?"#2a3a4c":"#0008";};
const inkFor=r=>{const c=COL[r];return c==="res"?"#b06a6a":c==="free"?"#6f8198":"#0a0d12";};
function renderPinout(g){
  const N=20,pitch=56,x0=68,padW=46,padH=22,W=N*pitch+76,H=360,eT=150,eB=210;
  g.appendChild(el("rect",{x:40,y:eT,width:W-80,height:eB-eT,rx:6,fill:"#0e1822",stroke:"#2a3a4c"}));
  const t=el("text",{x:W/2,y:(eT+eB)/2+4,"text-anchor":"middle",fill:"#9fb4cc","font-size":13,"font-weight":700});t.textContent="ESP32-S3-Pico  (ESP32-S3R8)";g.appendChild(t);
  const row=(arr,isTop)=>arr.forEach((p,i)=>{const name=p[0],role=p[1],net=p[2],cx=x0+i*pitch,py=isTop?eT-padH/2:eB-padH/2;
    g.appendChild(el("rect",{x:cx-padW/2,y:py,width:padW,height:padH,rx:4,fill:fillFor(role),stroke:strokeFor(role),"stroke-dasharray":(COL[role]==="res"?"3 2":"0")}));
    const lab=el("text",{x:cx,y:py+padH/2+4,"text-anchor":"middle","font-size":11,"font-weight":600,fill:inkFor(role)});lab.textContent=name;g.appendChild(lab);
    if(net){const ty=isTop?py-26:py+padH+30;const tag=el("text",{x:cx,y:ty,"text-anchor":"middle","font-size":11,"font-weight":700,fill:COL[role]});tag.textContent=net;g.appendChild(tag);
      g.appendChild(el("line",{x1:cx,y1:isTop?py-22:py+padH+18,x2:cx,y2:isTop?py-2:py+padH+2,stroke:COL[role],"stroke-width":1.5}));}});
  row(top,true);row(bot,false);return [W,H];
}

// ===================================================================
//  SVG wrappers + HTML injection
// ===================================================================
function schematicSVG(){const g=el("g",{}),wh=renderSchematicPro(g),w=wh[0],h=wh[1],pad=20,W=w+pad*2,H=h+pad*2;
  const svg=el("svg",{xmlns:SVGNS,viewBox:"0 0 "+W+" "+H,width:W,height:H});
  svg.appendChild(el("rect",{x:0,y:0,width:W,height:H,rx:14,fill:"#fbfcfe"}));
  const wrap=el("g",{transform:"translate("+pad+","+pad+")"});wrap.appendChild(g);svg.appendChild(wrap);return serialize(svg);}
function pinoutSVG(){const g=el("g",{}),wh=renderPinout(g),w=wh[0],h=wh[1];
  const svg=el("svg",{xmlns:SVGNS,viewBox:"0 0 "+w+" "+h,width:"100%",style:"max-width:"+w+"px"});
  svg.appendChild(g);return serialize(svg);}
function pinrows(){let s="";[["top",top],["bottom",bot]].forEach(pr=>{const rn=pr[0],arr=pr[1];arr.forEach(p=>{const name=p[0],role=p[1],net=p[2];
  s+="<tr><td><code>"+name+"</code></td><td>"+rn+"</td><td>"+role+"</td><td>"+((net?net+" — ":"")+(WHY[role]||role))+"</td></tr>";});});return s;}

function inject(path){
  let html=fs.readFileSync(path,"utf8");
  const sch=schematicSVG(), pin=pinoutSVG();
  // replace whatever is currently inside the two containers (empty or previously baked SVG)
  html=html.replace(/(<div class="canvas" id="schematicPro">)[\s\S]*?(<\/div>)/,'$1'+sch+'$2');
  html=html.replace(/(<div id="pinout">)[\s\S]*?(<\/div>)/,'$1'+pin+'$2');
  // (re)build the pin-map table body, keeping the header row
  html=html.replace(/(<tr><th>Pin<\/th><th>Row<\/th><th>Role<\/th><th>Use \/ why reserved<\/th><\/tr>)[\s\S]*?(<\/table>)/,'$1'+pinrows()+'$2');
  fs.writeFileSync(path,html);
  const pinPads=(sch.match(/rx="4"/g)||[]).length;
  console.log("schematic bytes="+sch.length+" pinout bytes="+pin.length+
    " ic_pads="+pinPads+" injected="+(html.indexOf('id="schematicPro"><svg')>=0));
}

if(require.main===module){
  const path=process.argv[2];
  if(!path){console.error("usage: node gen_circuit.cjs <abs path to circuit.html>");process.exit(1);}
  inject(path);
}
module.exports={renderSchematicPro,renderPinout,top,bot};
