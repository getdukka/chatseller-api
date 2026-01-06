// src/services/product-scraper.ts
// 🛍️ Service de scraping automatique des produits Shopify/WooCommerce

import fetch from 'node-fetch';

interface ScrapedProduct {
  external_id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  images: string[];
  url: string;
  category?: string;
  tags: string[];
  variants?: any[];
  inventory_quantity?: number;
  source: 'shopify' | 'woocommerce';
}

/**
 * 🛒 SHOPIFY SCRAPER
 * Récupère tous les produits d'une boutique Shopify
 */
export async function scrapeShopifyProducts(
  shopUrl: string,
  accessToken: string
): Promise<ScrapedProduct[]> {
  const products: ScrapedProduct[] = [];

  try {
    console.log(`🛒 [SHOPIFY SCRAPER] Début scraping: ${shopUrl}`);

    // Nettoyer l'URL
    const cleanShopUrl = shopUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const apiUrl = `https://${cleanShopUrl}/admin/api/2024-01/products.json`;

    let nextPageUrl: string | null = apiUrl;
    let pageCount = 0;

    while (nextPageUrl && pageCount < 50) { // Max 50 pages (5000 produits)
      pageCount++;
      console.log(`📄 [SHOPIFY] Page ${pageCount}...`);

      const response = await fetch(nextPageUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Shopify API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { products: any[] };
      const shopifyProducts = data.products || [];

      console.log(`✅ [SHOPIFY] ${shopifyProducts.length} produits récupérés sur page ${pageCount}`);

      for (const product of shopifyProducts) {
        const scrapedProduct: ScrapedProduct = {
          external_id: `shopify_${product.id}`,
          name: product.title || 'Produit sans nom',
          description: stripHtml(product.body_html || ''),
          price: parseFloat(product.variants?.[0]?.price || '0'),
          currency: 'XOF', // À adapter selon la devise du shop
          images: (product.images || []).map((img: any) => img.src),
          url: `https://${cleanShopUrl}/products/${product.handle}`,
          category: product.product_type || undefined,
          tags: (product.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
          variants: product.variants || [],
          inventory_quantity: product.variants?.[0]?.inventory_quantity || 0,
          source: 'shopify'
        };

        products.push(scrapedProduct);
      }

      // Pagination Shopify (via header Link)
      const linkHeader = response.headers.get('Link');
      nextPageUrl = extractNextPageUrl(linkHeader);
    }

    console.log(`✅ [SHOPIFY SCRAPER] Terminé: ${products.length} produits total`);
    return products;

  } catch (error: any) {
    console.error(`❌ [SHOPIFY SCRAPER] Erreur:`, error.message);
    throw new Error(`Impossible de récupérer les produits Shopify: ${error.message}`);
  }
}

/**
 * 🛒 WOOCOMMERCE SCRAPER
 * Récupère tous les produits d'une boutique WooCommerce
 */
export async function scrapeWooCommerceProducts(
  shopUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<ScrapedProduct[]> {
  const products: ScrapedProduct[] = [];

  try {
    console.log(`🛒 [WOOCOMMERCE SCRAPER] Début scraping: ${shopUrl}`);

    const cleanShopUrl = shopUrl.replace(/\/$/, '');
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 50) { // Max 50 pages
      console.log(`📄 [WOOCOMMERCE] Page ${page}...`);

      const apiUrl = `${cleanShopUrl}/wp-json/wc/v3/products?per_page=100&page=${page}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`WooCommerce API Error: ${response.status} ${response.statusText}`);
      }

      const wooProducts = await response.json() as any[];

      if (!wooProducts || wooProducts.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`✅ [WOOCOMMERCE] ${wooProducts.length} produits récupérés sur page ${page}`);

      for (const product of wooProducts) {
        const scrapedProduct: ScrapedProduct = {
          external_id: `woocommerce_${product.id}`,
          name: product.name || 'Produit sans nom',
          description: stripHtml(product.description || product.short_description || ''),
          price: parseFloat(product.price || '0'),
          currency: 'XOF', // À adapter
          images: (product.images || []).map((img: any) => img.src),
          url: product.permalink || `${cleanShopUrl}/product/${product.slug}`,
          category: product.categories?.[0]?.name || undefined,
          tags: (product.tags || []).map((t: any) => t.name),
          inventory_quantity: product.stock_quantity || 0,
          source: 'woocommerce'
        };

        products.push(scrapedProduct);
      }

      page++;
    }

    console.log(`✅ [WOOCOMMERCE SCRAPER] Terminé: ${products.length} produits total`);
    return products;

  } catch (error: any) {
    console.error(`❌ [WOOCOMMERCE SCRAPER] Erreur:`, error.message);
    throw new Error(`Impossible de récupérer les produits WooCommerce: ${error.message}`);
  }
}

/**
 * 🧹 HELPER: Nettoie le HTML
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '') // Retirer tags HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ') // Normaliser espaces
    .trim();
}

/**
 * 🔗 HELPER: Extrait l'URL de pagination Shopify
 */
function extractNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const links = linkHeader.split(',');
  for (const link of links) {
    if (link.includes('rel="next"')) {
      const match = link.match(/<([^>]+)>/);
      return match ? match[1] : null;
    }
  }

  return null;
}

/**
 * 🎯 FONCTION PRINCIPALE: Scraper universel
 */
export async function scrapeProducts(
  platform: 'shopify' | 'woocommerce',
  credentials: {
    shop_url: string;
    access_token?: string;
    consumer_key?: string;
    consumer_secret?: string;
  }
): Promise<ScrapedProduct[]> {
  if (platform === 'shopify') {
    if (!credentials.access_token) {
      throw new Error('Access token Shopify requis');
    }
    return scrapeShopifyProducts(credentials.shop_url, credentials.access_token);
  } else {
    if (!credentials.consumer_key || !credentials.consumer_secret) {
      throw new Error('Consumer key et secret WooCommerce requis');
    }
    return scrapeWooCommerceProducts(
      credentials.shop_url,
      credentials.consumer_key,
      credentials.consumer_secret
    );
  }
}
