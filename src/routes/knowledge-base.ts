// src/routes/knowledge-base.ts 
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient } from '../lib/supabase';
import * as path from 'path';
import * as crypto from 'crypto';

// ✅ CONFIGURATION DES LIMITES PAR PLAN
const PLAN_LIMITS = {
  free: { documents: 10, fileSize: 5 * 1024 * 1024 }, // 5MB
  starter: { documents: 10, fileSize: 10 * 1024 * 1024 }, // 10MB
  pro: { documents: 50, fileSize: 25 * 1024 * 1024 }, // 25MB
  enterprise: { documents: -1, fileSize: 100 * 1024 * 1024 } // Illimité, 100MB par fichier
};

// ✅ TYPES DE FICHIERS AUTORISÉS
const ALLOWED_MIME_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/csv': '.csv',
  'text/plain': '.txt'
};

// ✅ INTERFACES ADAPTÉES POUR SUPABASE
interface KnowledgeBaseDocument {
  id: string;
  shopId: string;
  title: string;
  content: string;
  linkedAgents: string[];
  contentType: 'manual' | 'file' | 'url' | 'website';
  sourceFile: string | null;
  sourceUrl: string | null;
  metadata: Record<string, any>;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Shop {
  id: string;
  name: string;
  email: string;
  subscription_plan: string;
  is_active: boolean;
  created_at: string;
  trial_ends_at?: string | null;
}

interface SafeMetadata {
  originalFileName?: string;
  fileSize?: number;
  mimeType?: string;
  processedAt?: string;
  wordCount?: number;
  extractedAt?: string;
  sourceUrl?: string;
  extractionMethod?: string;
  createdManually?: boolean;
  lastModified?: string;
  storagePath?: string;
  storageUrl?: string;
  contentLength?: number;
  [key: string]: any;
}

// ✅ SCHÉMAS DE VALIDATION
const createKnowledgeBaseSchema = z.object({
  title: z.string().min(1, 'Le titre est requis').max(255, 'Titre trop long'),
  content: z.string().min(1, 'Le contenu est requis'),
  contentType: z.enum(['manual', 'file', 'url', 'website']),
  sourceFile: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  metadata: z.record(z.any()).optional()
});

const extractUrlSchema = z.object({
  url: z.string().url('URL invalide'),
  title: z.string().optional()
});

const websiteProcessSchema = z.object({
  url: z.string().url('URL invalide'),
  title: z.string().optional(),
  tags: z.array(z.string()).default([])
});

const updateKnowledgeBaseSchema = createKnowledgeBaseSchema.partial();

const toggleKnowledgeBaseSchema = z.object({
  isActive: z.boolean()
});

// ✅ HELPER: Vérifier l'auth Supabase
async function verifySupabaseAuth(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Token manquant');
  }

  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabaseServiceClient.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Token invalide');
  }
  
  return user;
}

// ✅ HELPER: Récupérer shop avec vérification plan et essai (SUPABASE CORRIGÉ)
async function getShopWithPlanCheck(user: any): Promise<{ shop: Shop; canAccess: boolean; reason?: string }> {
  try {
    const { data: shop, error } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error || !shop) {
      return { shop: null as any, canAccess: false, reason: 'Shop non trouvé' };
    }

    // ✅ VÉRIFIER SI L'ESSAI GRATUIT EST EXPIRÉ
    const now = new Date();
    const isTrialExpired = shop.trial_ends_at && now > new Date(shop.trial_ends_at);
    const isPaidPlan = ['starter', 'pro', 'enterprise'].includes(shop.subscription_plan);

    if (isTrialExpired && !isPaidPlan) {
      return { 
        shop, 
        canAccess: false, 
        reason: 'Essai gratuit expiré. Passez à un plan payant pour accéder à la base de connaissances.' 
      };
    }

    if (!shop.is_active) {
      return { 
        shop, 
        canAccess: false, 
        reason: 'Compte désactivé' 
      };
    }

    return { shop, canAccess: true };

  } catch (error) {
    throw error;
  }
}

// ✅ HELPER: Vérifier les limites du plan (SUPABASE CORRIGÉ)
async function checkPlanLimits(shopId: string, plan: string): Promise<{ 
  canAdd: boolean; 
  currentCount: number; 
  limit: number; 
  reason?: string 
}> {
  const planConfig = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;
  
  const { count, error } = await supabaseServiceClient
    .from('knowledge_base')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', shopId);

  if (error) {
    console.error('Erreur comptage documents:', error);
    return { canAdd: false, currentCount: 0, limit: planConfig.documents, reason: 'Erreur lors de la vérification' };
  }

  const currentCount = count || 0;

  if (planConfig.documents === -1) {
    return { canAdd: true, currentCount, limit: -1 };
  }

  const canAdd = currentCount < planConfig.documents;
  
  return {
    canAdd,
    currentCount,
    limit: planConfig.documents,
    reason: canAdd ? undefined : `Limite du plan ${plan} atteinte (${planConfig.documents} documents max)`
  };
}

// ✅ HELPER: Extraire contenu d'une URL (VERSION ULTRA-ROBUSTE)
async function extractContentFromUrl(url: string): Promise<{ title: string; content: string; metadata: SafeMetadata }> {
  const startTime = Date.now();
  
  try {
    console.log(`🌐 [EXTRACTION] Début extraction: ${url}`);
    
    // ✅ VALIDATION URL
    if (!url || !url.startsWith('http')) {
      throw new Error(`URL invalide: ${url}`);
    }
    
    // ✅ TIMEOUT PLUS LONG ET ROBUSTE
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`⏰ [EXTRACTION] Timeout pour ${url} après 45s`);
      controller.abort();
    }, 45000); // 45 secondes
    
    let response: Response;
    
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ChatSeller-Bot/1.0; +https://chatseller.app)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.8,en-US;q=0.5,en;q=0.3',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        signal: controller.signal,
        redirect: 'follow',
        referrer: 'no-referrer'
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        throw new Error(`Timeout lors de la récupération de ${url}`);
      }
      
      console.error(`❌ [EXTRACTION] Erreur fetch ${url}:`, fetchError.message);
      throw new Error(`Erreur réseau pour ${url}: ${fetchError.message}`);
    }
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`❌ [EXTRACTION] HTTP ${response.status} pour ${url}`);
      throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
    }
    
    // ✅ VÉRIFIER LE CONTENT-TYPE
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      console.warn(`⚠️ [EXTRACTION] Content-type inattendu pour ${url}: ${contentType}`);
      // Continuer quand même, certains sites ne définissent pas correctement le content-type
    }
    
    const html = await response.text();
    console.log(`📥 [EXTRACTION] HTML récupéré: ${html.length} caractères`);
    
    // ✅ EXTRACTION ULTRA-ROBUSTE DU TITRE
    let title = 'Document extrait';
    
    try {
      // Plusieurs patterns pour récupérer le titre
      const titlePatterns = [
        /<title[^>]*>([^<]+)<\/title>/i,
        /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
        /<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i,
        /<h1[^>]*>([^<]+)<\/h1>/i
      ];
      
      for (const pattern of titlePatterns) {
        const match = html.match(pattern);
        if (match && match[1] && match[1].trim().length > 0) {
          title = match[1]
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s\-\.\,\!\?\:\;]/g, '')
            .substring(0, 200);
          
          if (title.length > 10) { // Titre valide trouvé
            console.log(`✅ [EXTRACTION] Titre extrait: ${title}`);
            break;
          }
        }
      }
      
      // Fallback: utiliser le domaine
      if (title === 'Document extrait' || title.length < 5) {
        try {
          const urlObj = new URL(url);
          title = `Page de ${urlObj.hostname}`;
          console.log(`📝 [EXTRACTION] Titre fallback: ${title}`);
        } catch (e) {
          title = 'Document extrait';
        }
      }
      
    } catch (titleError) {
      console.warn(`⚠️ [EXTRACTION] Erreur extraction titre:`, titleError);
    }
    
    // ✅ EXTRACTION ULTRA-ROBUSTE DU CONTENU
    let cleanContent = '';
    
    try {
      console.log(`🧹 [EXTRACTION] Nettoyage du contenu HTML...`);
      
      // Étape 1: Supprimer les balises indésirables et leurs contenus
      let processedHtml = html
        // Scripts et styles
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<noscript[^>]*>.*?<\/noscript>/gis, '')
        // Navigation et menus
        .replace(/<nav[^>]*>.*?<\/nav>/gis, '')
        .replace(/<header[^>]*>.*?<\/header>/gis, '')
        .replace(/<footer[^>]*>.*?<\/footer>/gis, '')
        .replace(/<aside[^>]*>.*?<\/aside>/gis, '')
        // Commentaires
        .replace(/<!--.*?-->/gis, '')
        // Balises meta et link
        .replace(/<meta[^>]*>/gi, '')
        .replace(/<link[^>]*>/gi, '')
        .replace(/<base[^>]*>/gi, '');
      
      // Étape 2: Préserver les sauts de ligne importants
      processedHtml = processedHtml
        .replace(/<br[^>]*>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n');
      
      // Étape 3: Supprimer toutes les balises HTML restantes
      cleanContent = processedHtml
        .replace(/<[^>]*>/g, ' ')
        // Nettoyer les entités HTML
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&[a-zA-Z0-9]+;/g, ' ')
        // Nettoyer les espaces multiples
        .replace(/\s+/g, ' ')
        // Nettoyer les sauts de ligne multiples
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
      
      console.log(`✂️ [EXTRACTION] Contenu nettoyé: ${cleanContent.length} caractères`);
      
    } catch (contentError) {
      console.error(`❌ [EXTRACTION] Erreur nettoyage contenu:`, contentError);
      // Fallback: contenu minimal
      cleanContent = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000);
    }
    
    // ✅ VALIDATION ET LIMITATION DE CONTENU
    if (!cleanContent || cleanContent.length < 50) {
      console.warn(`⚠️ [EXTRACTION] Contenu trop court ou vide pour ${url}`);
      cleanContent = `Contenu de la page: ${url}\n\nLe contenu de cette page n'a pas pu être extrait automatiquement, mais la page a été indexée et peut être consultée à l'adresse ci-dessus.`;
    }
    
    const maxContentLength = 15000; // 15K caractères max
    if (cleanContent.length > maxContentLength) {
      cleanContent = cleanContent.substring(0, maxContentLength) + '\n\n... [contenu tronqué pour respecter les limites]';
      console.log(`✂️ [EXTRACTION] Contenu tronqué à ${maxContentLength} caractères`);
    }
    
    const wordCount = cleanContent.split(/\s+/).filter(word => word.length > 0).length;
    const processingTime = Date.now() - startTime;
    
    const metadata: SafeMetadata = {
      extractedAt: new Date().toISOString(),
      sourceUrl: url,
      wordCount: wordCount,
      extractionMethod: 'html-parse-v2',
      contentLength: cleanContent.length,
      processingTimeMs: processingTime,
      httpStatus: response.status,
      contentType: contentType
    };
    
    console.log(`✅ [EXTRACTION] Terminé en ${processingTime}ms: ${wordCount} mots, ${cleanContent.length} caractères`);
    
    return { title, content: cleanContent, metadata };
    
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [EXTRACTION] Échec pour ${url} après ${processingTime}ms:`, error.message);
    
    // ✅ FALLBACK GRACIEUX AU LIEU DE THROW
    const fallbackContent = `Page web: ${url}

Cette page n'a pas pu être analysée automatiquement.
Raison: ${error.message}

Vous pouvez consulter cette page directement à l'adresse ci-dessus.`;

    const fallbackMetadata: SafeMetadata = {
      extractedAt: new Date().toISOString(),
      sourceUrl: url,
      wordCount: fallbackContent.split(' ').length,
      extractionMethod: 'fallback',
      contentLength: fallbackContent.length,
      processingTimeMs: processingTime,
      error: error.message,
      extractionFailed: true
    };

    console.log(`🔄 [EXTRACTION] Fallback appliqué pour ${url}`);
    
    return { 
      title: `Page de ${url}`, 
      content: fallbackContent, 
      metadata: fallbackMetadata 
    };
  }
}

// ✅ HELPER: Upload fichier vers Supabase Storage
async function uploadFileToSupabase(fileData: any, shopId: string): Promise<{ path: string; url: string }> {
  try {
    // ✅ GÉNÉRER UN NOM UNIQUE POUR LE FICHIER
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const fileExtension = path.extname(fileData.filename || 'file.txt');
    const fileName = `${shopId}_${timestamp}_${randomSuffix}${fileExtension}`;
    const filePath = `knowledge-base/${shopId}/${fileName}`;
    
    console.log('📤 Upload vers Supabase Storage:', filePath);
    
    // ✅ LIRE LE CONTENU DU FICHIER
    const fileBuffer = await fileData.toBuffer();
    
    // ✅ UPLOAD VERS SUPABASE STORAGE
    const { data, error } = await supabaseServiceClient.storage
      .from('chatseller-files')
      .upload(filePath, fileBuffer, {
        contentType: fileData.mimetype,
        cacheControl: '3600',
        upsert: false
      });
    
    if (error) {
      console.error('❌ Erreur upload Supabase:', error);
      throw new Error(`Erreur upload: ${error.message}`);
    }
    
    // ✅ OBTENIR L'URL PUBLIQUE
    const { data: { publicUrl } } = supabaseServiceClient.storage
      .from('chatseller-files')
      .getPublicUrl(filePath);
    
    console.log('✅ Fichier uploadé avec succès:', publicUrl);
    
    return {
      path: filePath,
      url: publicUrl
    };
    
  } catch (error: any) {
    console.error('❌ Erreur upload fichier:', error);
    throw new Error(`Erreur lors de l'upload: ${error.message}`);
  }
}

// ✅ HELPER: Extraire texte d'un fichier (VERSION SIMPLIFIÉE)
async function extractTextFromFile(fileData: any, mimeType: string): Promise<{ content: string; wordCount: number }> {
  try {
    console.log('📄 Extraction de texte du fichier:', fileData.filename, mimeType);
    
    let content = '';
    
    if (mimeType === 'text/plain' || mimeType === 'text/csv') {
      // ✅ FICHIERS TEXTE SIMPLES
      const buffer = await fileData.toBuffer();
      content = buffer.toString('utf-8');
      
    } else if (mimeType === 'application/pdf') {
      // ✅ PLACEHOLDER POUR PDF - En production, utiliser pdf-parse
      content = `[Fichier PDF : ${fileData.filename}]\n\nContenu du fichier PDF non analysé dans cette version de démonstration. Le fichier a été sauvegardé et sera traité ultérieurement.`;
      
    } else if (mimeType.includes('word') || mimeType.includes('document')) {
      // ✅ PLACEHOLDER POUR WORD - En production, utiliser mammoth
      content = `[Document Word : ${fileData.filename}]\n\nContenu du document Word non analysé dans cette version de démonstration. Le fichier a été sauvegardé et sera traité ultérieurement.`;
      
    } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      // ✅ PLACEHOLDER POUR EXCEL - En production, utiliser xlsx
      content = `[Fichier Excel : ${fileData.filename}]\n\nContenu du fichier Excel non analysé dans cette version de démonstration. Le fichier a été sauvegardé et sera traité ultérieurement.`;
      
    } else {
      content = `[Fichier : ${fileData.filename}]\n\nType de fichier non supporté pour l'extraction automatique. Le fichier a été sauvegardé.`;
    }
    
    // Limiter la taille du contenu
    const maxLength = 15000;
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '... [contenu tronqué]';
    }
    
    const wordCount = content.split(' ').filter(word => word.length > 0).length;
    
    console.log(`✅ Texte extrait: ${wordCount} mots, ${content.length} caractères`);
    
    return { content, wordCount };
    
  } catch (error: any) {
    console.error('❌ Erreur extraction texte:', error);
    // En cas d'erreur, retourner un contenu par défaut
    return {
      content: `[Fichier : ${fileData.filename || 'fichier'}]\n\nErreur lors de l'extraction du contenu. Le fichier a été sauvegardé mais son contenu n'a pas pu être analysé automatiquement.`,
      wordCount: 20
    };
  }
}

// ✅ HELPER: Créer métadonnées sécurisées
function createSafeMetadata(base: SafeMetadata = {}): Record<string, any> {
  return {
    ...base,
    createdAt: new Date().toISOString()
  };
}

// ✅ HELPER: Merger métadonnées existantes
function mergeSafeMetadata(existing: Record<string, any>, updates: SafeMetadata): Record<string, any> {
  const existingMeta = existing || {};
  return {
    ...existingMeta,
    ...updates,
    lastModified: new Date().toISOString()
  };
}

// ✅ HELPER: Découvrir toutes les pages d'un site web (VERSION AMÉLIORÉE)
async function discoverWebsitePages(baseUrl: string, maxPages: number = 50): Promise<string[]> {
  const startTime = Date.now();
  
  try {
    console.log(`🔍 [DÉCOUVERTE] Début pour: ${baseUrl} (max: ${maxPages})`);
    
    const discoveredUrls = new Set<string>();
    const domain = new URL(baseUrl).hostname;
    
    // ✅ ÉTAPE 1: Essayer de récupérer le sitemap.xml
    try {
      console.log(`🗺️ [DÉCOUVERTE] Recherche sitemap...`);
      const sitemapUrls = await extractSitemapUrls(baseUrl);
      sitemapUrls.forEach(url => discoveredUrls.add(url));
      console.log(`✅ [DÉCOUVERTE] Sitemap: ${sitemapUrls.length} URLs trouvées`);
    } catch (sitemapError) {
      console.log(`⚠️ [DÉCOUVERTE] Sitemap non disponible:`, sitemapError instanceof Error ? sitemapError.message : String(sitemapError));
    }
    
    // ✅ ÉTAPE 2: Si pas assez d'URLs ou pas de sitemap, crawler les liens
    if (discoveredUrls.size < 3) {
      try {
        console.log(`🕷️ [DÉCOUVERTE] Crawling des liens internes...`);
        const crawledUrls = await crawlInternalLinks(baseUrl, domain, maxPages);
        crawledUrls.forEach(url => discoveredUrls.add(url));
        console.log(`✅ [DÉCOUVERTE] Crawling: ${crawledUrls.length} URLs supplémentaires`);
      } catch (crawlError) {
        console.warn(`⚠️ [DÉCOUVERTE] Erreur crawling:`, crawlError instanceof Error ? crawlError.message : String(crawlError));
      }
    }
    
    // ✅ ÉTAPE 3: S'assurer que l'URL de base est incluse
    discoveredUrls.add(baseUrl);
    
    const finalUrls = Array.from(discoveredUrls).slice(0, maxPages);
    const processingTime = Date.now() - startTime;
    
    console.log(`🎯 [DÉCOUVERTE] Terminé en ${processingTime}ms: ${finalUrls.length} pages trouvées`);
    
    return finalUrls;
    
  } catch (error: any) {
    console.error(`❌ [DÉCOUVERTE] Erreur:`, error.message);
    // Fallback: retourner au moins l'URL de base
    console.log(`🔄 [DÉCOUVERTE] Fallback: URL de base uniquement`);
    return [baseUrl];
  }
}

// ✅ HELPER: Extraire les URLs depuis sitemap.xml (VERSION AMÉLIORÉE)
async function extractSitemapUrls(baseUrl: string): Promise<string[]> {
  try {
    const domain = new URL(baseUrl).origin;
    const sitemapUrls = [
      `${domain}/sitemap.xml`,
      `${domain}/sitemap_index.xml`,
      `${domain}/wp-sitemap.xml`,
      `${domain}/sitemap/sitemap.xml`
    ];
    
    for (const sitemapUrl of sitemapUrls) {
      try {
        console.log(`🔍 [SITEMAP] Tentative: ${sitemapUrl}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s pour sitemap
        
        const response = await fetch(sitemapUrl, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (compatible; ChatSeller-Bot/1.0)',
            'Accept': 'application/xml,text/xml,*/*'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          console.log(`⚠️ [SITEMAP] ${sitemapUrl}: HTTP ${response.status}`);
          continue;
        }
        
        const xmlContent = await response.text();
        const urls: string[] = [];
        
        // ✅ PARSER AMÉLIORÉ POUR SITEMAP XML
        const urlMatches = xmlContent.match(/<loc>(.*?)<\/loc>/g);
        if (urlMatches) {
          urlMatches.forEach(match => {
            const url = match.replace(/<\/?loc>/g, '').trim();
            if (url.startsWith('http') && !url.includes('.xml') && !url.includes('.pdf') && !url.includes('.jpg')) {
              urls.push(url);
            }
          });
        }
        
        if (urls.length > 0) {
          console.log(`✅ [SITEMAP] ${urls.length} URLs extraites de ${sitemapUrl}`);
          return urls.slice(0, 50); // Limite de sécurité
        }
        
      } catch (error: any) {
        console.log(`⚠️ [SITEMAP] Erreur ${sitemapUrl}: ${error.message}`);
        continue;
      }
    }
    
    throw new Error('Aucun sitemap accessible trouvé');
    
  } catch (error: any) {
    console.log(`⚠️ [SITEMAP] Échec total: ${error.message}`);
    throw error;
  }
}

// ✅ HELPER: Crawler les liens internes d'une page (VERSION AMÉLIORÉE)
async function crawlInternalLinks(startUrl: string, domain: string, maxPages: number = 20): Promise<string[]> {
  try {
    console.log(`🕷️ [CRAWL] Début: ${startUrl} (max: ${maxPages})`);
    
    const visitedUrls = new Set<string>();
    const discoveredUrls = new Set<string>();
    const toVisit = [startUrl];
    let errorCount = 0;
    const maxErrors = 3;
    
    while (toVisit.length > 0 && discoveredUrls.size < maxPages && errorCount < maxErrors) {
      const currentUrl = toVisit.shift();
      if (!currentUrl || visitedUrls.has(currentUrl)) continue;
      
      visitedUrls.add(currentUrl);
      
      try {
        console.log(`🔍 [CRAWL] Analyse: ${currentUrl}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s par page
        
        const response = await fetch(currentUrl, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (compatible; ChatSeller-Bot/1.0)',
            'Accept': 'text/html,application/xhtml+xml'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
          console.log(`⚠️ [CRAWL] Ignoré: ${currentUrl} (${response.status})`);
          continue;
        }
        
        const html = await response.text();
        discoveredUrls.add(currentUrl);
        
        // ✅ EXTRAIRE LES LIENS INTERNES AVEC REGEX AMÉLIORÉ
        const linkMatches = html.match(/href=["']([^"']+)["']/gi);
        if (linkMatches && discoveredUrls.size < maxPages) {
          let newLinksFound = 0;
          
          linkMatches.forEach(match => {
            try {
              const href = match.match(/href=["']([^"']+)["']/i)?.[1];
              if (!href) return;
              
              let fullUrl = '';
              if (href.startsWith('http')) {
                fullUrl = href;
              } else if (href.startsWith('/')) {
                fullUrl = `https://${domain}${href}`;
              } else if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
                fullUrl = new URL(href, currentUrl).toString();
              }
              
              // ✅ VÉRIFIER QUE C'EST UN LIEN INTERNE VALIDE
              if (fullUrl && 
                  fullUrl.includes(domain) && 
                  !visitedUrls.has(fullUrl) && 
                  !discoveredUrls.has(fullUrl) &&
                  discoveredUrls.size + newLinksFound < maxPages) {
                
                // Éviter les fichiers et URLs spéciales
                if (!/\.(pdf|jpg|jpeg|png|gif|css|js|ico|xml|json|zip|mp4|mp3)(\?|$)/i.test(fullUrl)) {
                  toVisit.push(fullUrl);
                  newLinksFound++;
                }
              }
            } catch (urlError) {
              // Ignorer les URLs malformées
            }
          });
          
          console.log(`📎 [CRAWL] ${newLinksFound} nouveaux liens trouvés sur ${currentUrl}`);
        }
        
        errorCount = 0; // Reset compteur d'erreurs
        
      } catch (fetchError: any) {
        errorCount++;
        console.log(`❌ [CRAWL] Erreur ${currentUrl}: ${fetchError.message}`);
        if (errorCount >= maxErrors) {
          console.log(`⚠️ [CRAWL] Trop d'erreurs, arrêt du crawling`);
          break;
        }
        continue;
      }
      
      // ✅ PAUSE POUR ÉVITER LA SURCHARGE
      if (toVisit.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    
    const finalUrls = Array.from(discoveredUrls);
    console.log(`✅ [CRAWL] Terminé: ${finalUrls.length} pages découvertes`);
    return finalUrls;
    
  } catch (error: any) {
    console.error(`❌ [CRAWL] Erreur globale:`, error.message);
    return [];
  }
}

// ✅ HELPER: Traiter plusieurs pages d'un site web (VERSION ULTRA-ROBUSTE)
async function processMultipleWebsitePages(
  urls: string[], 
  baseTitle: string, 
  tags: string[] = [], 
  shopId: string
): Promise<KnowledgeBaseDocument[]> {
  const startTime = Date.now();
  
  try {
    console.log(`📄 [TRAITEMENT] Début pour ${urls.length} pages`);
    
    const processedDocuments: KnowledgeBaseDocument[] = [];
    const errors: Array<{ url: string; error: string }> = [];
    let successCount = 0;
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      try {
        console.log(`📄 [TRAITEMENT] [${i + 1}/${urls.length}] ${url}`);
        
        // ✅ EXTRAIRE LE CONTENU DE LA PAGE AVEC FALLBACK INTÉGRÉ
        const { title, content, metadata } = await extractContentFromUrl(url);
        
        // ✅ GÉNÉRER UN TITRE UNIQUE POUR CHAQUE PAGE
        let pageTitle = baseTitle;
        if (urls.length > 1) {
          if (title && title !== 'Document extrait' && !title.includes('Page de')) {
            pageTitle = `${baseTitle} - ${title}`;
          } else {
            pageTitle = `${baseTitle} - Page ${i + 1}`;
          }
        }
        
        // Limiter la longueur du titre
        if (pageTitle.length > 255) {
          pageTitle = pageTitle.substring(0, 252) + '...';
        }
        
        console.log(`💾 [TRAITEMENT] Sauvegarde: ${pageTitle}`);
        
        // ✅ CRÉER LE DOCUMENT EN BASE AVEC GESTION D'ERREUR ROBUSTE
        const { data: newDocument, error } = await supabaseServiceClient
          .from('knowledge_base')
          .insert({
            shop_id: shopId,
            title: pageTitle,
            content: content,
            content_type: 'website',
            source_file: null,
            source_url: url,
            tags: [...tags, 'website', 'indexation-auto'],
            is_active: true,
            metadata: createSafeMetadata({
              ...metadata,
              sourceUrl: url,
              pageIndex: i + 1,
              totalPages: urls.length,
              processedAt: new Date().toISOString(),
              batchId: `batch_${Date.now()}`
            })
          })
          .select()
          .single();
        
        if (error) {
          console.error(`❌ [TRAITEMENT] Erreur DB pour ${url}:`, error.message);
          errors.push({ url, error: `Erreur base de données: ${error.message}` });
        } else if (newDocument) {
          processedDocuments.push({
            id: newDocument.id,
            title: newDocument.title,
            content: newDocument.content,
            contentType: newDocument.content_type as any,
            sourceFile: newDocument.source_file,
            sourceUrl: newDocument.source_url,
            tags: newDocument.tags,
            isActive: newDocument.is_active,
            shopId: newDocument.shop_id,
            linkedAgents: [],
            createdAt: newDocument.created_at,
            updatedAt: newDocument.updated_at,
            metadata: newDocument.metadata
          });
          
          successCount++;
          console.log(`✅ [TRAITEMENT] Document créé: ${newDocument.id}`);
        }
        
        // ✅ PAUSE ENTRE LES PAGES POUR ÉVITER LA SURCHARGE
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        
      } catch (pageError: any) {
        console.error(`❌ [TRAITEMENT] Erreur page ${url}:`, pageError.message);
        errors.push({ url, error: pageError.message });
      }
    }
    
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ [TRAITEMENT] Terminé en ${processingTime}ms: ${successCount}/${urls.length} succès, ${errors.length} erreurs`);
    
    if (errors.length > 0 && errors.length < 5) {
      console.warn(`⚠️ [TRAITEMENT] Erreurs détaillées:`, errors);
    }
    
    // ✅ RETOURNER LES DOCUMENTS CRÉÉS MÊME S'IL Y A EU QUELQUES ERREURS
    return processedDocuments;
    
  } catch (error: any) {
    console.error(`❌ [TRAITEMENT] Erreur globale:`, error.message);
    throw new Error(`Erreur lors du traitement des pages: ${error.message}`);
  }
}

export default async function knowledgeBaseRoutes(fastify: FastifyInstance) {
  
  // ✅ ENREGISTRER LE PLUGIN @FASTIFY/MULTIPART V6
  await fastify.register(require('@fastify/multipart'), {
    attachFieldsToBody: true,
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB max
      files: 1 // 1 fichier à la fois
    }
  });
  
  // ✅ ROUTE : LISTE DES DOCUMENTS AVEC RESTRICTIONS PLAN (SUPABASE CORRIGÉ)
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🔍 Récupération des documents de base de connaissances');
      
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      const { data: documents, error } = await supabaseServiceClient
        .from('knowledge_base')
        .select('*')
        .eq('shop_id', shop.id)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Erreur récupération documents:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération des documents'
        });
      }

      const planLimits = await checkPlanLimits(shop.id, shop.subscription_plan);

      const formattedDocuments = (documents || []).map((doc: any) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        contentType: doc.content_type,
        sourceFile: doc.source_file,
        sourceUrl: doc.source_url,
        tags: Array.isArray(doc.tags) ? doc.tags : [],
        isActive: doc.is_active,
        metadata: doc.metadata || {},
        linkedAgents: [],
        createdAt: doc.created_at,
        updatedAt: doc.updated_at
      }));

      return {
        success: true,
        data: formattedDocuments,
        meta: {
          total: documents?.length || 0,
          activeCount: documents?.filter(doc => doc.is_active).length || 0,
          plan: {
            name: shop.subscription_plan,
            limits: {
              documents: planLimits.limit,
              fileSize: PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS]?.fileSize || PLAN_LIMITS.free.fileSize
            },
            usage: {
              documents: planLimits.currentCount,
              canAddMore: planLimits.canAdd
            }
          }
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get knowledge base error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({ 
        success: false,
        error: 'Erreur lors de la récupération des documents',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ NOUVELLE ROUTE : UPLOAD DE FICHIER (SUPABASE CORRIGÉ)
  fastify.post('/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('📤 Upload de fichier KB');
      
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ VÉRIFIER LES LIMITES DU PLAN
      const planLimits = await checkPlanLimits(shop.id, shop.subscription_plan);
      if (!planLimits.canAdd) {
        return reply.status(403).send({
          success: false,
          error: planLimits.reason,
          requiresUpgrade: true,
          planLimits: {
            current: planLimits.currentCount,
            max: planLimits.limit
          }
        });
      }

      // ✅ RÉCUPÉRER LE FICHIER UPLOADÉ
      const data = await (request as any).file();
      
      if (!data) {
        return reply.status(400).send({
          success: false,
          error: 'Aucun fichier fourni'
        });
      }

      // ✅ VÉRIFIER LE TYPE DE FICHIER
      if (!ALLOWED_MIME_TYPES[data.mimetype as keyof typeof ALLOWED_MIME_TYPES]) {
        return reply.status(400).send({
          success: false,
          error: 'Type de fichier non autorisé',
          allowedTypes: Object.keys(ALLOWED_MIME_TYPES)
        });
      }

      // ✅ LIRE LE CONTENU DU FICHIER EN BUFFER
      const fileBuffer = await data.toBuffer();
      const fileSize = fileBuffer.length;

      // ✅ VÉRIFIER LA TAILLE DU FICHIER
      const planConfig = PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;
      
      if (fileSize > planConfig.fileSize) {
        return reply.status(400).send({
          success: false,
          error: `Fichier trop volumineux. Taille max pour votre plan: ${Math.round(planConfig.fileSize / 1024 / 1024)}MB`
        });
      }

      // ✅ UPLOAD VERS SUPABASE STORAGE
      const { path: storagePath, url: storageUrl } = await uploadFileToSupabase(data, shop.id);

      // ✅ EXTRAIRE LE CONTENU DU FICHIER
      const { content, wordCount } = await extractTextFromFile(data, data.mimetype);

      // ✅ CRÉER LE DOCUMENT EN BASE AVEC SUPABASE CORRIGÉ
      const metadata = createSafeMetadata({
        originalFileName: data.filename,
        fileSize: fileSize,
        mimeType: data.mimetype,
        wordCount: wordCount,
        storagePath: storagePath,
        storageUrl: storageUrl,
        processedAt: new Date().toISOString()
      });

      const { data: newDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .insert({
          shop_id: shop.id,
          title: data.filename || 'Fichier uploadé',
          content: content,
          content_type: 'file',
          source_file: data.filename,
          source_url: storageUrl,
          tags: ['fichier', 'upload'],
          is_active: true,
          metadata: metadata
        })
        .select()
        .single();

      if (error) {
        console.error('Erreur création document:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création du document'
        });
      }

      fastify.log.info(`✅ Fichier KB uploadé avec succès: ${newDocument.id}`);

      return {
        success: true,
        data: {
          id: newDocument.id,
          title: newDocument.title,
          content: newDocument.content,
          contentType: newDocument.content_type,
          sourceFile: newDocument.source_file,
          sourceUrl: newDocument.source_url,
          tags: newDocument.tags,
          isActive: newDocument.is_active,
          metadata: newDocument.metadata,
          linkedAgents: [],
          createdAt: newDocument.created_at,
          updatedAt: newDocument.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Upload file error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'upload du fichier',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ NOUVELLE ROUTE : TRAITEMENT D'UN SITE WEB (VERSION ULTRA-ROBUSTE)
  fastify.post('/website', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = `req_${Date.now()}`;
    
    try {
      fastify.log.info(`🌐 [${requestId}] DÉBUT traitement complet site web`);
      
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);
      const body = websiteProcessSchema.parse(request.body);

      fastify.log.info(`🔐 [${requestId}] Auth OK - Shop: ${shop.id}, Plan: ${shop.subscription_plan}`);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ VÉRIFIER LES LIMITES DU PLAN AVANT DÉCOUVERTE
      const planLimits = await checkPlanLimits(shop.id, shop.subscription_plan);
      if (!planLimits.canAdd) {
        return reply.status(403).send({
          success: false,
          error: planLimits.reason,
          requiresUpgrade: true
        });
      }

      fastify.log.info(`📊 [${requestId}] Plan vérifié - ${planLimits.currentCount}/${planLimits.limit} documents`);

      // ✅ ÉTAPE 1: DÉCOUVRIR TOUTES LES PAGES DU SITE
      const maxPagesPerPlan = {
        free: 5,
        starter: 10, 
        pro: 25,
        enterprise: 50
      };
      
      const maxPages = Math.min(
        maxPagesPerPlan[shop.subscription_plan as keyof typeof maxPagesPerPlan] || 5,
        planLimits.limit === -1 ? 50 : Math.max(1, planLimits.limit - planLimits.currentCount)
      );
      
      fastify.log.info(`🔍 [${requestId}] Découverte max ${maxPages} pages pour ${body.url}`);
      
      const discoveredUrls = await discoverWebsitePages(body.url, maxPages);
      
      if (discoveredUrls.length === 0) {
        fastify.log.warn(`❌ [${requestId}] Aucune page trouvée`);
        return reply.status(400).send({
          success: false,
          error: 'Aucune page accessible trouvée sur ce site web. Vérifiez que l\'URL est correcte et accessible.'
        });
      }

      fastify.log.info(`✅ [${requestId}] ${discoveredUrls.length} page(s) découverte(s)`);

      // ✅ ÉTAPE 2: VÉRIFIER QUE NOUS AVONS ASSEZ D'ESPACE
      const availableSlots = planLimits.limit === -1 ? discoveredUrls.length : (planLimits.limit - planLimits.currentCount);
      
      if (availableSlots < discoveredUrls.length) {
        return reply.status(403).send({
          success: false,
          error: `Pas assez d'espace dans votre plan. ${discoveredUrls.length} pages découvertes mais seulement ${availableSlots} emplacement(s) disponible(s). Passez au plan supérieur ou supprimez quelques documents existants.`,
          requiresUpgrade: true,
          meta: {
            discoveredPages: discoveredUrls.length,
            availableSlots: availableSlots,
            planLimit: planLimits.limit
          }
        });
      }

      // ✅ ÉTAPE 3: TRAITER TOUTES LES PAGES DÉCOUVERTES
      const baseTitle = body.title || `Site ${new URL(body.url).hostname}`;
      const websiteTags = body.tags.length > 0 ? body.tags : ['website', 'indexation-complete'];
      
      fastify.log.info(`🏗️ [${requestId}] Traitement ${discoveredUrls.length} pages...`);
      
      const processedDocuments = await processMultipleWebsitePages(
        discoveredUrls,
        baseTitle,
        websiteTags,
        shop.id
      );

      if (processedDocuments.length === 0) {
        fastify.log.error(`❌ [${requestId}] Aucune page traitée avec succès`);
        return reply.status(500).send({
          success: false,
          error: 'Aucune page n\'a pu être traitée avec succès. Le site web pourrait être inaccessible ou protégé contre l\'indexation automatique.'
        });
      }

      fastify.log.info(`✅ [${requestId}] SUCCÈS: ${processedDocuments.length}/${discoveredUrls.length} documents créés`);

      // ✅ RETOURNER LA LISTE DES DOCUMENTS CRÉÉS AVEC MÉTADONNÉES DÉTAILLÉES
      return {
        success: true,
        data: processedDocuments,
        meta: {
          totalPagesDiscovered: discoveredUrls.length,
          totalDocumentsCreated: processedDocuments.length,
          successRate: Math.round((processedDocuments.length / discoveredUrls.length) * 100),
          baseUrl: body.url,
          indexationType: 'complete-website',
          processedAt: new Date().toISOString(),
          requestId: requestId
        }
      };

    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] Erreur globale:`, error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'URL invalide ou données manquantes',
          details: error.errors
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      // ✅ GESTION D'ERREUR DÉTAILLÉE
      let errorMessage = 'Erreur lors du traitement du site web';
      
      if (error.message.includes('fetch')) {
        errorMessage += ': Impossible de récupérer le contenu du site. Vérifiez que l\'URL est accessible.';
      } else if (error.message.includes('timeout')) {
        errorMessage += ': Le site web met trop de temps à répondre.';
      } else if (error.message.includes('DNS')) {
        errorMessage += ': Nom de domaine invalide ou inaccessible.';
      } else if (error.message) {
        errorMessage += `: ${error.message}`;
      }
      
      return reply.status(500).send({
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? {
          stack: error.stack,
          requestId: requestId
        } : undefined
      });
    }
  });

  // ✅ ROUTE : CRÉER UN DOCUMENT MANUEL (SUPABASE CORRIGÉ)
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🏗️ Création d\'un nouveau document KB');
      
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);
      const body = createKnowledgeBaseSchema.parse(request.body);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ VÉRIFIER LES LIMITES DU PLAN
      const planLimits = await checkPlanLimits(shop.id, shop.subscription_plan);
      if (!planLimits.canAdd) {
        return reply.status(403).send({
          success: false,
          error: planLimits.reason,
          requiresUpgrade: true,
          planLimits: {
            current: planLimits.currentCount,
            max: planLimits.limit
          }
        });
      }

      const metadata = createSafeMetadata({
        wordCount: body.content.split(' ').length,
        createdManually: true,
        contentType: body.contentType
      });

      const { data: newDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .insert({
          shop_id: shop.id,
          title: body.title,
          content: body.content,
          content_type: body.contentType,
          source_file: body.sourceFile || null,
          source_url: body.sourceUrl || null,
          tags: body.tags,
          is_active: body.isActive,
          metadata: metadata
        })
        .select()
        .single();

      if (error) {
        console.error('Erreur création document manuel:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création du document'
        });
      }

      fastify.log.info(`✅ Document KB créé avec succès: ${newDocument.id}`);

      return {
        success: true,
        data: {
          id: newDocument.id,
          title: newDocument.title,
          content: newDocument.content,
          contentType: newDocument.content_type,
          sourceFile: newDocument.source_file,
          sourceUrl: newDocument.source_url,
          tags: newDocument.tags,
          isActive: newDocument.is_active,
          metadata: newDocument.metadata,
          linkedAgents: [],
          createdAt: newDocument.created_at,
          updatedAt: newDocument.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Create knowledge base error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la création du document',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : EXTRAIRE CONTENU D'UNE URL (SUPABASE CORRIGÉ)
  fastify.post('/extract-url', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);
      const body = extractUrlSchema.parse(request.body);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ VÉRIFIER LES LIMITES DU PLAN
      const planLimits = await checkPlanLimits(shop.id, shop.subscription_plan);
      if (!planLimits.canAdd) {
        return reply.status(403).send({
          success: false,
          error: planLimits.reason,
          requiresUpgrade: true
        });
      }

      // ✅ EXTRAIRE LE CONTENU DE L'URL
      const { title, content, metadata } = await extractContentFromUrl(body.url);

      const { data: newDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .insert({
          shop_id: shop.id,
          title: body.title || title,
          content: content,
          content_type: 'url',
          source_file: null,
          source_url: body.url,
          tags: [],
          is_active: true,
          metadata: createSafeMetadata(metadata)
        })
        .select()
        .single();

      if (error) {
        console.error('Erreur création document URL:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création du document'
        });
      }

      fastify.log.info(`✅ Contenu extrait de l'URL et document créé: ${newDocument.id}`);

      return {
        success: true,
        data: {
          id: newDocument.id,
          title: newDocument.title,
          content: newDocument.content,
          contentType: newDocument.content_type,
          sourceFile: newDocument.source_file,
          sourceUrl: newDocument.source_url,
          tags: newDocument.tags,
          isActive: newDocument.is_active,
          metadata: newDocument.metadata,
          createdAt: newDocument.created_at,
          updatedAt: newDocument.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Extract URL error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'URL invalide',
          details: error.errors
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'extraction du contenu',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : OBTENIR UN DOCUMENT (SUPABASE CORRIGÉ)
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      const { data: document, error } = await supabaseServiceClient
        .from('knowledge_base')
        .select('*')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (error || !document) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document non trouvé' 
        });
      }

      return {
        success: true,
        data: {
          id: document.id,
          title: document.title,
          content: document.content,
          contentType: document.content_type,
          sourceFile: document.source_file,
          sourceUrl: document.source_url,
          tags: document.tags,
          isActive: document.is_active,
          metadata: document.metadata,
          linkedAgents: [],
          createdAt: document.created_at,
          updatedAt: document.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get knowledge base document error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération du document',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : METTRE À JOUR UN DOCUMENT (SUPABASE CORRIGÉ)
  fastify.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);
      const body = updateKnowledgeBaseSchema.parse(request.body);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ VÉRIFIER SI LE DOCUMENT EXISTE
      const { data: existingDocument, error: fetchError } = await supabaseServiceClient
        .from('knowledge_base')
        .select('*')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (fetchError || !existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document non trouvé' 
        });
      }

      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (body.title) updateData.title = body.title;
      if (body.content) {
        updateData.content = body.content;
        updateData.metadata = mergeSafeMetadata(existingDocument.metadata, {
          wordCount: body.content.split(' ').length
        });
      }
      if (body.tags) updateData.tags = body.tags;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const { data: updatedDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Erreur mise à jour document:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la mise à jour'
        });
      }

      return {
        success: true,
        data: {
          id: updatedDocument.id,
          title: updatedDocument.title,
          content: updatedDocument.content,
          contentType: updatedDocument.content_type,
          sourceFile: updatedDocument.source_file,
          sourceUrl: updatedDocument.source_url,
          tags: updatedDocument.tags,
          isActive: updatedDocument.is_active,
          metadata: updatedDocument.metadata,
          createdAt: updatedDocument.created_at,
          updatedAt: updatedDocument.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Update knowledge base error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la modification du document'
      });
    }
  });

  // ✅ ROUTE : SUPPRIMER UN DOCUMENT (SUPABASE CORRIGÉ)
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ RÉCUPÉRER LE DOCUMENT POUR VÉRIFICATION ET NETTOYAGE
      const { data: existingDocument, error: fetchError } = await supabaseServiceClient
        .from('knowledge_base')
        .select('*')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (fetchError || !existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document non trouvé' 
        });
      }

      // ✅ SUPPRIMER LE FICHIER DE SUPABASE STORAGE SI C'EST UN FICHIER
      if (existingDocument.content_type === 'file' && existingDocument.metadata) {
        try {
          const metadata = existingDocument.metadata as SafeMetadata;
          if (metadata.storagePath) {
            const { error: deleteError } = await supabaseServiceClient.storage
              .from('chatseller-files')
              .remove([metadata.storagePath]);
              
            if (deleteError) {
              fastify.log.warn('⚠️ Erreur suppression fichier storage: %s', deleteError.message);
            } else {
              fastify.log.info('✅ Fichier supprimé du storage: %s', metadata.storagePath);
            }
          }
        } catch (storageError: any) {
          fastify.log.warn('⚠️ Erreur lors de la suppression du fichier storage:', storageError.message);
        }
      }

      // ✅ SUPPRIMER LE DOCUMENT
      const { error } = await supabaseServiceClient
        .from('knowledge_base')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Erreur suppression document:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la suppression'
        });
      }

      return { 
        success: true, 
        message: 'Document supprimé avec succès' 
      };

    } catch (error: any) {
      fastify.log.error('❌ Delete knowledge base error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la suppression du document'
      });
    }
  });

  // ✅ ROUTE : TOGGLE STATUT (SUPABASE CORRIGÉ)
  fastify.patch<{ Params: { id: string } }>('/:id/toggle', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);
      const body = toggleKnowledgeBaseSchema.parse(request.body);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ VÉRIFIER SI LE DOCUMENT EXISTE
      const { data: existingDocument, error: fetchError } = await supabaseServiceClient
        .from('knowledge_base')
        .select('id')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (fetchError || !existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document non trouvé' 
        });
      }

      const { data: updatedDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .update({ 
          is_active: body.isActive,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select('id, is_active, updated_at')
        .single();

      if (error) {
        console.error('Erreur toggle document:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la modification du statut'
        });
      }

      fastify.log.info(`✅ Statut document KB modifié: ${id} -> ${body.isActive ? 'actif' : 'inactif'}`);

      return {
        success: true,
        data: {
          id: updatedDocument.id,
          isActive: updatedDocument.is_active,
          updatedAt: updatedDocument.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Toggle knowledge base error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la modification du statut',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
}