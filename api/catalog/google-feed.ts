import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCachedCatalog } from '../lib/catalogCache';
import { fetchUpstreamCatalogSingleflight } from '../modules/catalog/catalogSingleflight';
import { getTargetErpUrl, getErpFallbackUrl, getErpApiKey } from '../lib/erpKey';
import { applyCorsHeaders } from '../lib/cors';

function escapeXml(unsafe: any): string {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Automated Google Merchant Center XML Product Feed (RSS 2.0 / Google Shopping)
 * Endpoint: /api/catalog/google-feed or /google-feed.xml
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCorsHeaders(req, res)) return;

  const targetHost = req.headers['x-forwarded-host'] || req.headers.host || 'synergy-b2b-portal.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = `${proto}://${targetHost}`;

  const currency = String(req.query.currency || 'KZT').toUpperCase();
  const exchangeRate = Number(req.query.rate) || 500; // Default KZT/USD conversion rate

  let catalog: any = null;
  try {
    const cached = await getCachedCatalog('catalog_global');
    catalog = cached?.data;
    if (!catalog) {
      catalog = await fetchUpstreamCatalogSingleflight({
        targetErpUrl: getTargetErpUrl(),
        fallbackErpUrl: getErpFallbackUrl(),
        serverErpKey: getErpApiKey(),
      });
    }
  } catch (err) {
    console.warn('[GoogleFeed] Error reading cached catalog:', err);
  }

  const rawProducts = catalog?.products || catalog?.items || [];
  const itemsXml: string[] = [];

  for (const p of rawProducts) {
    if (!p || !p.id) continue;
    const variants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [null];

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const itemId = v?.sku || (v?.id ? `prod-${p.id}-var-${v.id}` : `prod-${p.id}`);
      const variantSize = v?.size ? ` — ${v.size}` : '';
      const title = `${p.name || p.collection || 'Ковер'}${variantSize}`;

      const descParts = [
        p.name ? `${p.name}.` : '',
        p.collection ? `Коллекция: ${p.collection}.` : '',
        p.material ? `Материал: ${p.material}.` : '',
        p.density ? `Плотность: ${p.density}.` : '',
        p.pile_height ? `Ворс: ${p.pile_height}.` : '',
        p.country ? `Страна: ${p.country}.` : '',
      ].filter(Boolean).join(' ');

      const link = `${baseUrl}/?product=${encodeURIComponent(p.id)}`;
      const images = Array.isArray(p.images) && p.images.length > 0
        ? p.images
        : (p.image ? [p.image] : [`${baseUrl}/logo-emblem.png`]);

      const primaryImage = images[0];
      const additionalImages = images.slice(1, 10);

      // Price calculation
      const basePrice = Number(v?.base_price ?? p.price ?? 50);
      let formattedPrice = '';
      if (currency === 'USD') {
        formattedPrice = `${basePrice.toFixed(2)} USD`;
      } else {
        const kztPrice = Math.round(basePrice * exchangeRate);
        formattedPrice = `${kztPrice}.00 KZT`;
      }

      const totalStock = Number(v?.free_stock ?? v?.stock ?? p.stock ?? 10);
      const availability = totalStock > 0 ? 'in_stock' : 'out_of_stock';
      const brand = p.manufacturer || 'Synergy Group';

      let itemSnippet = `    <item>\n`;
      itemSnippet += `      <g:id>${escapeXml(itemId)}</g:id>\n`;
      itemSnippet += `      <g:title><![CDATA[${title}]]></g:title>\n`;
      itemSnippet += `      <g:description><![CDATA[${descParts || title}]]></g:description>\n`;
      itemSnippet += `      <g:link>${escapeXml(link)}</g:link>\n`;
      itemSnippet += `      <g:image_link>${escapeXml(primaryImage)}</g:image_link>\n`;

      for (const addImg of additionalImages) {
        if (addImg) {
          itemSnippet += `      <g:additional_image_link>${escapeXml(addImg)}</g:additional_image_link>\n`;
        }
      }

      itemSnippet += `      <g:condition>new</g:condition>\n`;
      itemSnippet += `      <g:availability>${availability}</g:availability>\n`;
      itemSnippet += `      <g:price>${formattedPrice}</g:price>\n`;
      itemSnippet += `      <g:brand><![CDATA[${brand}]]></g:brand>\n`;
      itemSnippet += `      <g:product_type><![CDATA[Дом и сад > Декор > Ковры и дорожки]]></g:product_type>\n`;
      itemSnippet += `      <g:google_product_category>607</g:google_product_category>\n`;
      itemSnippet += `      <g:identifier_exists>no</g:identifier_exists>\n`;
      itemSnippet += `    </item>`;

      itemsXml.push(itemSnippet);
    }
  }

  const xmlOutput = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Synergy Group — Каталог ковровых изделий</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>Официальный товарный фид ковров ТОО «Синэнергия Груп» для Google Merchant Center</description>
${itemsXml.join('\n')}
  </channel>
</rss>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=14400, stale-while-revalidate=86400');
  res.status(200).send(xmlOutput);
}
