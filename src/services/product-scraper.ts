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
 * 🛒 SHOPIFY SCRAPER - API PUBLIQUE (SANS TOKEN)
 * Récupère les produits via /products.json (endpoint public)
 * Fonctionne si la boutique n'a pas désactivé cet endpoint
 */
export async function scrapeShopifyPublic(shopUrl: string): Promise<ScrapedProduct[]> {
  const products: ScrapedProduct[] = [];

  try {
    console.log(`🛒 [SHOPIFY PUBLIC] Tentative via /products.json: ${shopUrl}`);

    // Nettoyer l'URL
    const cleanShopUrl = shopUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // ✅ Détecter la devise depuis /shop.json (endpoint public Shopify)
    let shopCurrency = 'EUR';
    try {
      const shopInfoResponse = await fetch(`https://${cleanShopUrl}/shop.json`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'ChatSeller/1.0' }
      });
      if (shopInfoResponse.ok) {
        const shopInfo = await shopInfoResponse.json() as any;
        shopCurrency = shopInfo?.shop?.currency || 'EUR';
        console.log(`💱 [SHOPIFY PUBLIC] Devise détectée: ${shopCurrency}`);
      }
    } catch {
      console.log(`💱 [SHOPIFY PUBLIC] Devise non détectée, fallback EUR`);
    }

    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 20) { // Max 20 pages (500 produits avec limit=250)
      const apiUrl = `https://${cleanShopUrl}/products.json?limit=250&page=${page}`;
      console.log(`📄 [SHOPIFY PUBLIC] Page ${page}: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ChatSeller/1.0'
        }
      });

      if (!response.ok) {
        if (page === 1) {
          throw new Error(`Endpoint /products.json non accessible (${response.status}). Utilisez un Access Token.`);
        }
        break;
      }

      const data = await response.json() as { products: any[] };
      const shopifyProducts = data.products || [];

      if (shopifyProducts.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`✅ [SHOPIFY PUBLIC] ${shopifyProducts.length} produits récupérés sur page ${page}`);

      for (const product of shopifyProducts) {
        // ✅ Gestion des tags (peut être string ou array selon l'API)
        let tags: string[] = [];
        if (Array.isArray(product.tags)) {
          tags = product.tags.map((t: string) => t.trim()).filter(Boolean);
        } else if (typeof product.tags === 'string') {
          tags = product.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
        }

        const scrapedProduct: ScrapedProduct = {
          external_id: `shopify_${product.id}`,
          name: product.title || 'Produit sans nom',
          description: stripHtml(product.body_html || ''),
          price: parseFloat(product.variants?.[0]?.price || '0'),
          currency: shopCurrency,
          images: (product.images || []).map((img: any) => img.src),
          url: `https://${cleanShopUrl}/products/${product.handle}`,
          category: product.product_type || undefined,
          tags,
          variants: product.variants || [],
          inventory_quantity: product.variants?.[0]?.inventory_quantity || 0,
          source: 'shopify'
        };

        products.push(scrapedProduct);
      }

      page++;
    }

    console.log(`✅ [SHOPIFY PUBLIC] Terminé: ${products.length} produits total`);
    return products;

  } catch (error: any) {
    console.error(`❌ [SHOPIFY PUBLIC] Erreur:`, error.message);
    throw error;
  }
}

/**
 * 🛒 SHOPIFY SCRAPER - API ADMIN (AVEC TOKEN)
 * Récupère tous les produits d'une boutique Shopify via Admin API
 */
export async function scrapeShopifyProducts(
  shopUrl: string,
  accessToken: string
): Promise<ScrapedProduct[]> {
  const products: ScrapedProduct[] = [];

  try {
    console.log(`🛒 [SHOPIFY ADMIN] Début scraping: ${shopUrl}`);

    // Nettoyer l'URL
    const cleanShopUrl = shopUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // ✅ Détecter la devise depuis Admin API /shop.json
    let shopCurrency = 'EUR';
    try {
      const shopInfoResponse = await fetch(`https://${cleanShopUrl}/admin/api/2024-01/shop.json`, {
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' }
      });
      if (shopInfoResponse.ok) {
        const shopInfo = await shopInfoResponse.json() as any;
        shopCurrency = shopInfo?.shop?.currency || 'EUR';
        console.log(`💱 [SHOPIFY ADMIN] Devise détectée: ${shopCurrency}`);
      }
    } catch {
      console.log(`💱 [SHOPIFY ADMIN] Devise non détectée, fallback EUR`);
    }

    const apiUrl = `https://${cleanShopUrl}/admin/api/2024-01/products.json`;

    let nextPageUrl: string | null = apiUrl;
    let pageCount = 0;

    while (nextPageUrl && pageCount < 50) { // Max 50 pages (5000 produits)
      pageCount++;
      console.log(`📄 [SHOPIFY ADMIN] Page ${pageCount}...`);

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

      console.log(`✅ [SHOPIFY ADMIN] ${shopifyProducts.length} produits récupérés sur page ${pageCount}`);

      for (const product of shopifyProducts) {
        // ✅ Gestion des tags (peut être string ou array selon l'API)
        let tags: string[] = [];
        if (Array.isArray(product.tags)) {
          tags = product.tags.map((t: string) => t.trim()).filter(Boolean);
        } else if (typeof product.tags === 'string') {
          tags = product.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
        }

        const scrapedProduct: ScrapedProduct = {
          external_id: `shopify_${product.id}`,
          name: product.title || 'Produit sans nom',
          description: stripHtml(product.body_html || ''),
          price: parseFloat(product.variants?.[0]?.price || '0'),
          currency: shopCurrency,
          images: (product.images || []).map((img: any) => img.src),
          url: `https://${cleanShopUrl}/products/${product.handle}`,
          category: product.product_type || undefined,
          tags,
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

    console.log(`✅ [SHOPIFY ADMIN] Terminé: ${products.length} produits total`);
    return products;

  } catch (error: any) {
    console.error(`❌ [SHOPIFY ADMIN] Erreur:`, error.message);
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

    // ✅ Détecter la devise WooCommerce via l'API settings
    let shopCurrency = 'EUR';
    try {
      const currencyResponse = await fetch(`${cleanShopUrl}/wp-json/wc/v3/settings/general/woocommerce_currency`, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
          'Content-Type': 'application/json'
        }
      });
      if (currencyResponse.ok) {
        const currencyData = await currencyResponse.json() as any;
        shopCurrency = currencyData?.value || 'EUR';
        console.log(`💱 [WOOCOMMERCE] Devise détectée: ${shopCurrency}`);
      }
    } catch {
      console.log(`💱 [WOOCOMMERCE] Devise non détectée, fallback EUR`);
    }

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
          currency: shopCurrency,
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
 * Pour Shopify: essaie d'abord l'endpoint public /products.json (SANS TOKEN)
 * Si échec ou token fourni explicitement, utilise l'API Admin
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
    // 🎯 STRATÉGIE SHOPIFY:
    // 1. Si pas de token → essayer endpoint public /products.json
    // 2. Si token fourni → utiliser API Admin directement
    // 3. Si public échoue et pas de token → erreur claire

    if (!credentials.access_token) {
      // ✅ Essayer l'endpoint PUBLIC (sans authentification)
      console.log('🔓 [SCRAPER] Pas de token fourni, tentative via endpoint public...');
      try {
        const products = await scrapeShopifyPublic(credentials.shop_url);
        if (products.length > 0) {
          console.log(`✅ [SCRAPER] Succès via endpoint public: ${products.length} produits`);
          return products;
        }
        throw new Error('Aucun produit trouvé via endpoint public');
      } catch (publicError: any) {
        console.warn(`⚠️ [SCRAPER] Endpoint public échoué: ${publicError.message}`);
        throw new Error(
          `Impossible d'accéder aux produits sans token. ` +
          `L'endpoint public /products.json n'est pas accessible ou est vide. ` +
          `Veuillez fournir un Access Token Shopify.`
        );
      }
    } else {
      // ✅ Token fourni → API Admin
      console.log('🔐 [SCRAPER] Token fourni, utilisation API Admin...');
      return scrapeShopifyProducts(credentials.shop_url, credentials.access_token);
    }
  } else {
    // WooCommerce nécessite toujours les credentials
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
