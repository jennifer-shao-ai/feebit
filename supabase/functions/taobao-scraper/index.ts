import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.taobao.com/',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()

    // Proxy an image to avoid CORS (returns base64)
    if (body.action === 'proxy' && body.url) {
      const imgRes = await fetch(body.url, { headers: TB_HEADERS })
      if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`)
      const buffer = await imgRes.arrayBuffer()
      const uint8 = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i])
      const base64 = btoa(binary)
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
      return new Response(JSON.stringify({ base64, contentType }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Scrape a Taobao product page for images + title
    const { url } = body
    if (!url) throw new Error('url is required')

    const res = await fetch(url, { headers: TB_HEADERS })
    const html = await res.text()
    const images: string[] = []

    // Strategy 1: mainImageList in embedded JSON
    const mainListMatch = html.match(/"mainImageList"\s*:\s*\[([^\]]+)\]/)
    if (mainListMatch) {
      for (const m of mainListMatch[1].matchAll(/"(\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi)) {
        const imgUrl = 'https:' + m[1].split('?')[0]
        if (!images.includes(imgUrl) && imgUrl.includes('alicdn')) images.push(imgUrl)
        if (images.length >= 9) break
      }
    }

    // Strategy 2: picUrl patterns
    if (images.length < 3) {
      for (const m of html.matchAll(/"picUrl"\s*:\s*"(\/\/[^"]+)"/g)) {
        const imgUrl = 'https:' + m[1]
        if (!images.includes(imgUrl)) images.push(imgUrl)
        if (images.length >= 9) break
      }
    }

    // Strategy 3: alicdn image URLs in script tags
    if (images.length < 3) {
      for (const m of html.matchAll(/"(\/\/img\.alicdn\.com\/imgextra\/[^"]+\.(?:jpg|jpeg|png))"/gi)) {
        const imgUrl = 'https:' + m[1]
        if (!images.includes(imgUrl)) images.push(imgUrl)
        if (images.length >= 9) break
      }
    }

    // Strategy 4: pict_url in JSON
    if (images.length < 3) {
      for (const m of html.matchAll(/"pict_url"\s*:\s*"(https?:\/\/[^"]+)"/g)) {
        if (!images.includes(m[1])) images.push(m[1])
        if (images.length >= 9) break
      }
    }

    // Extract title
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    const htmlTitle = html.match(/<title[^>]*>(.*?)<\/title>/is)
    let title = (ogTitle ? ogTitle[1] : htmlTitle ? htmlTitle[1] : '')
      .replace(/-\s*淘寶.*$/i, '').replace(/淘寶.*$/i, '').trim()

    return new Response(JSON.stringify({ images, title, count: images.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
