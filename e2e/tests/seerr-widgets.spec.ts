import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";
import { expectWidgetStatLayout, expectWidgetStatContrast } from "../helpers/widget-stat";

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const FOOTPRINTS = [{columnSpan:3,rowSpan:2},{columnSpan:6,rowSpan:2},{columnSpan:3,rowSpan:4}];
const STATS = {pending:3,approved:7,available:42,total:52};
const REQUESTS = Array.from({length:15}, (_,i) => ({
  id:i+1,requestStatus:i%5+1,mediaStatus:i%5===2?5:3,mediaType:i%2 ? "tv":"movie",
  title:["Dune: Part Two","Severance","Interstellar","The Bear","Arrival"][i%5],
  seasons:i%2 ? [1,2] : null,requestedBy:["Alex","Sam","Jordan"][i%3],
  createdAt:new Date(Date.now()-(i+1)*3600000).toISOString(),tmdbId:100+i,
}));
const FIXTURES = schemaV2Fixtures([
 {name:"Seerr Stats",description:"Media requests",size:"normal",widget:{type:"seerr-stats",config:{url:"http://localhost:5055",api_key:"dummy"}}},
 {name:"Seerr Requests",description:"Recently requested media",size:"tall",widget:{type:"seerr-requests",config:{url:"http://localhost:5055",api_key:"dummy"}}},
]);
const tile = (page: Page, type="seerr-stats") => page.locator(".service-tile").filter({has:page.locator(`[data-widget-type="${type}"]`)});
async function configure(request:APIRequestContext, options:{theme?:string;footprint?:{columnSpan:number;rowSpan:number};custom_css?:string;longText?:boolean}={}) {
 expect((await request.patch("/api/settings",{data:{...FIXTURES,
  service_tiles:FIXTURES.service_tiles.map((entry,i)=>({...entry,footprint:i===0?(options.footprint??FOOTPRINTS[0]):{columnSpan:3,rowSpan:4}})),
  services:FIXTURES.services.map(entry=>({...entry,...(options.longText?{name:"Seerr with a deliberately very long service name",description:"A very long description of media requests, approvals and completed downloads"}:{})})),
  groups:[],bookmarks:[],appearance:{theme:options.theme??"dark",custom_css:options.custom_css},
 }})).ok()).toBe(true);
}
async function mock(page:Page, stats:unknown=STATS, requests:unknown=REQUESTS) {
 await page.route("**/api/widget*",async route=>{
  const id=new URL(route.request().url()).searchParams.get("tile_id");
  if(!FIXTURES.service_tiles.some(entry=>entry.id===id)) return route.continue();
  await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data:id===FIXTURES.service_tiles[0].id?stats:requests})});
 });
}
function labels(size:{columnSpan:number;rowSpan:number}) {
 return size.rowSpan===4?["Pending","Approved","Available","Total"]:size.columnSpan===6?["Pending","Available","Total"]:["Pending","Available"];
}
async function statsFit(page:Page,size=FOOTPRINTS[0]) {
 await expectWidgetStatLayout(tile(page),{width:size.columnSpan===6?688:340,height:size.rowSpan===4?264:128,columns:size.columnSpan===6?3:2,rows:size.rowSpan===4?2:1});
}
async function requestsFit(widget:Locator) {
 const fit=await widget.evaluate(element=>{
  const list=element.querySelector(".widget-list__scroll")!;
  const notice=element.querySelector(".widget-body__notice")!;
  const rect=element.getBoundingClientRect();
  const lr=list.getBoundingClientRect(),nr=notice.getBoundingClientRect();
  const rows=Array.from(list.querySelectorAll(".widget-list-item"));
  const accessories=rows.flatMap(row=>Array.from(row.querySelectorAll(".widget-badge,.widget-list-item__trailing")));
  return {debug:accessories.map(node=>{const range=document.createRange();range.selectNodeContents(node);const t=range.getBoundingClientRect(),r=node.getBoundingClientRect();return {className:node.className,text:node.textContent,textBounds:[t.x,t.y,t.width,t.height],bounds:[r.x,r.y,r.width,r.height]};}),noHorizontalScroll:list.scrollWidth<=list.clientWidth,
   contained:lr.left>=rect.left && lr.right<=rect.right && lr.top>=rect.top && nr.bottom<=rect.bottom,
   noticeAfterList:nr.top>=lr.bottom-0.5,
   accessoriesReadable:accessories.every(node=>{
    const range=document.createRange();range.selectNodeContents(node);
    const t=range.getBoundingClientRect(),r=node.getBoundingClientRect();
    return t.left>=r.left-0.5&&t.right<=r.right+0.5&&t.top>=r.top-0.5&&t.bottom<=r.bottom+0.5;
   }),scrolling:list.scrollHeight>list.clientHeight};
 });
 const {debug,...measured}=fit;
 expect(measured,JSON.stringify(debug)).toEqual({noHorizontalScroll:true,contained:true,noticeAfterList:true,accessoriesReadable:true,scrolling:true});
}
async function badgeContrast(widget:Locator) {
 const ratios=await widget.locator(".widget-badge").evaluateAll(badges=>{
  const canvas=document.createElement("canvas");canvas.width=canvas.height=1;
  const ctx=canvas.getContext("2d")!;
  const luminance=(color:string)=>{
   ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
   const rgb=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3);
   return rgb.map(c=>{const v=c/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
  };
  return badges.map(badge=>{const style=getComputedStyle(badge);const [a,b]=[luminance(style.color),luminance(style.backgroundColor)].sort((a,b)=>b-a);return(a+0.05)/(b+0.05);});
 });
 expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
}

test("Seerr shared stats and requests fit all themes and selected footprints",async({page,request},testInfo)=>{
 await mock(page);
 for(const size of FOOTPRINTS) for(const theme of THEMES){
  await configure(request,{theme,footprint:size});await page.goto("/");
  await expect(tile(page).locator(".widget-stat__label")).toHaveText(labels(size));
  await statsFit(page,size);await expectWidgetStatContrast(tile(page));
  await expect(tile(page,"seerr-requests").getByRole("listitem")).toHaveCount(15);
  await requestsFit(tile(page,"seerr-requests"));await badgeContrast(tile(page,"seerr-requests"));
  const name=`seerr-stats-${size.columnSpan}x${size.rowSpan}-${theme}`;
  await testInfo.attach(name,{body:await tile(page).screenshot({path:process.env.KOKPIT_WIDGET_PREVIEW_DIR?`${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/${name}.png`:undefined}),contentType:"image/png"});
 }
});

test("Seerr keeps all requests keyboard reachable with readable metadata and full long titles",async({page,request})=>{
 const title="A deliberately very long television series title that needs truncation";
 const requester="A requester with a very long display name";
 await mock(page,{pending:123456789,approved:987654321,available:123456789,total:999999999},REQUESTS.map(item=>({...item,title,requestedBy:requester})));
 for(const size of FOOTPRINTS){
  await configure(request,{footprint:size,longText:true});await page.goto("/");await expect(tile(page).locator(".widget-stat__value").first()).toHaveText("123456789");await statsFit(page,size);
  await expect(tile(page).locator(".service-tile__name")).toHaveAttribute("title",/deliberately/);
 }
 const widget=tile(page,"seerr-requests");await requestsFit(widget);
 await expect(widget.locator(".widget-list-item__title").first()).toHaveAttribute("title",title);
 await expect(widget.locator(".widget-list-item__secondary").first()).toHaveAttribute("title",requester);
 const list=widget.getByRole("list",{name:"Recent Seerr requests"});
 await list.focus();await list.press("End");
 await expect.poll(()=>list.evaluate(node=>node.scrollTop+node.clientHeight>=node.scrollHeight-1)).toBe(true);
 await expect(widget.getByRole("listitem").last()).toBeInViewport();
 await list.press("Home");await expect.poll(()=>list.evaluate(node=>node.scrollTop)).toBe(0);
});

test("Seerr keeps status priority, category colors and zero meanings",async({page,request})=>{
 await mock(page,{pending:0,approved:0,available:0,total:0},[
 {...REQUESTS[0],requestStatus:3,mediaStatus:5},
 {...REQUESTS[1],requestStatus:2}, {...REQUESTS[2],mediaStatus:3,requestStatus:3},
 {...REQUESTS[3],requestStatus:4}, {...REQUESTS[4],requestStatus:1},
 ]);
 await configure(request,{footprint:FOOTPRINTS[2]});await page.goto("/");
 for(const [key,tone] of [["pending","neutral"],["approved","info"],["available","neutral"],["total","info"]]){
  await expect(tile(page).locator(`.seerr-stats-widget__stat--${key}`)).toHaveClass(new RegExp(`widget-stat--tone-${tone}`));
 }
 const badges=tile(page,"seerr-requests").locator(".seerr-requests-widget__badge");
 await expect(badges).toHaveText(["available","approved","declined","failed","pending"]);
 for(const [index,tone] of ["positive","info","neutral","alert","warning"].entries()) await expect(badges.nth(index)).toHaveClass(new RegExp(`widget-badge--tone-${tone}`));
});

test("Seerr initial loading, error, null data and empty request states use shared feedback",async({page,request})=>{
 await configure(request,{custom_css:`.seerr-requests-widget__hint, .seerr-stats-widget__hint { padding-top:7px; } .seerr-requests-widget__hint--error, .seerr-stats-widget__hint--error { color:#040506; }`});
 let release!:()=>void;const initial=new Promise<void>(resolve=>{release=resolve;});
 let response:unknown={ok:false,error:"Seerr unavailable"};
 await page.route("**/api/widget*",async route=>{await initial;await route.fulfill({contentType:"application/json",body:JSON.stringify(response)});});
 await page.goto("/");
 for(const type of ["seerr-stats","seerr-requests"]) {
  const loading=tile(page,type).getByRole("status",{name:"Loading widget"});
  await expect(loading).toHaveClass(/widget-state--loading/);
  await expect(loading).toHaveClass(new RegExp(`${type}-widget__hint`));
  await expect(loading).toHaveCSS("padding-top","7px");
 }
 release();
 for(const type of ["seerr-stats","seerr-requests"]) {
  const error=tile(page,type).getByRole("alert");
  await expect(error).toHaveText("Seerr unavailable");
  await expect(error.locator(".widget-state__label")).toHaveClass(new RegExp(`${type}-widget__hint--error`));
  await expect(error.locator(".widget-state__label")).toHaveCSS("color","rgb(4, 5, 6)");
 }
 response={ok:true,data:null};await page.reload();
 for(const type of ["seerr-stats","seerr-requests"]) await expect(tile(page,type).locator(".widget-body")).toBeEmpty();
 await page.unroute("**/api/widget*");await mock(page,STATS,[]);await page.reload();
 await expect(tile(page,"seerr-requests").getByText("No requests")).toHaveClass(/widget-state--empty/);
});

test("Seerr refresh failure and recovery preserve stats, list scroll and notice positions",async({page,request},testInfo)=>{
 let fails=false;
 await page.route("**/api/widget*",async route=>{
  const id=new URL(route.request().url()).searchParams.get("tile_id");
  const data=id===FIXTURES.service_tiles[0].id?STATS:REQUESTS;
  await route.fulfill({contentType:"application/json",body:JSON.stringify(fails?{ok:false,error:"Seerr rejected the API key"}:{ok:true,data})});
 });
 await page.clock.install();
 for(const theme of THEMES){
  fails=false;await configure(request,{theme,footprint:FOOTPRINTS[2]});await page.goto("/");
  const list=tile(page,"seerr-requests").getByRole("list");await expect(list.getByRole("listitem")).toHaveCount(15);
  await list.evaluate(node=>{node.scrollTop=120;});
  const bounds=()=>page.locator(".widget-stat,.widget-list__scroll,.widget-body__notice").evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
  const healthy=await bounds();const scroll=await list.evaluate(node=>node.scrollTop);
  fails=true;await page.clock.fastForward(60000);
  for(const type of ["seerr-stats","seerr-requests"]){
   await expect(tile(page,type).getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Seerr rejected the API key");
  }
  expect(await bounds()).toEqual(healthy);expect(await list.evaluate(node=>node.scrollTop)).toBe(scroll);
  await statsFit(page,FOOTPRINTS[2]);await requestsFit(tile(page,"seerr-requests"));
  if(theme==="dark") await testInfo.attach("Seerr stale",{body:await page.locator(".dashboard-tile-grid").screenshot({path:process.env.KOKPIT_WIDGET_PREVIEW_DIR?`${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/seerr-stale-dark.png`:undefined}),contentType:"image/png"});
  fails=false;await page.clock.fastForward(60000);
  for(const type of ["seerr-stats","seerr-requests"]) await expect(tile(page,type).getByRole("alert")).toHaveCount(0);expect(await bounds()).toEqual(healthy);expect(await list.evaluate(node=>node.scrollTop)).toBe(scroll);
 }
});

test("ordinary custom CSS overrides Seerr shared cards, rows and badges",async({page,request})=>{
 await configure(request,{custom_css:`.seerr-stats-widget__stat { border-radius:12px; } .seerr-stats-widget__value { color:#040506; } .seerr-requests-widget__row { padding:9px 4px; } .seerr-requests-widget__badge { color:#040506; border-radius:8px; }`});
 await mock(page);await page.goto("/");
 await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("border-radius","12px");
 await expect(tile(page).locator(".widget-stat__value").first()).toHaveCSS("color","rgb(4, 5, 6)");
 await expect(tile(page,"seerr-requests").getByRole("listitem").first()).toHaveCSS("padding-top","9px");
 await expect(tile(page,"seerr-requests").locator(".seerr-requests-widget__badge").first()).toHaveCSS("color","rgb(4, 5, 6)");
});

test("Seerr comparison previews match existing shared cards",async({page,request},testInfo)=>{
 await page.setViewportSize({width:1108,height:780});
 const fixtures=schemaV2Fixtures([
  {name:"Tdarr",size:"normal",widget:{type:"tdarr-stats",config:{url:"http://localhost:8265"}}},
  ...["Compact","Detailed","Wide"].map((name,i)=>({name:`Seerr · ${name}`,size:["normal","tall","wide"][i] as "normal"|"tall"|"wide",widget:{type:"seerr-stats",config:{url:"http://localhost:5055",api_key:"dummy"}}})),
  {name:"Seerr · Requests",size:"tall",widget:{type:"seerr-requests",config:{url:"http://localhost:5055",api_key:"dummy"}}},
 ]);
 await page.route("**/api/widget*",async route=>{
  const id=new URL(route.request().url()).searchParams.get("tile_id");
  const data=id===fixtures.service_tiles[0].id?{transcodeQueue:12,healthCheckQueue:5,errored:3,spaceSavedGb:12400,activeWorkers:4,fps:65.8}:id===fixtures.service_tiles[4].id?REQUESTS:STATS;
  await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,data})});
 });
 for(const theme of ["dark","light"]){
  expect((await request.patch("/api/settings",{data:{...fixtures,groups:[],bookmarks:[],appearance:{theme}}})).ok()).toBe(true);await page.goto("/");
  await expect(page.locator(".widget-stat")).toHaveCount(11);await expect(page.getByRole("listitem")).toHaveCount(15);
  const metrics=(type:string)=>page.locator(`[data-widget-type="${type}"] .widget-stat`).first().evaluate(node=>{const s=getComputedStyle(node);return{padding:s.padding,radius:s.borderRadius,height:node.getBoundingClientRect().height,valueFont:getComputedStyle(node.querySelector("dd")!).fontSize,labelFont:getComputedStyle(node.querySelector("dt")!).fontSize};});
  expect(await metrics("seerr-stats")).toEqual(await metrics("tdarr-stats"));
  await testInfo.attach(`Seerr comparison ${theme}`,{body:await page.locator(".dashboard-tile-grid").screenshot({path:process.env.KOKPIT_WIDGET_PREVIEW_DIR?`${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/seerr-comparison-${theme}.png`:undefined}),contentType:"image/png"});
 }
});

test("Seerr retains an empty saved request list through refresh failure",async({page,request})=>{
 await configure(request);let fails=false;
 await page.route("**/api/widget*",async route=>{
  const id=new URL(route.request().url()).searchParams.get("tile_id");
  await route.fulfill({contentType:"application/json",body:JSON.stringify(fails?{ok:false,error:"Connection lost"}:{ok:true,data:id===FIXTURES.service_tiles[0].id?STATS:[]})});
 });
 await page.clock.install();await page.goto("/");
 const widget=tile(page,"seerr-requests");await expect(widget.getByText("No requests")).toBeVisible();
 const bounds=()=>widget.locator(".widget-list__empty,.widget-body__notice").evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
 const healthy=await bounds();fails=true;await page.clock.fastForward(60000);
 await expect(widget.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Connection lost");
 await expect(widget.getByText("No requests")).toBeVisible();expect(await bounds()).toEqual(healthy);
 fails=false;await page.clock.fastForward(60000);await expect(widget.getByRole("alert")).toHaveCount(0);expect(await bounds()).toEqual(healthy);
});
