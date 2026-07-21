import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()

    // Proxy an image to avoid CORS (returns base64)
    if (body.action === 'proxy' && body.url) {
      const imgRes = await fetch(body.url, {
        headers: {
          'Referer': 'https://www.taobao.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        }
      })
      if (!imgRes.ok) throw new Error(`圖片載入失敗: ${imgRes.status}`)
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

    // Scrape Taobao — try both desktop + mobile URLs
    const { url } = body
    if (!url) throw new Error('url is required')

    // Extract item ID for mobile fallback
    const idMatch = url.match(/[?&]id=(\d+)/) || url.match(/\/i(\d+)\.htm/)
    const itemId = idMatch?.[1]

    // Try mobile URL first (less aggressive blocking)
    const urlsToTry = itemId
      ? [`https://h5.m.taobao.com/awp/core/detail.htm?id=${itemId}`, url]
      : [url]

    let html = ''
    let finalStatus = 0
    for (const tryUrl of urlsToTry) {
      const res = await fetch(tryUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Referer': 'https://www.taobao.com/',
        },
        redirect: 'follow',
      })
      finalStatus = res.status
      html = await res.text()
      if (html.length > 5000) break
    }

    const images: string[] = []

    // Pattern 1: mainImageList
    const mainListMatch = html.match(/"mainImageList"\s*:\s*\[([^\]]+)\]/)
    if (mainListMatch) {
      for (const m of mainListMatch[1].matchAll(/"(\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi)) {
        const imgUrl = 'https:' + m[1].split('?')[0]
        if (!images.includes(imgUrl) && imgUrl.includes('alicdn')) images.push(imgUrl)
        if (images.length >= 9) break
      }
    }

    // Pattern 2: picUrl / pict_url
    if (images.length < 3) {
      for (const m of html.matchAll(/"(?:picUrl|pict_url)"\s*:\s*"((?:https?:)?\/\/[^"]+)"/g)) {
        const imgUrl = m[1].startsWith('//') ? 'https:' + m[1] : m[1]
        if (!images.includes(imgUrl)) images.push(imgUrl)
        if (images.length >= 9) break
      }
    }

    // Pattern 3: any alicdn imgextra URLs
    if (images.length < 3) {
      for (const m of html.matchAll(/"((?:https?:)?\/\/img\.alicdn\.com\/imgextra\/[^"]+\.(?:jpg|jpeg|png))"/gi)) {
        const imgUrl = m[1].startsWith('//') ? 'https:' + m[1] : m[1]
        if (!images.includes(imgUrl)) images.push(imgUrl)
        if (images.length >= 9) break
      }
    }

    // Pattern 4: og:image
    if (images.length < 1) {
      const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
      if (og) images.push(og[1])
    }

    // Title
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    const htmlTitle = html.match(/<title[^>]*>(.*?)<\/title>/is)
    let title = (ogTitle?.[1] ?? htmlTitle?.[1] ?? '')
      .replace(/-\s*淘寶.*$/i, '').replace(/淘寶.*$/i, '').replace(/\s*-\s*手機.*$/i, '').trim()

    return new Response(JSON.stringify({
      images,
      title,
      count: images.length,
      // Debug info: helps diagnose future issues without exposing full HTML
      _debug: { htmlLen: html.length, status: finalStatus, hasItemId: !!itemId }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
