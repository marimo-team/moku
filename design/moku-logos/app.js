// Seeded, smooth SVG contours: every redraw is reproducible and exportable.
const concepts = [
  ['The first three','Triangles','Your original thought. Three distinct, open circles; one above two. The closest starting point to the marimo family.','triangle','brush'],
  ['A little closer','Triangles','The same three, leaning into each other. A compact silhouette with a small triangular breathing space.','tight','brush'],
  ['Room to grow','Triangles','Air between three very light loops. Quiet and spare, with room for each individual.','wide','single'],
  ['Off balance','Triangles','An asymmetric stack: one smaller ball sits just off center. Less diagram, more found arrangement.','offset','brush'],
  ['One breath','Triangles','Three uninterrupted pen loops. The simplest translation of the idea into a small, legible mark.','triangle','single'],
  ['Upside down','Triangles','Two above one: a descending cluster that feels like a hanging sprig.','inverted','double'],
  ['Shared edges','Loops','Three open loops overlap, suggesting a shared space without losing their own boundaries.','overlap','double'],
  ['A small knot','Loops','Three elongated loops turn toward one center, halfway between mossballs and a woven knot.','petals','double'],
  ['Pond ripples','Loops','A family of imperfect rings expands outward from one center. Many marimos, expressed as layers.','nested','single'],
  ['Loose thread','Loops','Long, wandering strokes nearly close into circles. More sketchbook, with the pen lifts left visible.','triangle','open'],
  ['One orbit','Loops','Three small mossballs enclosed by a loose outer circle. A little ecosystem of its own.','orbit','single'],
  ['Linked together','Loops','Three loops in a loose diagonal chain. A subtle nod to connected notebooks.','chain','brush'],
  ['Soft stones','Moss','Three irregular solid shapes. The most direct silhouette, designed to hold together at small sizes.','triangle','solid'],
  ['Pencil moss','Moss','Open contours with diagonal graphite-like strokes. A rough drawing of moss, without literal leaves.','tight','hatch'],
  ['Velvet edges','Moss','Fine irregular contours suggest the fuzzy surface of a mossball. Organic, with a clean interior.','triangle','fuzzy'],
  ['Living centers','Moss','Small scattered specks inside each mossball add texture without filling the entire shape.','offset','speckle'],
  ['One of many','Moss','A single solid ball among two open ones. A simple distinction: one active notebook in a small group.','triangle','mixed'],
  ['Moss prints','Moss','Three concentric, imperfect contours in each ball. A little like thumbprints or the rings of a tree.','triangle','rings'],
  ['The little plot','Four','Four open mossballs in a square, following your other arrangement. Order, softened by hand.','square','brush'],
  ['A growing family','Colonies','Five circles of different sizes nestle together. A more literal expression of many marimos.','colony','double'],
  ['A small forest','Colonies','Six mossballs form a low pyramid. A larger collective that still reads as a single shape.','six','single'],
  ['In company','Colonies','Three different sizes on one baseline. Friendly and informal, like stones collected beside a pond.','row','brush'],
  ['A hidden m','Symbols','Two open loops share a rising stroke. A looser, more abstract monogram built from the same circular language.','monogram','single'],
  ['Clover study','Symbols','A continuous three-lobed outline encloses one shared space. Three mossballs become one organism.','clover','double'],
  ['Loose square','Four','Four single pen loops, with generous breathing room. The clearest version of your two-by-two idea.','square','single'],
  ['Huddled four','Four','Four loose, layered circles almost touch. The small diamond of negative space becomes part of the mark.','four-tight','brush'],
  ['A little diamond','Four','Turn the square through forty-five degrees. Four mossballs gather around an open center.','diamond','brush'],
  ['Uneven ground','Four','A gently irregular square: different sizes, slightly wandering centers. A little colony rather than a rigid grid.','four-offset','brush'],
  ['The newcomer','Four','Three established mossballs with a smaller fourth tucked into the corner. A family with room to grow.','four-small','double'],
  ['Four shared spaces','Four','Four overlapping loops produce a small central window. A connected system, drawn with a loose hand.','four-overlap','single'],
  ['River stones','Four','Four irregular solid shapes in an offset square. A compact, tactile silhouette with generous gaps.','four-offset','solid'],
  ['One awake','Four','One solid circle and three open loops. An active notebook within a group of four.','square','mixed'],
  ['Four moss prints','Four','Concentric rings turn each of the four circles into a small organic fingerprint.','four-tight','rings'],
  ['A drifting raft','Four','Two staggered pairs shift sideways. The arrangement suggests movement while keeping four distinct circles.','four-stagger','open'],
  ['Pencil quartet','Four','Four lightly hatched mossballs form a close square. A textured, sketchbook interpretation.','four-tight','hatch'],
  ['Four in bloom','Four','Four elongated open loops turn around the same center. A more abstract botanical direction.','four-petals','double'],
  ['One filled','One different','Three matching hand-drawn rings; the top-right mossball is solid. A clear, compact accent.','square','corner-filled'],
  ['A smaller neighbor','One different','Three matching rings and one smaller ring in the top-right corner.','square','corner-small'],
  ['Room for one more','One different','The top-right circle is reduced to a small solid seed. The other three stay identical.','square','corner-seed'],
  ['A little louder','One different','Only the top-right ring has a heavier stroke. The same shape, with a different emphasis.','square','corner-bold'],
  ['A quiet corner','One different','Three layered rings and one delicate single outline in the top-right.','square','corner-light'],
  ['One pencil patch','One different','Only the top-right mossball carries diagonal pencil hatching.','square','corner-hatch'],
  ['One living center','One different','Only the top-right circle holds a scattering of moss-like speckles.','square','corner-speckle'],
  ['One fingerprint','One different','Concentric rings distinguish the top-right mossball from three matching outlines.','square','corner-rings'],
  ['An open corner','One different','One unfinished loop in the top-right; the other three keep their closed, layered contours.','square','corner-open'],
  ['One warm note','One different','A warm clay ring in the top-right adds a second ink to three matching rings.','square','corner-color'],
  ['A warm seed','One different','One solid clay mossball in the top-right; three matching open rings surround it.','square','corner-color-solid'],
  ['A centered dot','One different','All four rings match. A small solid dot marks just the top-right circle.','square','corner-dot'],
  ['A second center','One different','All four outer rings match. One extra inner ring distinguishes the top-right.','square','corner-inner'],
  ['One soft edge','One different','Only the top-right ring has a fuzzy moss-like edge. A subtle surface variation.','square','corner-fuzzy'],
  ['One left open','One different','Three matching solid mossballs with one open ring in the top-right corner.','square','corner-reverse'],
  ['One pale wash','One different','Four matching outlines, with a translucent wash inside just the top-right circle.','square','corner-wash'],
].map(([name,family,description,layout,style],i)=>({id:i+1,name,family,description,layout,style}));
const $ = id => document.getElementById(id);
const defaults = {wobble:1,weight:1,spacing:1,color:'#1c7361',seed:12,wordmark:false};
let state = {...defaults}, filter = location.hash === '#corner' ? 'One different' : location.hash === '#four' ? 'Four' : 'All sketches', selected = 1, favorites = new Set();
try { favorites = new Set(JSON.parse(localStorage.getItem('moku-logo-favorites') || '[]').filter(id=>Number.isInteger(id)&&id>=1&&id<=concepts.length)); } catch {}
function random(seed){ return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;}; }
const fmt = n => n.toFixed(2);
function contour(cx,cy,rx,ry,rng,rough=1,rotation=0,open=false,fuzzy=false){
  const phase=rng()*Math.PI*2,phase2=rng()*Math.PI*2, points=[], count=fuzzy?80:48;
  const start=open?-.8:0, span=open?Math.PI*1.83:Math.PI*2;
  for(let i=0;i<count;i++){
    const a=start+i/(open?count-1:count)*span;
    const ripple=(Math.sin(a*3+phase)*.035+Math.cos(a*5+phase2)*.016+Math.sin(a*2-phase)*.035)*rough;
    const r=1+ripple+(fuzzy?(rng()-.5)*.11*rough:0);
    const x=Math.cos(a)*rx*r,y=Math.sin(a)*ry*r;
    points.push([cx+x*Math.cos(rotation)-y*Math.sin(rotation),cy+x*Math.sin(rotation)+y*Math.cos(rotation)]);
  }
  let d=`M ${points[0].map(fmt).join(' ')}`;
  for(let i=0;i<(open?count-1:count);i++){
    const p0=points[(i-1+count)%count],p1=points[i],p2=points[(i+1)%count],p3=points[(i+2)%count];
    const a=open&&i===0?p1:p0,b=open&&i===count-2?p2:p3;
    d+=` C ${fmt(p1[0]+(p2[0]-a[0])/6)} ${fmt(p1[1]+(p2[1]-a[1])/6)} ${fmt(p2[0]-(b[0]-p1[0])/6)} ${fmt(p2[1]-(b[1]-p1[1])/6)} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d+(open?'':' Z');
}
function layout(name){switch(name){
  case 'tight':return [[100,67,29],[70,119,29],[130,119,29]];
  case 'wide':return [[100,51,25],[57,127,25],[143,127,25]];
  case 'offset':return [[111,61,24],[66,115,32],[130,122,28]];
  case 'inverted':return [[65,71,29],[135,71,29],[100,131,29]];
  case 'overlap':return [[100,73,34],[77,113,34],[123,113,34]];
  case 'petals':return [[100,76,26,44,0],[80,111,26,44,-1.05],[120,111,26,44,1.05]];
  case 'nested':return [[100,100,65],[101,101,45],[100,103,24]];
  case 'orbit':return [[100,100,68],[100,75,20],[77,117,20],[123,117,20]];
  case 'chain':return [[64,126,31],[101,99,31],[137,72,31]];
  case 'four-tight':return [[71,71,28],[129,71,28],[71,129,28],[129,129,28]];
  case 'diamond':return [[100,47,24],[47,100,24],[153,100,24],[100,153,24]];
  case 'four-offset':return [[67,65,28],[132,72,24],[72,132,25],[133,132,30]];
  case 'four-small':return [[67,65,29],[133,69,27],[72,134,28],[130,131,17]];
  case 'four-overlap':return [[78,78,32],[122,78,32],[78,122,32],[122,122,32]];
  case 'four-stagger':return [[62,70,24],[119,70,24],[82,127,24],[139,127,24]];
  case 'four-petals':return [[100,68,24,40],[132,100,40,24],[100,132,24,40],[68,100,40,24]];
  case 'square':return [[65,65,27],[135,65,27],[65,135,27],[135,135,27]];
  case 'colony':return [[99,55,23],[62,93,25],[120,101,29],[78,143,20],[141,149,18]];
  case 'six':return [[100,48,21],[76,91,21],[124,91,21],[52,134,21],[100,134,21],[148,134,21]];
  case 'row':return [[48,112,24],[102,103,31],[155,117,20]];
  default:return [[100,61,28],[65,122,28],[135,122,28]];
}}
function svg(c,opts={}){
  const rng=random(state.seed+c.id*371), rough=state.wobble, weight=state.weight;
  const color=opts.color||state.color,wordmark=opts.iconOnly?false:state.wordmark;
  let parts=[];
  const path=(d,w=1.5,fill='none',opacity=1,ink=color)=>`<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${fmt(w*weight)}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
  if(c.layout==='monogram'){
    parts.push(path('M 39 133 C 25 60 68 51 80 82 C 96 132 32 146 40 103 C 46 70 83 69 101 126 C 89 67 119 51 140 72 C 174 107 139 147 119 126 C 99 104 134 70 160 85',3));
    if(rough>0)parts.push(path('M 42 134 C 29 59 67 55 78 82 M 102 126 C 91 69 121 54 141 75 C 169 106 141 146 120 124',rough*.7));
  }else if(c.layout==='clover'){
    for(let j=0;j<2;j++){
      let d='';const phase=rng()*.2;
      for(let i=0;i<=180;i++){const a=i/180*Math.PI*2;const r=53+17*Math.cos(3*(a+Math.PI/2))+rough*1.8*Math.sin(7*a+phase+j);const x=100+Math.cos(a)*r*state.spacing,y=102+Math.sin(a)*r*state.spacing;d+=`${i?' L':'M'} ${fmt(x)} ${fmt(y)}`;}
      parts.push(path(d+' Z',j?1:2.2));
    }
  }else{
    layout(c.layout).forEach(([x,y,rx,ry=rx,rot=0],idx)=>{
      const corner=c.style.startsWith('corner-');
      const special=corner && idx===1; // Top-right in the two-by-two layout.
      // Reuse the same local contour for the three unchanged balls and across studies.
      const localRng=corner?random(state.seed+7301):rng;
      const mode=c.style.slice(7);
      let style=corner?'brush':c.style;
      if(corner && mode==='reverse')style=special?'brush':'solid';
      if(special){
        const styles={filled:'solid',seed:'solid',light:'single',hatch:'hatch',speckle:'speckle',rings:'rings',open:'open','color-solid':'solid',fuzzy:'fuzzy'};
        style=styles[mode]||style;
        if(mode==='small'){rx*=.64;ry*=.64;}
        if(mode==='seed'){rx*=.4;ry*=.4;}
      }
      const accent=special && mode.startsWith('color');
      const ballColor=accent?(state.color==='#ad563a'?'#1c7361':'#ad563a'):color;
      const ballPath=(d,w=1.5,fill='none',opacity=1)=>path(d,w*(special&&mode==='bold'?2.5:1),fill,opacity,ballColor);
      x=100+(x-100)*state.spacing;y=100+(y-100)*state.spacing;
      const base=contour(x,y,rx,ry,localRng,rough,rot,false,style==='fuzzy');
      if(special && mode==='wash')parts.push(ballPath(base,0,ballColor,.18));
      if(special && mode==='dot')parts.push(ballPath(contour(x,y,5,5,random(state.seed+45),rough),.5,ballColor));
      if(special && mode==='inner')parts.push(ballPath(contour(x,y,rx*.53,ry*.53,random(state.seed+45),rough),1.5));
      const solid=style==='solid'||style==='mixed'&&idx===0;
      if(solid){parts.push(ballPath(base,.8,ballColor));return;}
      if(style==='brush'){
        for(let j=0;j<4;j++){const scale=1+(j-1.5)*.035;parts.push(ballPath(contour(x+(localRng()-.5)*rough*3,y+(localRng()-.5)*rough*3,rx*scale,ry*scale,localRng,rough*(j?1.1:.65),rot,j===3),j===0?2.1:j===3?.7:1.1));}
      }else if(style==='open'){
        parts.push(ballPath(contour(x,y,rx,ry,localRng,rough,rot,true),1.9));parts.push(ballPath(contour(x+rough,y,rx*.96,ry*1.04,localRng,rough,rot+.1,true),.7));
      }else{
        parts.push(ballPath(base,style==='fuzzy'?1.8:2));
        if(style==='double')parts.push(ballPath(contour(x+rough*1.5,y-rough,rx*.94,ry*1.04,localRng,rough,rot),.9));
        if(style==='rings')for(const scale of [.77,.54,.29])parts.push(ballPath(contour(x,y,rx*scale,ry*scale,localRng,rough*1.3,rot),1.1));
        if(style==='hatch'){
          // Analytic clipped diagonals stay inside the circular interior.
          for(let v=-rx*.75;v<rx*.8;v+=5){const half=Math.sqrt(Math.max(0,rx*rx*.85-v*v));parts.push(ballPath(`M ${fmt(x+(v-half)*.707)} ${fmt(y+(v+half)*.707)} Q ${fmt(x+v*.707+rough)} ${fmt(y+v*.707)} ${fmt(x+(v+half)*.707)} ${fmt(y+(v-half)*.707)}`,.75));}
        }
        if(style==='speckle')for(let k=0;k<38;k++){const angle=localRng()*Math.PI*2,r=Math.sqrt(localRng())*rx*.84;const dx=x+Math.cos(angle)*r,dy=y+Math.sin(angle)*r;parts.push(ballPath(`M ${fmt(dx)} ${fmt(dy)} l ${fmt((localRng()-.5)*2)} ${fmt(localRng()*2.2)}`,1.1));}
      }
    });
  }
  const content=parts.join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${wordmark?'0 0 360 200':'0 0 200 200'}" fill="none" role="img" aria-label="moku — ${c.name}"><title>moku — ${c.name}</title>${wordmark?`<g transform="translate(0 15) scale(.85)">${content}</g><text x="170" y="119" fill="${color}" font-family="Arial Rounded MT Bold, ui-rounded, sans-serif" font-size="58" font-weight="700" letter-spacing="-3">moku</text>`:content}</svg>`;
}
function displayColor(){return document.body.classList.contains('dark')?({'#1c7361':'#99cbb0','#444c2d':'#c5cc9c','#292923':'#edece2','#4269a0':'#a1bce2','#ad563a':'#e6a68c'}[state.color]):state.color;}
function visible(){return concepts.filter(c=>filter==='All sketches'||filter==='Favorites'&&favorites.has(c.id)||c.family===filter);}
function saveFavorites(){try{localStorage.setItem('moku-logo-favorites',JSON.stringify([...favorites]));}catch{}}
function toggleFavorite(id){favorites.has(id)?favorites.delete(id):favorites.add(id);saveFavorites();render();if($('detail').open)renderDetail();}
function render(){
  $('families').innerHTML=['All sketches','Triangles','Four','One different','Loops','Moss','Colonies','Symbols','Favorites'].map(f=>`<button class="${filter===f?'active':''}" aria-pressed="${filter===f}" data-filter="${f}">${f}${f==='Favorites'?` (${favorites.size})`:''}</button>`).join('');
  const items=visible();$('count').textContent=`${String(items.length).padStart(2,'0')} STUDIES / ${filter.toUpperCase()}`;$('empty').hidden=items.length>0;
  $('gallery').innerHTML=items.map(c=>`<article class="card"><div class="card-top"><span class="number">${String(c.id).padStart(2,'0')}</span><button class="star" data-star="${c.id}" aria-label="${favorites.has(c.id)?'Unfavorite':'Favorite'} ${c.name}" aria-pressed="${favorites.has(c.id)}">${favorites.has(c.id)?'★':'☆'}</button></div><button class="open-art" data-open="${c.id}" aria-label="Inspect ${c.name}">${svg(c,{color:displayColor()})}</button><div class="card-caption"><h2>${c.name}</h2><span>${c.family}</span></div></article>`).join('');
}
function renderDetail(){const c=concepts[selected-1];$('detail-index').textContent=`STUDY ${String(c.id).padStart(2,'0')} / ${concepts.length}`;$('detail-family').textContent=c.family;$('detail-title').textContent=c.name;$('detail-description').textContent=c.description;$('detail-art').innerHTML=svg(c,{color:displayColor()});$('sizes').innerHTML=[16,24,32,48].map(n=>`<div class="size-sample"><div style="width:${n}px;height:${n}px">${svg(c,{iconOnly:true,color:displayColor()})}</div>${n}px</div>`).join('');$('keep').textContent=favorites.has(c.id)?'★ Kept':'☆ Keep';$('keep').setAttribute('aria-pressed',favorites.has(c.id));}
function openDetail(id){selected=id;renderDetail();$('detail').showModal();}
$('families').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(b){filter=b.dataset.filter;history.replaceState(null,'',filter==='One different'?'#corner':filter==='Four'?'#four':'#');render();}});
$('gallery').addEventListener('click',e=>{const star=e.target.closest('[data-star]'),open=e.target.closest('[data-open]');if(star)toggleFavorite(Number(star.dataset.star));else if(open)openDetail(Number(open.dataset.open));});
for(const name of ['wobble','weight','spacing'])$(name).addEventListener('input',()=>{state[name]=Number($(name).value);$(name+'-value').textContent=Number($(name).value).toFixed(name==='spacing'?2:1);render();});
document.querySelectorAll('[data-color]').forEach(b=>b.addEventListener('click',()=>{state.color=b.dataset.color;updateSwatches();render();}));
function updateSwatches(){document.querySelectorAll('[data-color]').forEach(b=>{b.classList.toggle('active',b.dataset.color===state.color);b.setAttribute('aria-pressed',b.dataset.color===state.color);});}
$('wordmark').addEventListener('change',()=>{state.wordmark=$('wordmark').checked;render();});
$('reroll').addEventListener('click',()=>{state.seed+=137;render();});
$('reset').addEventListener('click',()=>{state={...defaults};for(const name of ['wobble','weight','spacing']){$(name).value=state[name];$(name+'-value').textContent='1.0';}$('wordmark').checked=false;updateSwatches();render();});
$('theme').addEventListener('click',()=>{document.body.classList.toggle('dark');$('theme').textContent=document.body.classList.contains('dark')?'Light paper':'Dark paper';render();});
$('close').addEventListener('click',()=>$('detail').close());
$('detail').addEventListener('click',e=>{if(e.target===$('detail')){const r=$('detail').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('detail').close();}});
$('keep').addEventListener('click',()=>toggleFavorite(selected));
function navigate(direction){const items=visible();if(!items.length)return;const i=items.findIndex(c=>c.id===selected);selected=items[(i+direction+items.length)%items.length].id;renderDetail();}
$('previous').addEventListener('click',()=>navigate(-1));$('next').addEventListener('click',()=>navigate(1));
$('detail').addEventListener('keydown',e=>{if(e.key==='ArrowLeft')navigate(-1);if(e.key==='ArrowRight')navigate(1);});
$('download').addEventListener('click',()=>{const c=concepts[selected-1],blob=new Blob([svg(c,{color:displayColor()})],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`moku-${String(c.id).padStart(2,'0')}-${c.name.toLowerCase().replaceAll(' ','-')}.svg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('hashchange',()=>{filter=location.hash==='#corner'?'One different':location.hash==='#four'?'Four':'All sketches';render();});
render();
