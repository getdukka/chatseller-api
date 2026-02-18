// src/routes/knowledge-base.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient } from '../lib/supabase';
import * as path from 'path';
import * as crypto from 'crypto';

// ✅ CONFIGURATION DES LIMITES PAR PLAN - NOUVEAUX PLANS BEAUTÉ
const BEAUTY_PLAN_LIMITS = {
  starter: { 
    documents: 50, 
    fileSize: 10 * 1024 * 1024, // 10MB
    indexablePages: 500,
    trialDays: 14
  },
  growth: { 
    documents: 200, 
    fileSize: 25 * 1024 * 1024, // 25MB
    indexablePages: 2000,
    trialDays: 14
  },
  performance: { 
    documents: -1, // Illimité
    fileSize: 100 * 1024 * 1024, // 100MB
    indexablePages: -1, // Illimité
    trialDays: 14
  },
  // ✅ Fallbacks pour compatibilité
  free: { 
    documents: 10, 
    fileSize: 5 * 1024 * 1024, // 5MB
    indexablePages: 50,
    trialDays: 7
  },
  pro: { 
    documents: 200, 
    fileSize: 25 * 1024 * 1024, // 25MB
    indexablePages: 2000,
    trialDays: 14
  },
  enterprise: { 
    documents: -1, 
    fileSize: 100 * 1024 * 1024, // 100MB
    indexablePages: -1,
    trialDays: 14
  }
};

// ✅ TYPES DE FICHIERS AUTORISÉS POUR BEAUTÉ
const ALLOWED_MIME_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'image/jpeg': '.jpg', // ✅ AJOUT: Catalogues beauté en image
  'image/png': '.png'   // ✅ AJOUT: Catalogues beauté en image
};

// ✅ INTERFACES ADAPTÉES BEAUTÉ
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

interface BeautyShop {
  id: string;
  name: string;
  email: string;
  subscription_plan: string;
  beauty_category?: string;
  is_active: boolean;
  created_at: string;
  trial_ends_at?: string | null;
  quotas_usage?: {
    aiResponses?: number;
    knowledgeDocuments?: number;
    indexablePages?: number;
    agents?: number;
  };
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
  beautyCategory?: string; // ✅ AJOUT: Catégorie beauté
  productType?: string;    // ✅ AJOUT: Type de produit beauté
  [key: string]: any;
}

// ✅ SCHÉMAS DE VALIDATION BEAUTÉ
const createKnowledgeBaseSchema = z.object({
  title: z.string().min(1, 'Le titre est requis').max(255, 'Titre trop long'),
  content: z.string().min(1, 'Le contenu est requis'),
  contentType: z.enum(['manual', 'file', 'url', 'website']),
  sourceFile: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  metadata: z.record(z.any()).optional(),
  beautyCategory: z.string().optional(), // ✅ AJOUT: Catégorie beauté
  productType: z.string().optional()     // ✅ AJOUT: Type de produit
});

const extractUrlSchema = z.object({
  url: z.string().url('URL invalide'),
  title: z.string().optional(),
  beautyCategory: z.string().optional()
});

const websiteProcessSchema = z.object({
  url: z.string().url('URL invalide'),
  title: z.string().optional(),
  tags: z.array(z.string()).default([]),
  beautyCategory: z.string().optional()
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

// ✅ HELPER: Récupérer shop beauté avec vérification plan et essai
async function getBeautyShopWithPlanCheck(user: any): Promise<{ shop: BeautyShop; canAccess: boolean; reason?: string }> {
  try {
    const { data: shop, error } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error || !shop) {
      return { shop: null as any, canAccess: false, reason: 'Marque beauté non trouvée' };
    }

    // ✅ VÉRIFIER SI L'ESSAI GRATUIT EST EXPIRÉ
    const now = new Date();
    const isTrialExpired = shop.trial_ends_at && now > new Date(shop.trial_ends_at);
    const isPaidPlan = ['starter', 'growth', 'performance'].includes(shop.subscription_plan);

    if (isTrialExpired && !isPaidPlan) {
      return { 
        shop, 
        canAccess: false, 
        reason: 'Essai gratuit beauté expiré. Passez à un plan payant pour accéder à la base de connaissances beauté.' 
      };
    }

    if (!shop.is_active) {
      return { 
        shop, 
        canAccess: false, 
        reason: 'Compte marque beauté désactivé' 
      };
    }

    return { shop, canAccess: true };

  } catch (error) {
    throw error;
  }
}

// ✅ HELPER: Vérifier les limites du plan beauté
async function checkBeautyPlanLimits(shopId: string, plan: string): Promise<{ 
  canAdd: boolean; 
  currentCount: number; 
  limit: number; 
  reason?: string 
}> {
  // ✅ Normaliser le nom du plan et utiliser les nouvelles limites
  const normalizedPlan = plan.toLowerCase();
  const planConfig = BEAUTY_PLAN_LIMITS[normalizedPlan as keyof typeof BEAUTY_PLAN_LIMITS] || BEAUTY_PLAN_LIMITS.starter;
  
  const { count, error } = await supabaseServiceClient
    .from('knowledge_base')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', shopId);

  if (error) {
    console.error('Erreur comptage documents beauté:', error);
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
    reason: canAdd ? undefined : `Limite du plan beauté ${plan} atteinte (${planConfig.documents} documents max)`
  };
}

// ✅ SÉCURITÉ: Bloquer les URLs qui pointent vers des ressources internes (SSRF protection)
function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Bloquer les protocoles non-HTTP
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

    // Bloquer les noms d'hôtes internes/réservés
    const blockedHostnames = [
      'localhost', '0.0.0.0', 'metadata', 'metadata.google.internal'
    ];
    if (blockedHostnames.includes(hostname)) return true;

    // Bloquer les adresses IP privées et spéciales
    const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Pattern);
    if (match) {
      const [, a, b, c, d] = match.map(Number);
      // 127.x.x.x (loopback)
      if (a === 127) return true;
      // 10.x.x.x (private)
      if (a === 10) return true;
      // 172.16.x.x – 172.31.x.x (private)
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.168.x.x (private)
      if (a === 192 && b === 168) return true;
      // 169.254.x.x (link-local / AWS metadata)
      if (a === 169 && b === 254) return true;
      // 0.x.x.x
      if (a === 0) return true;
    }

    // Bloquer les domaines .local et .internal
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;

    return false;
  } catch {
    return true; // URL malformée → bloquer par défaut
  }
}

// ✅ HELPER: Extraire contenu d'une URL beauté (VERSION ULTRA-ROBUSTE)
async function extractBeautyContentFromUrl(url: string): Promise<{ title: string; content: string; metadata: SafeMetadata }> {
  const startTime = Date.now();

  try {
    console.log(`🌐 [EXTRACTION BEAUTÉ] Début: ${url}`);

    if (!url || !url.startsWith('http')) {
      throw new Error(`URL invalide: ${url}`);
    }

    // ✅ SÉCURITÉ: Bloquer les URLs internes (SSRF)
    if (isBlockedUrl(url)) {
      throw new Error(`URL bloquée pour des raisons de sécurité: ${url}`);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`⏰ [EXTRACTION BEAUTÉ] Timeout pour ${url} après 45s`);
      controller.abort();
    }, 45000);
    
    let response: Response;
    
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ChatSeller-BeautyBot/1.0; +https://chatseller.app)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.8,en-US;q=0.5,en;q=0.3',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        signal: controller.signal,
        redirect: 'follow',
        referrerPolicy: 'no-referrer'
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        throw new Error(`Timeout lors de la récupération de ${url}`);
      }
      
      console.error(`❌ [EXTRACTION BEAUTÉ] Erreur fetch ${url}:`, fetchError.message);
      throw new Error(`Erreur réseau pour ${url}: ${fetchError.message}`);
    }
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`❌ [EXTRACTION BEAUTÉ] HTTP ${response.status} pour ${url}`);
      throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      console.warn(`⚠️ [EXTRACTION BEAUTÉ] Content-type inattendu: ${contentType}`);
    }
    
    const html = await response.text();
    console.log(`📥 [EXTRACTION BEAUTÉ] HTML récupéré: ${html.length} caractères`);
    
    // ✅ EXTRACTION TITRE AVEC FOCUS BEAUTÉ
    let title = 'Document beauté extrait';
    
    try {
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
          
          if (title.length > 10) {
            console.log(`✅ [EXTRACTION BEAUTÉ] Titre extrait: ${title}`);
            break;
          }
        }
      }
      
      if (title === 'Document beauté extrait' || title.length < 5) {
        try {
          const urlObj = new URL(url);
          title = `Page beauté de ${urlObj.hostname}`;
          console.log(`📝 [EXTRACTION BEAUTÉ] Titre fallback: ${title}`);
        } catch (e) {
          title = 'Document beauté extrait';
        }
      }
      
    } catch (titleError) {
      console.warn(`⚠️ [EXTRACTION BEAUTÉ] Erreur extraction titre:`, titleError);
    }
    
    // ✅ EXTRACTION CONTENU AVEC FOCUS BEAUTÉ
    let cleanContent = '';

    try {
      console.log(`🧹 [EXTRACTION BEAUTÉ] Nettoyage du contenu...`);

      // ✅ ÉTAPE 1: Essayer d'extraire uniquement le contenu <main> (évite nav/sidebar)
      let sourceHtml = html;
      const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
        || html.match(/<div[^>]*(?:role=["']main["']|id=["'](?:main|content|main-content)["']|class=["'][^"']*(?:main-content|page-content|site-content)[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i);
      if (mainMatch) {
        sourceHtml = mainMatch[1] || mainMatch[0];
        console.log(`🎯 [EXTRACTION BEAUTÉ] Contenu <main> isolé (${sourceHtml.length} chars)`);
      }

      let processedHtml = sourceHtml
        // Supprimer scripts et styles
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<noscript[^>]*>.*?<\/noscript>/gis, '')
        // Supprimer SVG (icônes) - beaucoup de bruit
        .replace(/<svg[^>]*>.*?<\/svg>/gis, '')
        // Supprimer nav/header/footer/aside (en cas de fallback sans <main>)
        .replace(/<nav[^>]*>.*?<\/nav>/gis, '')
        .replace(/<header[^>]*>.*?<\/header>/gis, '')
        .replace(/<footer[^>]*>.*?<\/footer>/gis, '')
        .replace(/<aside[^>]*>.*?<\/aside>/gis, '')
        // Supprimer banners cookies, modals, overlays, popups
        .replace(/<div[^>]*class=["'][^"']*(?:cookie|consent|gdpr|banner|modal|overlay|popup|notification|alert)[^"']*["'][^>]*>.*?<\/div>/gis, '')
        // Supprimer breadcrumbs et pagination
        .replace(/<[^>]*(?:breadcrumb|pagination)[^>]*>.*?<\/(?:nav|div|ol|ul)>/gis, '')
        .replace(/<!--.*?-->/gis, '')
        .replace(/<meta[^>]*>/gi, '')
        .replace(/<link[^>]*>/gi, '')
        .replace(/<base[^>]*>/gi, '');

      processedHtml = processedHtml
        .replace(/<br[^>]*>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n');

      cleanContent = processedHtml
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&[a-zA-Z0-9#]+;/g, ' ')
        // Supprimer lignes qui ressemblent à du JSON ou du code
        .replace(/^\s*[\[\{].*[\]\}]\s*$/gm, '')
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      console.log(`✂️ [EXTRACTION BEAUTÉ] Contenu nettoyé: ${cleanContent.length} caractères`);

    } catch (contentError) {
      console.error(`❌ [EXTRACTION BEAUTÉ] Erreur nettoyage contenu:`, contentError);
      cleanContent = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000);
    }
    
    // ✅ VALIDATION ET LIMITATION CONTENU BEAUTÉ
    if (!cleanContent || cleanContent.length < 50) {
      console.warn(`⚠️ [EXTRACTION BEAUTÉ] Contenu trop court pour ${url}`);
      cleanContent = `Page beauté: ${url}\n\nLe contenu de cette page beauté n'a pas pu être extrait automatiquement, mais la page a été indexée et peut être consultée à l'adresse ci-dessus.`;
    }
    
    const maxContentLength = 15000;
    if (cleanContent.length > maxContentLength) {
      cleanContent = cleanContent.substring(0, maxContentLength) + '\n\n... [contenu beauté tronqué pour respecter les limites]';
      console.log(`✂️ [EXTRACTION BEAUTÉ] Contenu tronqué à ${maxContentLength} caractères`);
    }
    
    const wordCount = cleanContent.split(/\s+/).filter(word => word.length > 0).length;
    const processingTime = Date.now() - startTime;
    
    // ✅ DÉTECTER LA CATÉGORIE BEAUTÉ À PARTIR DU CONTENU
    const beautyKeywords = {
      skincare: ['skincare', 'soin', 'visage', 'crème', 'sérum', 'masque', 'nettoyant', 'exfoliant', 'hydratant'],
      makeup: ['maquillage', 'makeup', 'fond de teint', 'rouge', 'mascara', 'ombre', 'lip', 'eye'],
      fragrance: ['parfum', 'fragrance', 'eau de toilette', 'eau de parfum', 'cologne'],
      haircare: ['cheveux', 'hair', 'shampoing', 'masque capillaire', 'huile cheveux'],
      bodycare: ['corps', 'body', 'lotion', 'gommage', 'huile corps']
    };
    
    let detectedCategory = 'multi';
    const contentLower = cleanContent.toLowerCase();
    
    for (const [category, keywords] of Object.entries(beautyKeywords)) {
      const matches = keywords.filter(keyword => contentLower.includes(keyword)).length;
      if (matches >= 2) {
        detectedCategory = category;
        break;
      }
    }
    
    const metadata: SafeMetadata = {
      extractedAt: new Date().toISOString(),
      sourceUrl: url,
      wordCount: wordCount,
      extractionMethod: 'html-parse-beauty-v2',
      contentLength: cleanContent.length,
      processingTimeMs: processingTime,
      httpStatus: response.status,
      contentType: contentType,
      beautyCategory: detectedCategory, // ✅ NOUVEAU: Catégorie beauté détectée
      extractionType: 'beauty-focused'
    };
    
    console.log(`✅ [EXTRACTION BEAUTÉ] Terminé en ${processingTime}ms: ${wordCount} mots, catégorie: ${detectedCategory}`);
    
    return { title, content: cleanContent, metadata };
    
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [EXTRACTION BEAUTÉ] Échec pour ${url} après ${processingTime}ms:`, error.message);
    
    const fallbackContent = `Page beauté: ${url}

Cette page beauté n'a pas pu être analysée automatiquement.
Raison: ${error.message}

Vous pouvez consulter cette page directement à l'adresse ci-dessus.`;

    const fallbackMetadata: SafeMetadata = {
      extractedAt: new Date().toISOString(),
      sourceUrl: url,
      wordCount: fallbackContent.split(' ').length,
      extractionMethod: 'fallback-beauty',
      contentLength: fallbackContent.length,
      processingTimeMs: processingTime,
      error: error.message,
      extractionFailed: true,
      beautyCategory: 'unknown'
    };

    console.log(`🔄 [EXTRACTION BEAUTÉ] Fallback appliqué pour ${url}`);
    
    return { 
      title: `Page beauté de ${url}`, 
      content: fallbackContent, 
      metadata: fallbackMetadata 
    };
  }
}

// ✅ HELPER: Upload fichier beauté vers Supabase Storage
async function uploadBeautyFileToSupabase(fileData: any, shopId: string): Promise<{ path: string; url: string }> {
  try {
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(8).toString('hex');

    // ✅ SÉCURITÉ: Extension dérivée du MIME type validé (pas du filename utilisateur)
    const validatedMime = fileData.mimetype as keyof typeof ALLOWED_MIME_TYPES;
    const safeExtension = ALLOWED_MIME_TYPES[validatedMime] || '.bin';
    const fileName = `beauty_${shopId}_${timestamp}_${randomSuffix}${safeExtension}`;
    const filePath = `beauty-knowledge-base/${shopId}/${fileName}`;

    console.log('📤 Upload fichier beauté vers Supabase Storage:', filePath);

    const fileBuffer = await fileData.toBuffer();

    const { data, error } = await supabaseServiceClient.storage
      .from('chatseller-files')
      .upload(filePath, fileBuffer, {
        contentType: validatedMime, // ✅ MIME type déjà validé par la route appelante
        cacheControl: '3600',
        upsert: false
      });
    
    if (error) {
      console.error('❌ Erreur upload Supabase beauté:', error);
      throw new Error(`Erreur upload fichier beauté: ${error.message}`);
    }
    
    const { data: { publicUrl } } = supabaseServiceClient.storage
      .from('chatseller-files')
      .getPublicUrl(filePath);
    
    console.log('✅ Fichier beauté uploadé avec succès:', publicUrl);
    
    return {
      path: filePath,
      url: publicUrl
    };
    
  } catch (error: any) {
    console.error('❌ Erreur upload fichier beauté:', error);
    throw new Error(`Erreur lors de l'upload beauté: ${error.message}`);
  }
}

// ✅ HELPER: Extraire texte d'un fichier beauté
async function extractTextFromBeautyFile(fileData: any, mimeType: string): Promise<{ content: string; wordCount: number; beautyCategory?: string }> {
  try {
    console.log('📄 Extraction de texte du fichier beauté:', fileData.filename, mimeType);
    
    let content = '';
    let beautyCategory = 'multi';
    
    if (mimeType === 'text/plain' || mimeType === 'text/csv') {
      const buffer = await fileData.toBuffer();
      content = buffer.toString('utf-8');
      
    } else if (mimeType === 'application/pdf') {
      content = `[Catalogue Beauté PDF : ${fileData.filename}]\n\nContenu du catalogue beauté PDF non analysé dans cette version. Le fichier a été sauvegardé et sera traité ultérieurement par votre Conseillère IA.`;
      
    } else if (mimeType.includes('word') || mimeType.includes('document')) {
      content = `[Document Beauté Word : ${fileData.filename}]\n\nContenu du document beauté Word non analysé dans cette version. Le fichier a été sauvegardé et sera traité ultérieurement par votre Conseillère IA.`;
      
    } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      content = `[Fichier Beauté Excel : ${fileData.filename}]\n\nContenu du fichier beauté Excel non analysé dans cette version. Le fichier a été sauvegardé et sera traité ultérieurement par votre Conseillère IA.`;
      
    } else if (mimeType.includes('image')) {
      content = `[Image Catalogue Beauté : ${fileData.filename}]\n\nImage de catalogue beauté sauvegardée. L'analyse automatique des images n'est pas encore disponible, mais votre Conseillère IA pourra s'y référer.`;
      
    } else {
      content = `[Fichier Beauté : ${fileData.filename}]\n\nFichier beauté sauvegardé. Type non supporté pour l'extraction automatique.`;
    }
    
    // ✅ DÉTECTER CATÉGORIE BEAUTÉ DANS LE CONTENU
    const beautyKeywords = {
      skincare: ['skincare', 'soin', 'visage', 'crème', 'sérum'],
      makeup: ['maquillage', 'makeup', 'fond', 'rouge', 'mascara'],
      fragrance: ['parfum', 'fragrance', 'eau de toilette'],
      haircare: ['cheveux', 'hair', 'shampoing', 'capillaire'],
      bodycare: ['corps', 'body', 'lotion', 'gommage']
    };
    
    const contentLower = content.toLowerCase();
    const filenameLower = fileData.filename.toLowerCase();
    
    for (const [category, keywords] of Object.entries(beautyKeywords)) {
      const matches = keywords.filter(keyword => 
        contentLower.includes(keyword) || filenameLower.includes(keyword)
      ).length;
      if (matches >= 1) {
        beautyCategory = category;
        break;
      }
    }
    
    const maxLength = 15000;
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '... [contenu beauté tronqué]';
    }
    
    const wordCount = content.split(' ').filter(word => word.length > 0).length;
    
    console.log(`✅ Texte beauté extrait: ${wordCount} mots, catégorie: ${beautyCategory}`);
    
    return { content, wordCount, beautyCategory };
    
  } catch (error: any) {
    console.error('❌ Erreur extraction texte beauté:', error);
    return {
      content: `[Fichier Beauté : ${fileData.filename || 'fichier'}]\n\nErreur lors de l'extraction du contenu beauté. Le fichier a été sauvegardé.`,
      wordCount: 20,
      beautyCategory: 'unknown'
    };
  }
}

// ✅ HELPER: Créer métadonnées beauté sécurisées
function createSafeBeautyMetadata(base: SafeMetadata = {}): Record<string, any> {
  return {
    ...base,
    createdAt: new Date().toISOString(),
    beautyProcessed: true,
    version: 'beauty-v1'
  };
}

// ✅ HELPER: Merger métadonnées beauté existantes
function mergeSafeBeautyMetadata(existing: Record<string, any>, updates: SafeMetadata): Record<string, any> {
  const existingMeta = existing || {};
  return {
    ...existingMeta,
    ...updates,
    lastModified: new Date().toISOString(),
    beautyUpdated: true
  };
}

// ✅ HELPER: Filtrage intelligent des URLs pour base de connaissances
function isRelevantUrlForKnowledgeBase(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // ❌ BLACKLIST - URLs à EXCLURE (pages sans valeur pour la KB)
  const blacklistPatterns = [
    // Pages légales/administratives
    '/privacy', '/confidentialite', '/rgpd', '/gdpr',
    '/terms', '/cgv', '/cgu', '/mentions-legales', '/legal',
    '/cookies', '/cookie-policy',

    // Pages compte/auth
    '/account', '/compte', '/mon-compte', '/my-account',
    '/login', '/connexion', '/signin', '/sign-in',
    '/register', '/inscription', '/signup', '/sign-up',
    '/password', '/mot-de-passe', '/forgot-password',
    '/logout', '/deconnexion',

    // Pages panier/checkout
    '/cart', '/panier', '/basket',
    '/checkout', '/commande', '/paiement', '/payment',
    '/order-confirmation', '/confirmation-commande',

    // Pages techniques
    '/sitemap', '/robots.txt', '/feed', '/rss',
    '/search', '/recherche', '/s?', '/search?',
    '/admin', '/wp-admin', '/wp-login', '/administrator',
    '/api/', '/_next/', '/_nuxt/',

    // Pages de wishlist/comparaison
    '/wishlist', '/favoris', '/compare', '/comparaison',

    // Pages de tracking
    '/track', '/suivi', '/tracking',

    // Paramètres de pagination/filtres excessifs
    '?page=', '&page=', '?sort=', '&sort=',
    '?filter=', '&filter=', '?variant=',

    // Pages 404, erreur
    '/404', '/error', '/not-found'
  ];

  // Vérifier si l'URL contient un pattern blacklisté
  for (const pattern of blacklistPatterns) {
    if (lowerUrl.includes(pattern)) {
      return false;
    }
  }

  // ✅ WHITELIST - URLs à PRIORISER (haute valeur pour KB beauté)
  const whitelistPatterns = [
    // Pages produits/collections
    '/products/', '/product/', '/produits/', '/produit/',
    '/collections/', '/collection/', '/categories/', '/categorie/',
    '/shop/', '/boutique/',

    // Pages marque/histoire
    '/about', '/a-propos', '/notre-histoire', '/our-story',
    '/qui-sommes-nous', '/brand', '/marque',
    '/notre-marque', '/notre-engagement',

    // Pages FAQ/aide
    '/faq', '/aide', '/help', '/questions',
    '/support', '/contact',

    // Pages conseils/blog beauté
    '/conseils', '/tips', '/advice',
    '/blog', '/journal', '/magazine', '/articles',
    '/guides', '/guide', '/tutoriels', '/tutorials',

    // Pages ingrédients/formules
    '/ingredients', '/ingredient', '/actifs',
    '/formules', '/formulations', '/composition',

    // Pages livraison/retours (info utile)
    '/livraison', '/shipping', '/delivery',
    '/retours', '/returns', '/echanges',

    // Pages routines/rituels beauté
    '/routine', '/rituel', '/ritual',

    // Page d'accueil (toujours utile)
    // On accepte aussi les URLs sans path spécifique
  ];

  // Bonus: si l'URL matche un pattern whitelist, c'est clairement pertinent
  for (const pattern of whitelistPatterns) {
    if (lowerUrl.includes(pattern)) {
      return true;
    }
  }

  // Par défaut, accepter les URLs qui ne sont pas blacklistées
  // (pages comme /page-personnalisee, /notre-univers, etc.)
  return true;
}

// ✅ HELPER: Filtrer et scorer les URLs pour prioriser les plus pertinentes
function filterAndScoreUrls(urls: string[], maxUrls: number): string[] {
  // Scorer chaque URL
  const scoredUrls = urls.map(url => {
    const lowerUrl = url.toLowerCase();
    let score = 0;

    // Haute priorité: pages produits/collections
    if (lowerUrl.includes('/products/') || lowerUrl.includes('/produits/')) score += 10;
    if (lowerUrl.includes('/collections/') || lowerUrl.includes('/categories/')) score += 8;

    // Haute priorité: pages marque
    if (lowerUrl.includes('/about') || lowerUrl.includes('/a-propos')) score += 9;
    if (lowerUrl.includes('/notre-histoire') || lowerUrl.includes('/our-story')) score += 9;

    // Moyenne priorité: FAQ, conseils
    if (lowerUrl.includes('/faq') || lowerUrl.includes('/aide')) score += 7;
    if (lowerUrl.includes('/conseils') || lowerUrl.includes('/blog')) score += 6;
    if (lowerUrl.includes('/ingredients') || lowerUrl.includes('/formules')) score += 7;

    // Moyenne priorité: infos pratiques
    if (lowerUrl.includes('/livraison') || lowerUrl.includes('/retours')) score += 5;
    if (lowerUrl.includes('/contact')) score += 4;

    // Page d'accueil
    if (url.replace(/https?:\/\/[^\/]+\/?$/, '') === '' || url.endsWith('/')) score += 8;

    // Pénalité: URLs très longues (souvent des variantes produits)
    if (url.length > 150) score -= 2;

    // Pénalité: beaucoup de segments (URLs profondes)
    const segments = url.split('/').filter(s => s).length;
    if (segments > 5) score -= 1;

    return { url, score };
  });

  // Trier par score décroissant et prendre les N premiers
  scoredUrls.sort((a, b) => b.score - a.score);

  const filteredUrls = scoredUrls
    .filter(item => isRelevantUrlForKnowledgeBase(item.url))
    .slice(0, maxUrls)
    .map(item => item.url);

  console.log(`🎯 [FILTRAGE KB] ${urls.length} URLs → ${filteredUrls.length} URLs pertinentes (max: ${maxUrls})`);

  return filteredUrls;
}

// ✅ HELPER: Découvrir pages d'un site beauté
async function discoverBeautyWebsitePages(baseUrl: string, maxPages: number = 50): Promise<string[]> {
  const startTime = Date.now();
  
  try {
    console.log(`🔍 [DÉCOUVERTE BEAUTÉ] Début pour: ${baseUrl} (max: ${maxPages})`);
    
    const discoveredUrls = new Set<string>();
    const domain = new URL(baseUrl).hostname;
    
    // ✅ ÉTAPE 1: Sitemap.xml
    try {
      console.log(`🗺️ [DÉCOUVERTE BEAUTÉ] Recherche sitemap...`);
      const sitemapUrls = await extractSitemapUrls(baseUrl);
      sitemapUrls.forEach(url => discoveredUrls.add(url));
      console.log(`✅ [DÉCOUVERTE BEAUTÉ] Sitemap: ${sitemapUrls.length} URLs trouvées`);
    } catch (sitemapError) {
      console.log(`⚠️ [DÉCOUVERTE BEAUTÉ] Sitemap non disponible:`, sitemapError instanceof Error ? sitemapError.message : String(sitemapError));
    }
    
    // ✅ ÉTAPE 2: Crawling beauté
    if (discoveredUrls.size < 3) {
      try {
        console.log(`🕷️ [DÉCOUVERTE BEAUTÉ] Crawling des liens...`);
        const crawledUrls = await crawlBeautyInternalLinks(baseUrl, domain, maxPages);
        crawledUrls.forEach(url => discoveredUrls.add(url));
        console.log(`✅ [DÉCOUVERTE BEAUTÉ] Crawling: ${crawledUrls.length} URLs supplémentaires`);
      } catch (crawlError) {
        console.warn(`⚠️ [DÉCOUVERTE BEAUTÉ] Erreur crawling:`, crawlError instanceof Error ? crawlError.message : String(crawlError));
      }
    }
    
    discoveredUrls.add(baseUrl);

    // ✅ ÉTAPE 3: Filtrage intelligent des URLs
    const allUrls = Array.from(discoveredUrls);
    const filteredUrls = filterAndScoreUrls(allUrls, maxPages);

    const processingTime = Date.now() - startTime;

    console.log(`🎯 [DÉCOUVERTE BEAUTÉ] Terminé en ${processingTime}ms: ${allUrls.length} URLs brutes → ${filteredUrls.length} pages pertinentes`);

    return filteredUrls;
    
  } catch (error: any) {
    console.error(`❌ [DÉCOUVERTE BEAUTÉ] Erreur:`, error.message);
    console.log(`🔄 [DÉCOUVERTE BEAUTÉ] Fallback: URL de base uniquement`);
    return [baseUrl];
  }
}

// ✅ HELPER: Extraire URLs depuis sitemap.xml
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
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(sitemapUrl, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (compatible; ChatSeller-BeautyBot/1.0)',
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
          return urls.slice(0, 50);
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

// ✅ HELPER: Crawler liens internes beauté
async function crawlBeautyInternalLinks(startUrl: string, domain: string, maxPages: number = 20): Promise<string[]> {
  try {
    console.log(`🕷️ [CRAWL BEAUTÉ] Début: ${startUrl} (max: ${maxPages})`);
    
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
        console.log(`🔍 [CRAWL BEAUTÉ] Analyse: ${currentUrl}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(currentUrl, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (compatible; ChatSeller-BeautyBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
          console.log(`⚠️ [CRAWL BEAUTÉ] Ignoré: ${currentUrl} (${response.status})`);
          continue;
        }
        
        const html = await response.text();
        discoveredUrls.add(currentUrl);
        
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
              
              if (fullUrl &&
                  fullUrl.includes(domain) &&
                  !visitedUrls.has(fullUrl) &&
                  !discoveredUrls.has(fullUrl) &&
                  discoveredUrls.size + newLinksFound < maxPages) {

                // ✅ Filtrage: exclure fichiers statiques ET URLs non pertinentes
                const isStaticFile = /\.(pdf|jpg|jpeg|png|gif|css|js|ico|xml|json|zip|mp4|mp3)(\?|$)/i.test(fullUrl);
                const isRelevant = isRelevantUrlForKnowledgeBase(fullUrl);

                if (!isStaticFile && isRelevant) {
                  toVisit.push(fullUrl);
                  newLinksFound++;
                }
              }
            } catch (urlError) {
              // Ignorer les URLs malformées
            }
          });
          
          console.log(`📎 [CRAWL BEAUTÉ] ${newLinksFound} nouveaux liens trouvés`);
        }
        
        errorCount = 0;
        
      } catch (fetchError: any) {
        errorCount++;
        console.log(`❌ [CRAWL BEAUTÉ] Erreur ${currentUrl}: ${fetchError.message}`);
        if (errorCount >= maxErrors) {
          console.log(`⚠️ [CRAWL BEAUTÉ] Trop d'erreurs, arrêt`);
          break;
        }
        continue;
      }
      
      if (toVisit.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    
    const finalUrls = Array.from(discoveredUrls);
    console.log(`✅ [CRAWL BEAUTÉ] Terminé: ${finalUrls.length} pages découvertes`);
    return finalUrls;
    
  } catch (error: any) {
    console.error(`❌ [CRAWL BEAUTÉ] Erreur globale:`, error.message);
    return [];
  }
}

// ✅ HELPER: Traiter plusieurs pages beauté
async function processMultipleBeautyWebsitePages(
  urls: string[], 
  baseTitle: string, 
  tags: string[] = [], 
  shopId: string
): Promise<KnowledgeBaseDocument[]> {
  const startTime = Date.now();
  
  try {
    console.log(`📄 [TRAITEMENT BEAUTÉ] Début pour ${urls.length} pages`);
    
    const processedDocuments: KnowledgeBaseDocument[] = [];
    const errors: Array<{ url: string; error: string }> = [];
    let successCount = 0;
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      try {
        console.log(`📄 [TRAITEMENT BEAUTÉ] [${i + 1}/${urls.length}] ${url}`);
        
        const { title, content, metadata } = await extractBeautyContentFromUrl(url);
        
        let pageTitle = baseTitle;
        if (urls.length > 1) {
          if (title && title !== 'Document beauté extrait' && !title.includes('Page beauté de')) {
            pageTitle = `${baseTitle} - ${title}`;
          } else {
            pageTitle = `${baseTitle} - Page ${i + 1}`;
          }
        }
        
        if (pageTitle.length > 255) {
          pageTitle = pageTitle.substring(0, 252) + '...';
        }
        
        console.log(`💾 [TRAITEMENT BEAUTÉ] Sauvegarde: ${pageTitle}`);
        
        const { data: newDocument, error } = await supabaseServiceClient
          .from('knowledge_base')
          .insert({
            id: crypto.randomUUID(),
            shop_id: shopId,
            title: pageTitle,
            content: content,
            content_type: 'website',
            source_file: null,
            source_url: url,
            tags: [...tags, 'website', 'indexation-beaute', metadata.beautyCategory || 'multi'],
            is_active: true,
            updated_at: new Date().toISOString(),
            metadata: createSafeBeautyMetadata({
              ...metadata,
              sourceUrl: url,
              pageIndex: i + 1,
              totalPages: urls.length,
              processedAt: new Date().toISOString(),
              batchId: `beauty_batch_${Date.now()}`,
              beautyCategory: metadata.beautyCategory
            })
          })
          .select()
          .single();
        
        if (error) {
          console.error(`❌ [TRAITEMENT BEAUTÉ] Erreur DB pour ${url}:`, error.message);
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
          console.log(`✅ [TRAITEMENT BEAUTÉ] Document créé: ${newDocument.id}`);
        }
        
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        
      } catch (pageError: any) {
        console.error(`❌ [TRAITEMENT BEAUTÉ] Erreur page ${url}:`, pageError.message);
        errors.push({ url, error: pageError.message });
      }
    }
    
    const processingTime = Date.now() - startTime;

    console.log(`✅ [TRAITEMENT BEAUTÉ] Terminé en ${processingTime}ms: ${successCount}/${urls.length} succès, ${errors.length} erreurs`);

    if (errors.length > 0 && errors.length < 5) {
      console.warn(`⚠️ [TRAITEMENT BEAUTÉ] Erreurs détaillées:`, errors);
    }

    // ✅ AUTO-LIAISON : Lier automatiquement les nouveaux documents à l'agent principal du shop
    if (processedDocuments.length > 0) {
      try {
        // Récupérer l'agent principal (le plus récent actif)
        const { data: mainAgent } = await supabaseServiceClient
          .from('agents')
          .select('id')
          .eq('shop_id', shopId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (mainAgent) {
          console.log(`🔗 [TRAITEMENT BEAUTÉ] Liaison automatique à l'agent ${mainAgent.id}`);

          // Créer les liaisons agent_knowledge_base
          const linksData = processedDocuments.map((doc, index) => ({
            agent_id: mainAgent.id,
            knowledge_base_id: doc.id,
            is_active: true,
            priority: index
          }));

          const { error: linkError } = await supabaseServiceClient
            .from('agent_knowledge_base')
            .insert(linksData);

          if (linkError) {
            console.warn(`⚠️ [TRAITEMENT BEAUTÉ] Erreur liaison KB->Agent (non bloquante):`, linkError.message);
          } else {
            console.log(`✅ [TRAITEMENT BEAUTÉ] ${processedDocuments.length} documents liés à l'agent ${mainAgent.id}`);

            // Mettre à jour linkedAgents dans les documents retournés
            processedDocuments.forEach(doc => {
              doc.linkedAgents = [mainAgent.id];
            });
          }
        } else {
          console.log(`ℹ️ [TRAITEMENT BEAUTÉ] Aucun agent actif trouvé pour le shop ${shopId}, documents non liés`);
        }
      } catch (linkError: any) {
        console.warn(`⚠️ [TRAITEMENT BEAUTÉ] Erreur auto-liaison (non bloquante):`, linkError.message);
      }
    }

    return processedDocuments;
    
  } catch (error: any) {
    console.error(`❌ [TRAITEMENT BEAUTÉ] Erreur globale:`, error.message);
    throw new Error(`Erreur lors du traitement des pages beauté: ${error.message}`);
  }
}

export default async function knowledgeBaseRoutes(fastify: FastifyInstance) {
  
  // ✅ ENREGISTRER LE PLUGIN @FASTIFY/MULTIPART
  await fastify.register(require('@fastify/multipart'), {
    attachFieldsToBody: true,
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB max
      files: 1
    }
  });
  
  // ✅ ROUTE : LISTE DES DOCUMENTS BEAUTÉ
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🔍 Récupération des documents de base de connaissances beauté');
      
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);

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
        console.error('Erreur récupération documents beauté:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération des documents beauté'
        });
      }

      const planLimits = await checkBeautyPlanLimits(shop.id, shop.subscription_plan);

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
              fileSize: BEAUTY_PLAN_LIMITS[shop.subscription_plan as keyof typeof BEAUTY_PLAN_LIMITS]?.fileSize || BEAUTY_PLAN_LIMITS.starter.fileSize,
              indexablePages: BEAUTY_PLAN_LIMITS[shop.subscription_plan as keyof typeof BEAUTY_PLAN_LIMITS]?.indexablePages || BEAUTY_PLAN_LIMITS.starter.indexablePages
            },
            usage: {
              documents: planLimits.currentCount,
              canAddMore: planLimits.canAdd
            }
          }
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get knowledge base beauté error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({ 
        success: false,
        error: 'Erreur lors de la récupération des documents beauté',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : UPLOAD DE FICHIER BEAUTÉ
    fastify.post('/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('📤 Upload de fichier beauté KB');
      
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ VÉRIFIER LES LIMITES DU PLAN BEAUTÉ
      const planLimits = await checkBeautyPlanLimits(shop.id, shop.subscription_plan);
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

      // ✅ RÉCUPÉRER LE FICHIER AVEC VALIDATION RENFORCÉE
      let data: any;
      try {
        data = await (request as any).file();
      } catch (multipartError: any) {
        return reply.status(400).send({
          success: false,
          error: 'Erreur de réception du fichier beauté. Vérifiez le format et la taille.',
          details: process.env.NODE_ENV === 'development' ? multipartError.message : undefined
        });
      }
      
      if (!data) {
        return reply.status(400).send({
          success: false,
          error: 'Aucun fichier beauté fourni'
        });
      }

      // ✅ VALIDATION EXTENSION FICHIER
      const fileExtension = path.extname(data.filename || '').toLowerCase();
      const allowedExtensions = Object.values(ALLOWED_MIME_TYPES);
      
      if (!allowedExtensions.includes(fileExtension)) {
        return reply.status(400).send({
          success: false,
          error: `Extension de fichier beauté non autorisée: ${fileExtension}. Extensions acceptées: ${allowedExtensions.join(', ')}`
        });
      }

      // ✅ VÉRIFIER LE TYPE MIME ET L'EXTENSION
      if (!ALLOWED_MIME_TYPES[data.mimetype as keyof typeof ALLOWED_MIME_TYPES]) {
        return reply.status(400).send({
          success: false,
          error: 'Type de fichier beauté non autorisé',
          allowedTypes: Object.keys(ALLOWED_MIME_TYPES)
        });
      }

      const fileBuffer = await data.toBuffer();
      const fileSize = fileBuffer.length;

      // ✅ VÉRIFICATION TAILLE FICHIER AVEC MESSAGE SPÉCIFIQUE AU PLAN
      const planConfig = BEAUTY_PLAN_LIMITS[shop.subscription_plan as keyof typeof BEAUTY_PLAN_LIMITS] || BEAUTY_PLAN_LIMITS.starter;
      
      if (fileSize > planConfig.fileSize) {
        const currentPlanLimit = Math.round(planConfig.fileSize / 1024 / 1024);
        let upgradeMessage = '';
        
        if (shop.subscription_plan === 'starter') {
          upgradeMessage = ' Passez au plan Growth (25MB) ou Performance (100MB) pour des fichiers plus volumineux.';
        } else if (shop.subscription_plan === 'growth') {
          upgradeMessage = ' Passez au plan Performance (100MB) pour des fichiers plus volumineux.';
        }
        
        return reply.status(400).send({
          success: false,
          error: `Fichier beauté trop volumineux. Taille max pour votre plan ${shop.subscription_plan}: ${currentPlanLimit}MB${upgradeMessage}`,
          planLimits: {
            current: Math.round(fileSize / 1024 / 1024),
            max: currentPlanLimit,
            plan: shop.subscription_plan
          }
        });
      }

      // ✅ VALIDATION ANTI-VIRUS BASIQUE (vérifier signatures malveillantes)
      const fileHeader = fileBuffer.slice(0, 512);
      const headerHex = fileHeader.toString('hex').toLowerCase();
      
      // Signatures basiques de fichiers malveillants
      const maliciousSignatures = [
        '4d5a', // PE executables (.exe)
        '504b0304', // ZIP avec .exe caché
        '526172211a', // RAR files
      ];
      
      if (maliciousSignatures.some(sig => headerHex.startsWith(sig))) {
        fastify.log.warn(`🚨 Tentative upload fichier suspect: ${data.filename} par shop ${shop.id}`);
        return reply.status(400).send({
          success: false,
          error: 'Type de fichier beauté non autorisé pour des raisons de sécurité'
        });
      }

      // ✅ UPLOAD VERS SUPABASE STORAGE AVEC GESTION D'ERREURS
      let storagePath: string, storageUrl: string;
      try {
        const uploadResult = await uploadBeautyFileToSupabase(data, shop.id);
        storagePath = uploadResult.path;
        storageUrl = uploadResult.url;
      } catch (storageError: any) {
        fastify.log.error('❌ Erreur upload Supabase beauté:', storageError);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors du stockage du fichier beauté. Réessayez dans quelques instants.',
          retryable: true
        });
      }

      // ✅ EXTRAIRE LE CONTENU DU FICHIER BEAUTÉ
      const { content, wordCount, beautyCategory } = await extractTextFromBeautyFile(data, data.mimetype);

      // ✅ CRÉER LE DOCUMENT BEAUTÉ EN BASE AVEC TRANSACTION
      const metadata = createSafeBeautyMetadata({
        originalFileName: data.filename,
        fileSize: fileSize,
        mimeType: data.mimetype,
        wordCount: wordCount,
        storagePath: storagePath,
        storageUrl: storageUrl,
        processedAt: new Date().toISOString(),
        beautyCategory: beautyCategory,
        uploadedBy: user.id,
        shopPlan: shop.subscription_plan
      });

      const { data: newDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .insert({
          id: crypto.randomUUID(),
          shop_id: shop.id,
          title: data.filename || 'Fichier beauté uploadé',
          content: content,
          content_type: 'file',
          source_file: data.filename,
          source_url: storageUrl,
          tags: ['fichier', 'upload', 'beaute', beautyCategory || 'multi', shop.subscription_plan],
          is_active: true,
          updated_at: new Date().toISOString(),
          metadata: metadata
        })
        .select()
        .single();

      if (error) {
        // ✅ NETTOYAGE EN CAS D'ERREUR DB
        try {
          await supabaseServiceClient.storage
            .from('chatseller-files')
            .remove([storagePath]);
        } catch (cleanupError) {
          fastify.log.warn('⚠️ Erreur nettoyage fichier beauté après échec DB: %s', cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
        }
        
        console.error('Erreur création document beauté:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création du document beauté en base de données'
        });
      }

      fastify.log.info(`✅ Fichier beauté KB uploadé avec succès: ${newDocument.id} (${beautyCategory})`);

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
        },
        meta: {
          beautyCategory: beautyCategory,
          wordCount: wordCount,
          fileSizeMB: Math.round(fileSize / 1024 / 1024 * 100) / 100,
          processingTime: metadata.processedAt
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Upload file beauté error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'upload du fichier beauté',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        retryable: !error.message.includes('validation') && !error.message.includes('limite')
      });
    }
  });

  // ✅ AJOUT : Route pour obtenir les statistiques de la base de connaissances beauté
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ RÉCUPÉRER LES STATISTIQUES GLOBALES
      const { data: documents, error } = await supabaseServiceClient
        .from('knowledge_base')
        .select('content_type, tags, metadata, is_active, created_at')
        .eq('shop_id', shop.id);

      if (error) {
        throw new Error('Erreur récupération statistiques beauté');
      }

      const stats = {
        total: documents.length,
        active: documents.filter(doc => doc.is_active).length,
        inactive: documents.filter(doc => !doc.is_active).length,
        byType: {
          manual: documents.filter(doc => doc.content_type === 'manual').length,
          file: documents.filter(doc => doc.content_type === 'file').length,
          website: documents.filter(doc => doc.content_type === 'website').length,
          url: documents.filter(doc => doc.content_type === 'url').length,
        },
        byBeautyCategory: {} as Record<string, number>,
        totalWordCount: 0,
        totalFileSize: 0,
        planUsage: await checkBeautyPlanLimits(shop.id, shop.subscription_plan)
      };

      // ✅ CALCULER LES STATISTIQUES BEAUTÉ
      documents.forEach(doc => {
        // Catégories beauté
        const beautyCategory = doc.metadata?.beautyCategory || 'multi';
        stats.byBeautyCategory[beautyCategory] = (stats.byBeautyCategory[beautyCategory] || 0) + 1;
        
        // Mots et taille
        if (doc.metadata?.wordCount) {
          stats.totalWordCount += doc.metadata.wordCount;
        }
        if (doc.metadata?.fileSize) {
          stats.totalFileSize += doc.metadata.fileSize;
        }
      });

      return {
        success: true,
        data: stats,
        meta: {
          shopId: shop.id,
          plan: shop.subscription_plan,
          calculatedAt: new Date().toISOString()
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get KB stats error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des statistiques beauté'
      });
    }
  });

  // ✅ ROUTE : TRAITEMENT SITE WEB BEAUTÉ
  fastify.post('/website', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = `beauty_req_${Date.now()}`;
    
    try {
      fastify.log.info(`🌐 [${requestId}] DÉBUT traitement site beauté complet`);
      
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);
      const body = websiteProcessSchema.parse(request.body);

      fastify.log.info(`🔐 [${requestId}] Auth OK - Shop beauté: ${shop.id}, Plan: ${shop.subscription_plan}`);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ VÉRIFIER LES LIMITES DU PLAN BEAUTÉ
      const planLimits = await checkBeautyPlanLimits(shop.id, shop.subscription_plan);
      if (!planLimits.canAdd) {
        return reply.status(403).send({
          success: false,
          error: planLimits.reason,
          requiresUpgrade: true
        });
      }

      fastify.log.info(`📊 [${requestId}] Plan beauté vérifié - ${planLimits.currentCount}/${planLimits.limit} documents`);

      // ✅ SÉCURITÉ: Bloquer les URLs internes (SSRF)
      if (isBlockedUrl(body.url)) {
        return reply.status(400).send({
          success: false,
          error: 'URL non autorisée. Seules les URLs publiques sont acceptées.'
        });
      }

      // ✅ DÉCOUVRIR PAGES DU SITE BEAUTÉ
      const maxPagesPerPlan = {
        starter: 10,
        growth: 25, 
        performance: 50,
        // Fallbacks
        free: 5,
        pro: 25,
        enterprise: 50
      };
      
      const maxPages = Math.min(
        maxPagesPerPlan[shop.subscription_plan as keyof typeof maxPagesPerPlan] || 10,
        planLimits.limit === -1 ? 50 : Math.max(1, planLimits.limit - planLimits.currentCount)
      );
      
      fastify.log.info(`🔍 [${requestId}] Découverte max ${maxPages} pages beauté pour ${body.url}`);
      
      const discoveredUrls = await discoverBeautyWebsitePages(body.url, maxPages);
      
      if (discoveredUrls.length === 0) {
        fastify.log.warn(`❌ [${requestId}] Aucune page beauté trouvée`);
        return reply.status(400).send({
          success: false,
          error: 'Aucune page beauté accessible trouvée sur ce site. Vérifiez que l\'URL est correcte et accessible.'
        });
      }

      fastify.log.info(`✅ [${requestId}] ${discoveredUrls.length} page(s) beauté découverte(s)`);

      // ✅ VÉRIFIER L'ESPACE DISPONIBLE
      const availableSlots = planLimits.limit === -1 ? discoveredUrls.length : (planLimits.limit - planLimits.currentCount);
      
      if (availableSlots < discoveredUrls.length) {
        return reply.status(403).send({
          success: false,
          error: `Pas assez d'espace dans votre plan beauté. ${discoveredUrls.length} pages découvertes mais seulement ${availableSlots} emplacement(s) disponible(s). Passez au plan supérieur ou supprimez quelques documents existants.`,
          requiresUpgrade: true,
          meta: {
            discoveredPages: discoveredUrls.length,
            availableSlots: availableSlots,
            planLimit: planLimits.limit
          }
        });
      }

      // ✅ TRAITER TOUTES LES PAGES BEAUTÉ
      const baseTitle = body.title || `Site beauté ${new URL(body.url).hostname}`;
      const beautyTags = body.tags.length > 0 ? body.tags : ['website', 'indexation-beaute', body.beautyCategory || 'multi'];
      
      fastify.log.info(`🏗️ [${requestId}] Traitement ${discoveredUrls.length} pages beauté...`);
      
      const processedDocuments = await processMultipleBeautyWebsitePages(
        discoveredUrls,
        baseTitle,
        beautyTags,
        shop.id
      );

      if (processedDocuments.length === 0) {
        fastify.log.error(`❌ [${requestId}] Aucune page beauté traitée avec succès`);
        return reply.status(500).send({
          success: false,
          error: 'Aucune page beauté n\'a pu être traitée avec succès. Le site pourrait être inaccessible ou protégé contre l\'indexation automatique.'
        });
      }

      fastify.log.info(`✅ [${requestId}] SUCCÈS BEAUTÉ: ${processedDocuments.length}/${discoveredUrls.length} documents créés`);

      return {
        success: true,
        data: processedDocuments,
        meta: {
          totalPagesDiscovered: discoveredUrls.length,
          totalDocumentsCreated: processedDocuments.length,
          successRate: Math.round((processedDocuments.length / discoveredUrls.length) * 100),
          baseUrl: body.url,
          indexationType: 'complete-beauty-website',
          beautyCategory: body.beautyCategory || 'multi',
          processedAt: new Date().toISOString(),
          requestId: requestId
        }
      };

    } catch (error: any) {
      fastify.log.error(`❌ [${requestId}] Erreur site beauté:`, error);
      
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
      
      let errorMessage = 'Erreur lors du traitement du site beauté';
      
      if (error.message.includes('fetch')) {
        errorMessage += ': Impossible de récupérer le contenu du site beauté. Vérifiez que l\'URL est accessible.';
      } else if (error.message.includes('timeout')) {
        errorMessage += ': Le site beauté met trop de temps à répondre.';
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

  // ✅ ROUTE : CRÉER UN DOCUMENT MANUEL BEAUTÉ
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🏗️ Création d\'un nouveau document beauté KB');
      
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);
      const body = createKnowledgeBaseSchema.parse(request.body);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      // ✅ VÉRIFIER LES LIMITES DU PLAN BEAUTÉ
      const planLimits = await checkBeautyPlanLimits(shop.id, shop.subscription_plan);
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

      const metadata = createSafeBeautyMetadata({
        wordCount: body.content.split(' ').length,
        createdManually: true,
        contentType: body.contentType,
        beautyCategory: body.beautyCategory || 'multi',
        productType: body.productType
      });

      const { data: newDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .insert({
          id: crypto.randomUUID(),
          shop_id: shop.id,
          title: body.title,
          content: body.content,
          content_type: body.contentType,
          source_file: body.sourceFile || null,
          source_url: body.sourceUrl || null,
          tags: [...body.tags, 'beaute', body.beautyCategory || 'multi'],
          is_active: body.isActive,
          updated_at: new Date().toISOString(),
          metadata: metadata
        })
        .select()
        .single();

      if (error) {
        console.error('Erreur création document beauté manuel:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création du document beauté'
        });
      }

      fastify.log.info(`✅ Document beauté KB créé avec succès: ${newDocument.id}`);

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
      fastify.log.error('❌ Create knowledge base beauté error:', error);
      
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
        error: 'Erreur lors de la création du document beauté',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : EXTRAIRE CONTENU D'UNE URL BEAUTÉ
  fastify.post('/extract-url', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);
      const body = extractUrlSchema.parse(request.body);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      const planLimits = await checkBeautyPlanLimits(shop.id, shop.subscription_plan);
      if (!planLimits.canAdd) {
        return reply.status(403).send({
          success: false,
          error: planLimits.reason,
          requiresUpgrade: true
        });
      }

      // ✅ SÉCURITÉ: Bloquer les URLs internes (SSRF)
      if (isBlockedUrl(body.url)) {
        return reply.status(400).send({
          success: false,
          error: 'URL non autorisée. Seules les URLs publiques sont acceptées.'
        });
      }

      const { title, content, metadata } = await extractBeautyContentFromUrl(body.url);

      const { data: newDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .insert({
          id: crypto.randomUUID(),
          shop_id: shop.id,
          title: body.title || title,
          content: content,
          content_type: 'url',
          source_file: null,
          source_url: body.url,
          tags: ['beaute', 'url', metadata.beautyCategory || 'multi'],
          is_active: true,
          updated_at: new Date().toISOString(),
          metadata: createSafeBeautyMetadata(metadata)
        })
        .select()
        .single();

      if (error) {
        console.error('Erreur création document beauté URL:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création du document beauté'
        });
      }

      fastify.log.info(`✅ Contenu beauté extrait de l'URL et document créé: ${newDocument.id}`);

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
      fastify.log.error('❌ Extract URL beauté error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'URL beauté invalide',
          details: error.errors
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'extraction du contenu beauté',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : OBTENIR UN DOCUMENT BEAUTÉ
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);

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
          error: 'Document beauté non trouvé' 
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
      fastify.log.error('❌ Get knowledge base beauté document error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération du document beauté',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : METTRE À JOUR UN DOCUMENT BEAUTÉ
  fastify.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);
      const body = updateKnowledgeBaseSchema.parse(request.body);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      const { data: existingDocument, error: fetchError } = await supabaseServiceClient
        .from('knowledge_base')
        .select('*')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (fetchError || !existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document beauté non trouvé' 
        });
      }

      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (body.title) updateData.title = body.title;
      if (body.content) {
        updateData.content = body.content;
        updateData.metadata = mergeSafeBeautyMetadata(existingDocument.metadata, {
          wordCount: body.content.split(' ').length,
          beautyCategory: body.beautyCategory
        });
      }
      if (body.tags) updateData.tags = [...body.tags, 'beaute'];
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const { data: updatedDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Erreur mise à jour document beauté:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la mise à jour du document beauté'
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
      fastify.log.error('❌ Update knowledge base beauté error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la modification du document beauté'
      });
    }
  });

  // ✅ ROUTE : SUPPRIMER UN DOCUMENT BEAUTÉ
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      const { data: existingDocument, error: fetchError } = await supabaseServiceClient
        .from('knowledge_base')
        .select('*')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (fetchError || !existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document beauté non trouvé' 
        });
      }

      // ✅ SUPPRIMER LE FICHIER BEAUTÉ DE SUPABASE STORAGE
      if (existingDocument.content_type === 'file' && existingDocument.metadata) {
        try {
          const metadata = existingDocument.metadata as SafeMetadata;
          if (metadata.storagePath) {
            const { error: deleteError } = await supabaseServiceClient.storage
              .from('chatseller-files')
              .remove([metadata.storagePath]);
              
            if (deleteError) {
              fastify.log.warn('⚠️ Erreur suppression fichier beauté storage: %s', deleteError.message);
            } else {
              fastify.log.info('✅ Fichier beauté supprimé du storage: %s', metadata.storagePath);
            }
          }
        } catch (storageError: any) {
          fastify.log.warn('⚠️ Erreur lors de la suppression du fichier beauté storage:', storageError.message);
        }
      }

      const { error } = await supabaseServiceClient
        .from('knowledge_base')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Erreur suppression document beauté:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la suppression du document beauté'
        });
      }

      return { 
        success: true, 
        message: 'Document beauté supprimé avec succès' 
      };

    } catch (error: any) {
      fastify.log.error('❌ Delete knowledge base beauté error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la suppression du document beauté'
      });
    }
  });

  // ✅ AJOUT : Route pour vérifier la santé de l'API
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Vérifier la connexion Supabase
      const { data, error } = await supabaseServiceClient
        .from('shops')
        .select('id')
        .limit(1);

      if (error) {
        return reply.status(503).send({
          success: false,
          status: 'degraded',
          error: 'Connexion base de données indisponible'
        });
      }

      return {
        success: true,
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: 'beauty-v1.0',
        features: {
          fileUpload: true,
          websiteIndexing: true,
          beautyCategories: true,
          multiPlan: true
        }
      };

    } catch (error: any) {
      return reply.status(503).send({
        success: false,
        status: 'error',
        error: 'Service temporairement indisponible'
      });
    }
  });
  


  // ✅ ROUTE : TOGGLE STATUT BEAUTÉ
  fastify.patch<{ Params: { id: string } }>('/:id/toggle', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getBeautyShopWithPlanCheck(user);
      const body = toggleKnowledgeBaseSchema.parse(request.body);

      if (!canAccess) {
        return reply.status(403).send({ 
          success: false, 
          error: reason,
          requiresUpgrade: true
        });
      }

      const { data: existingDocument, error: fetchError } = await supabaseServiceClient
        .from('knowledge_base')
        .select('id')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (fetchError || !existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document beauté non trouvé' 
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
        console.error('Erreur toggle document beauté:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la modification du statut beauté'
        });
      }

      fastify.log.info(`✅ Statut document beauté KB modifié: ${id} -> ${body.isActive ? 'actif' : 'inactif'}`);

      return {
        success: true,
        data: {
          id: updatedDocument.id,
          isActive: updatedDocument.is_active,
          updatedAt: updatedDocument.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Toggle knowledge base beauté error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la modification du statut beauté',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
}