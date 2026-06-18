/*
  boiler_fire_overdrive
  Drop-energy flame tongues rotating around the ring with hot TriangleEdges.

  Apex polish (D4 — light touch, operator marked "best so far"):
  - Verified Rules 1-5: edges use 1-1-1 phase (floor(index/18)*0.33),
    pars active via heatFlash + per-index wave seed, bars carry pixel-art
    flame licks, brightness defaults strong (cp1V=0.78), flash gated by
    heatFlash with no hard ?: gates (pow(., 7|5|8) softens the peaks).

  E2 par visibility push: pars are now the "hottest embers" — each at its own
  ember phase (parId/3) with a bright orange/white pulse on top of an always-
  on ember glow. Undampened brightness so they punch (floor ≥ 0.22, peak ≥ 0.90).
*/
export var localSpeed=0.5; export var flameHeight=0.55; export var tongueCount=0.48; export var swirl=0.52; export var heatFlash=0.38; export var amberBias=0.45; export var blackoutDepth=0.48;
export var cp1H=0.01,cp1S=1,cp1V=0.78,cp2H=0.10,cp2S=0.92,cp2V=0.58; export function colorPalette1(h,s,v){cp1H=h;cp1S=s;cp1V=v;} export function colorPalette2(h,s,v){cp2H=h;cp2S=s;cp2V=v;}
export function sliderLocalSpeed(v){localSpeed=v;} export function sliderFlameHeight(v){flameHeight=v;} export function sliderTongueCount(v){tongueCount=v;} export function sliderSwirl(v){swirl=v;} export function sliderHeatFlash(v){heatFlash=v;} export function sliderAmberBias(v){amberBias=v;} export function sliderBlackoutDepth(v){blackoutDepth=v;}
var pr1=1,pg1=0,pb1=0,pr2=0,pg2=0,pb2=1; function hsv1(){var h=cp1H-floor(cp1H);if(h<0)h+=1;var iv=floor(h*6)%6;var f=h*6-floor(h*6);var p=cp1V*(1-cp1S);var q=cp1V*(1-f*cp1S);var tv=cp1V*(1-(1-f)*cp1S);if(iv==0){pr1=cp1V;pg1=tv;pb1=p;}else if(iv==1){pr1=q;pg1=cp1V;pb1=p;}else if(iv==2){pr1=p;pg1=cp1V;pb1=tv;}else if(iv==3){pr1=p;pg1=q;pb1=cp1V;}else if(iv==4){pr1=tv;pg1=p;pb1=cp1V;}else{pr1=cp1V;pg1=p;pb1=q;}} function hsv2(){var h=cp2H-floor(cp2H);if(h<0)h+=1;var iv=floor(h*6)%6;var f=h*6-floor(h*6);var p=cp2V*(1-cp2S);var q=cp2V*(1-f*cp2S);var tv=cp2V*(1-(1-f)*cp2S);if(iv==0){pr2=cp2V;pg2=tv;pb2=p;}else if(iv==1){pr2=q;pg2=cp2V;pb2=p;}else if(iv==2){pr2=p;pg2=cp2V;pb2=tv;}else if(iv==3){pr2=p;pg2=q;pb2=cp2V;}else if(iv==4){pr2=tv;pg2=p;pb2=cp2V;}else{pr2=cp2V;pg2=p;pb2=q;}}
function clamp01(v){if(v<0)return 0;if(v>1)return 1;return v;} function wrap01(v){v=v%1;if(v<0)v+=1;return v;} function reverseEveryTwo(v){var block=floor(v/2.0);var within=v-block*2.0;if((block%2)==0)return within;return 2.0-within;} var tFire=0,tSpark=0; export function beforeRender(delta){var m=pow(2,(localSpeed-0.5)*4);var dt=delta/1310.72*m;tFire+=dt*(0.28+swirl*1.20);tSpark+=dt*(0.90+heatFlash*2.50);hsv1();hsv2();}
export function render3D(index,x,y,z){
  var isEdge=sectionId==1,isPar=sectionId==2&&y>2,isBar=sectionId==2&&y<=2,isVintage=sectionId==3;
  var theta=wrap01((atan2(z,x)/PI2)+0.5);
  var spin=reverseEveryTwo(tFire);
  var tongues=floor(3+tongueCount*9);
  var flame=pow(wave(theta*tongues-spin+y*0.08),1.5+blackoutDepth*2.0);
  var stage=0,w=0,a=0,u=0;
  var parMix=0;
  if(isBar){
    var barT=((index-57)%18)/17;
    var lick=pow(wave(barT*(1.1+flameHeight)-spin*2.1+theta*swirl),1.4);
    stage=flame*lick*(0.35+flameHeight*0.55);
    w=pow(flame,7.0)*heatFlash;
    u=(1-flame)*blackoutDepth*0.12;
  }else if(isEdge){
    var edgeT=(index%18)/17;
    var hot=pow(wave(edgeT*1.6+spin+floor(index/18)*0.33),2.8);
    stage=hot*(0.35+heatFlash*0.55);
    w=pow(hot,5.0)*heatFlash;
  }else if(isPar){
    // E2: pars are the hottest embers, each at its own ember phase (parId/3).
    var parId=index-54;
    var parPhase=parId/3.0;
    // Always-on ember glow per par (Rule B floor).
    var ember=0.30+0.22*wave(tFire*0.9+parPhase);
    // Ember pulse — wide pow(wave,2) instead of pow(wave,8) for visibility.
    var pulse=pow(wave(tSpark*0.6+parPhase+parId*0.137),2.0);
    stage=clamp01(ember+pulse*(0.45+heatFlash*0.55));
    w=clamp01(pulse*(0.55+heatFlash*0.45)+ember*0.20);
    a=clamp01(ember*0.55+pulse*0.40);
    parMix=clamp01(0.55+parPhase*0.35+pulse*0.10);
  }else if(isVintage){
    a=(0.03+flame*.45*wave(tSpark*.5+index*.05))*amberBias;
    stage=a*.12;
  }
  var mixv=isPar?parMix:clamp01(0.18+flame*.70);
  var bri=(1-blackoutDepth)*0.018+stage*.55;
  // Pars: undampened bright path so embers read prominently.
  if(isPar)bri=0.14+stage*(0.78+heatFlash*0.18);
  rgbwau(clamp01((pr1+(pr2-pr1)*mixv)*bri),clamp01((pg1+(pg2-pg1)*mixv)*bri),clamp01((pb1+(pb2-pb1)*mixv)*bri*.28),clamp01(w),clamp01(a),clamp01(u));
}
