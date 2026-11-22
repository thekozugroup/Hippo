// FR-10: the bookmarklet and the iOS Shortcut script. Both read the current
// page's title, address, image and price from its metadata and open Hippo's
// deep link (FR-9), so nothing is fetched by Hippo itself. The address is
// the page's canonical link when it has one, else the page address without
// its fragment, with well-known tracking parameters removed (a published
// wish shows its link to givers). Core's capture removes them again.

import { TRACKING_PARAMS } from '../../core/index.ts'

/** Source of a regular expression matching tracking parameter names, mirroring core's `isTrackingParam`. */
export function trackingParamSource(): string {
  return `^(utm_.*|${TRACKING_PARAMS.map((p) => p.replace(/[^a-z0-9_]/gi, '')).join('|')})$`
}

/** The address of this Hippo install: origin and path, without query or fragment. */
export function appBaseUrl(loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return loc.origin + loc.pathname
}

/** JavaScript body (no `javascript:` prefix) that builds the deep link into `u`. */
function collector(appUrl: string): string {
  return [
    `var m=function(n){var e=document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"],meta[itemprop="'+n+'"]');return e&&e.getAttribute('content')||''};`,
    `var p=new URLSearchParams();`,
    `p.set('title',(m('og:title')||document.title||'').slice(0,300));`,
    `var cu=location.href.split('#')[0];`,
    `var cl=document.querySelector('link[rel="canonical"]');`,
    `if(cl&&cl.href){try{var cx=new URL(cl.getAttribute('href'),location.href);if(cx.protocol==='https:'||cx.protocol==='http:')cu=cx.href.split('#')[0]}catch(x){}}`,
    `try{var uu=new URL(cu),tr=new RegExp(${JSON.stringify(trackingParamSource())},'i');Array.from(uu.searchParams.keys()).forEach(function(k){if(tr.test(k))uu.searchParams.delete(k)});cu=uu.href}catch(x){}`,
    `p.set('url',cu);`,
    `var i=m('og:image');if(i){try{p.set('image',new URL(i,location.href).href)}catch(x){}}`,
    `var pr=m('product:price:amount')||m('og:price:amount')||m('price');if(pr)p.set('price',pr);`,
    `var c=m('product:price:currency')||m('og:price:currency')||m('priceCurrency');if(c)p.set('currency',c);`,
    `var u=${JSON.stringify(appUrl)}+'?'+p.toString();`,
  ].join('')
}

/** A bookmarklet URL that opens Hippo's Add Item form for the current page. */
export function bookmarkletCode(appUrl: string): string {
  return `javascript:(function(){${collector(appUrl)}window.open(u,'_blank','noopener')})()`
}

/** Script for the Shortcuts "Run JavaScript on Web Page" action; its result is the URL to open. */
export function shortcutScript(appUrl: string): string {
  return `${collector(appUrl)}completion(u);`
}
