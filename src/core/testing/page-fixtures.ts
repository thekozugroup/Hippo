// Realistic shop page shapes for the on-device page reader's tests
// (page-metadata.test.ts). Trimmed copies of what shops serve: only the parts
// the reader looks at, with the noise around them that it must ignore.

/** Open Graph and product meta tags only (many small shops, Shopify themes). */
export const OG_ONLY = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Red wool scarf | Knit &amp; Co</title>
<meta property="og:type" content="product">
<meta property="og:title" content="Red wool scarf">
<meta property="og:image" content="https://cdn.knit.example/scarf-1200.jpg">
<meta property="og:image:secure_url" content="https://cdn.knit.example/scarf-1200.jpg">
<meta property="product:price:amount" content="24.50">
<meta property="product:price:currency" content="GBP">
<script>window.tracking = { id: 1 }</script>
</head><body><h1>Red wool scarf</h1><img src="/img/scarf.jpg"></body></html>`

/** JSON-LD Product data only, inside an @graph, with an offers array (big retailers). */
export const JSON_LD_ONLY = `<!doctype html>
<html><head>
<title>Shop</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Organization","name":"Big Store"},
  {"@type":["Product","Thing"],"name":"Trail running shoes","image":["https://img.bigstore.example/shoe-a.jpg","https://img.bigstore.example/shoe-b.jpg"],
   "offers":[{"@type":"Offer","price":"119.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}]}
]}
</script>
</head><body></body></html>`

/** Both: the JSON-LD name is cleaner than the og:title, and og:image is the larger picture. */
export const BOTH = `<!doctype html>
<html><head>
<meta property="og:title" content="Ceramic teapot - Home Goods - Free delivery">
<meta property="og:image" content="https://home.example/og/teapot.jpg">
<meta property="product:price:amount" content="40.00">
<meta property="product:price:currency" content="EUR">
<script type="application/ld+json">{"@context":"http://schema.org/","@type":"Product","name":"Ceramic teapot","image":{"@type":"ImageObject","url":"https://home.example/ld/teapot.jpg"},"offers":{"@type":"Offer","price":39.9,"priceCurrency":"EUR"}}</script>
</head><body></body></html>`

/** European shop: a price written with a decimal comma and thousands dots, in meta and in JSON-LD. */
export const COMMA_DECIMALS = `<!doctype html>
<html lang="de"><head>
<meta property="og:title" content="Espressomaschine">
<meta property="og:price:amount" content="1.299,00">
<meta property="og:price:currency" content="EUR">
</head><body></body></html>`

export const COMMA_DECIMALS_LD = `<!doctype html>
<html><head>
<script type="application/ld+json">{"@type":"Product","name":"Kaffeemühle","offers":{"@type":"AggregateOffer","lowPrice":"89,95","priceCurrency":"EUR"}}</script>
</head><body></body></html>`

/** Relative and protocol-relative picture addresses, and a <base> element. */
export const RELATIVE_IMAGES = `<!doctype html>
<html><head>
<meta property="og:title" content="Wooden train set">
<meta property="og:image" content="/media/train.jpg">
</head><body></body></html>`

export const PROTOCOL_RELATIVE_IMAGE = `<!doctype html>
<html><head>
<meta name="twitter:title" content="Kite">
<meta name="twitter:image" content="//images.kites.example/kite.png">
</head><body></body></html>`

export const BASE_ELEMENT = `<!doctype html>
<html><head>
<base href="https://static.toys.example/shop/">
<meta property="og:title" content="Puzzle">
<meta property="og:image" content="img/puzzle.jpg">
</head><body></body></html>`

/** Nothing usable: an anti-bot page and a page without metadata. */
export const BLOCK_PAGE = `<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>`
export const NOTHING = `<!doctype html><html><head></head><body><p>Hello</p></body></html>`

/** Hostile values: script in the title, a javascript: picture, http picture, a zero price, broken JSON-LD. */
export const HOSTILE = `<!doctype html>
<html><head>
<meta property="og:title" content="&lt;img src=x onerror=alert(1)&gt; Lamp‮">
<meta property="og:image" content="javascript:alert(1)">
<meta name="twitter:image" content="http://insecure.example/lamp.jpg">
<meta property="product:price:amount" content="0.00">
<meta property="product:price:currency" content="USD">
<script type="application/ld+json">{ this is not json </script>
<script type="application/ld+json">{"@type":"Product","offers":{"price":"-5","priceCurrency":"USD"}}</script>
</head><body><img src="x" onerror="window.__pwned = true"></body></html>`

/** A very large page: the metadata in the head, then several megabytes of markup. */
export function largePage(megabytes: number): string {
  const head = `<!doctype html><html><head><meta property="og:title" content="Big page product"><meta property="og:image" content="https://big.example/p.jpg"></head><body>`
  const filler = '<div class="row">lorem ipsum dolor sit amet</div>'.repeat(Math.ceil((megabytes * 1024 * 1024) / 45))
  return `${head}${filler}</body></html>`
}
