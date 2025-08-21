// src/routes/knowledge-base.ts - VERSION SUPABASE PURE
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

// ✅ HELPER: Récupérer shop avec vérification plan et essai (SUPABASE)
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

// ✅ HELPER: Vérifier les limites du plan (SUPABASE)
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
    .eq('shopId', shopId);

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

// ✅ HELPER: Extraire contenu d'une URL (VERSION AMÉLIORÉE)
async function extractContentFromUrl(url: string): Promise<{ title: string; content: string; metadata: SafeMetadata }> {
  try {
    console.log('🌐 Extraction de contenu depuis:', url);
    
    // ✅ TIMEOUT VIA ABORTCONTROLLER
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ChatSeller-Bot/1.0'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // ✅ EXTRACTION AMÉLIORÉE DU TITRE
    let title = 'Document extrait';
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].trim().substring(0, 200);
    }
    
    // ✅ EXTRACTION AMÉLIORÉE DU CONTENU
    let cleanContent = html
      // Supprimer scripts et styles
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<noscript[^>]*>.*?<\/noscript>/gis, '')
      // Supprimer commentaires HTML
      .replace(/<!--.*?-->/gis, '')
      // Supprimer balises HTML mais garder le contenu
      .replace(/<[^>]*>/g, ' ')
      // Nettoyer les espaces
      .replace(/\s+/g, ' ')
      .trim();
    
    // Limiter la taille du contenu
    const maxContentLength = 10000;
    if (cleanContent.length > maxContentLength) {
      cleanContent = cleanContent.substring(0, maxContentLength) + '... [contenu tronqué]';
    }
    
    const wordCount = cleanContent.split(' ').filter(word => word.length > 0).length;
    
    const metadata: SafeMetadata = {
      extractedAt: new Date().toISOString(),
      sourceUrl: url,
      wordCount: wordCount,
      extractionMethod: 'html-parse',
      contentLength: cleanContent.length
    };
    
    console.log(`✅ Contenu extrait: ${wordCount} mots, ${cleanContent.length} caractères`);
    
    return { title, content: cleanContent, metadata };
    
  } catch (error: any) {
    console.error('❌ Erreur extraction URL:', error);
    throw new Error(`Erreur lors de l'extraction du contenu: ${error.message}`);
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

export default async function knowledgeBaseRoutes(fastify: FastifyInstance) {
  
  // ✅ ENREGISTRER LE PLUGIN @FASTIFY/MULTIPART V6
  await fastify.register(require('@fastify/multipart'), {
    attachFieldsToBody: true,
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB max
      files: 1 // 1 fichier à la fois
    }
  });
  
  // ✅ ROUTE : LISTE DES DOCUMENTS AVEC RESTRICTIONS PLAN (SUPABASE)
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

      // ✅ RÉCUPÉRER DOCUMENTS AVEC SUPABASE
      const { data: documents, error } = await supabaseServiceClient
        .from('knowledge_base')
        .select(`
          *,
          agent_knowledge_base!inner(
            agent!inner(
              id, name, isActive
            )
          )
        `)
        .eq('shopId', shop.id)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Erreur récupération documents:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération des documents'
        });
      }

      // ✅ OBTENIR LES LIMITES DU PLAN
      const planLimits = await checkPlanLimits(shop.id, shop.subscription_plan);

      const formattedDocuments = (documents || []).map((doc: any) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        contentType: doc.contentType,
        sourceFile: doc.sourceFile,
        sourceUrl: doc.sourceUrl,
        tags: Array.isArray(doc.tags) ? doc.tags : [],
        isActive: doc.isActive,
        metadata: doc.metadata || {},
        linkedAgents: doc.agent_knowledge_base ? doc.agent_knowledge_base.map((link: any) => link.agent) : [],
        createdAt: doc.created_at,
        updatedAt: doc.updated_at
      }));

      return {
        success: true,
        data: formattedDocuments,
        meta: {
          total: documents?.length || 0,
          activeCount: documents?.filter(doc => doc.isActive).length || 0,
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

  // ✅ NOUVELLE ROUTE : UPLOAD DE FICHIER (SUPABASE)
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

      // ✅ CRÉER LE DOCUMENT EN BASE AVEC SUPABASE
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
          shopId: shop.id,
          title: data.filename || 'Fichier uploadé',
          content: content,
          contentType: 'file',
          sourceFile: data.filename,
          sourceUrl: storageUrl,
          tags: ['fichier', 'upload'],
          isActive: true,
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
          contentType: newDocument.contentType,
          sourceFile: newDocument.sourceFile,
          sourceUrl: newDocument.sourceUrl,
          tags: newDocument.tags,
          isActive: newDocument.isActive,
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

  // ✅ NOUVELLE ROUTE : TRAITEMENT D'UN SITE WEB (SUPABASE)
  fastify.post('/website', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🌐 Traitement d\'un site web');
      
      const user = await verifySupabaseAuth(request);
      const { shop, canAccess, reason } = await getShopWithPlanCheck(user);
      const body = websiteProcessSchema.parse(request.body);

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

      // ✅ EXTRAIRE LE CONTENU DU SITE WEB
      const { title, content, metadata } = await extractContentFromUrl(body.url);

      const { data: newDocument, error } = await supabaseServiceClient
        .from('knowledge_base')
        .insert({
          shopId: shop.id,
          title: body.title || title,
          content: content,
          contentType: 'website',
          sourceFile: null,
          sourceUrl: body.url,
          tags: body.tags.length > 0 ? body.tags : ['website', 'automatique'],
          isActive: true,
          metadata: createSafeMetadata(metadata)
        })
        .select()
        .single();

      if (error) {
        console.error('Erreur création document website:', error);
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création du document'
        });
      }

      fastify.log.info(`✅ Site web traité et document créé: ${newDocument.id}`);

      return {
        success: true,
        data: {
          id: newDocument.id,
          title: newDocument.title,
          content: newDocument.content,
          contentType: newDocument.contentType,
          sourceFile: newDocument.sourceFile,
          sourceUrl: newDocument.sourceUrl,
          tags: newDocument.tags,
          isActive: newDocument.isActive,
          metadata: newDocument.metadata,
          createdAt: newDocument.created_at,
          updatedAt: newDocument.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Process website error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'URL invalide',
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
        error: 'Erreur lors du traitement du site web',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : CRÉER UN DOCUMENT MANUEL (SUPABASE)
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
          shopId: shop.id,
          title: body.title,
          content: body.content,
          contentType: body.contentType,
          sourceFile: body.sourceFile || null,
          sourceUrl: body.sourceUrl || null,
          tags: body.tags,
          isActive: body.isActive,
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
          contentType: newDocument.contentType,
          sourceFile: newDocument.sourceFile,
          sourceUrl: newDocument.sourceUrl,
          tags: newDocument.tags,
          isActive: newDocument.isActive,
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

  // ✅ ROUTE : EXTRAIRE CONTENU D'UNE URL (SUPABASE)
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
          shopId: shop.id,
          title: body.title || title,
          content: content,
          contentType: 'url',
          sourceFile: null,
          sourceUrl: body.url,
          tags: [],
          isActive: true,
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
          contentType: newDocument.contentType,
          sourceFile: newDocument.sourceFile,
          sourceUrl: newDocument.sourceUrl,
          tags: newDocument.tags,
          isActive: newDocument.isActive,
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

  // ✅ ROUTE : OBTENIR UN DOCUMENT (SUPABASE)
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
        .select(`
          *,
          agent_knowledge_base(
            agent(
              id, name, isActive
            )
          )
        `)
        .eq('id', id)
        .eq('shopId', shop.id)
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
          contentType: document.contentType,
          sourceFile: document.sourceFile,
          sourceUrl: document.sourceUrl,
          tags: document.tags,
          isActive: document.isActive,
          metadata: document.metadata,
          linkedAgents: document.agent_knowledge_base ? document.agent_knowledge_base.map((link: any) => link.agent) : [],
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

  // ✅ ROUTE : METTRE À JOUR UN DOCUMENT (SUPABASE)
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
        .eq('shopId', shop.id)
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
      if (body.isActive !== undefined) updateData.isActive = body.isActive;

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
          contentType: updatedDocument.contentType,
          sourceFile: updatedDocument.sourceFile,
          sourceUrl: updatedDocument.sourceUrl,
          tags: updatedDocument.tags,
          isActive: updatedDocument.isActive,
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

  // ✅ ROUTE : SUPPRIMER UN DOCUMENT (SUPABASE)
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
        .eq('shopId', shop.id)
        .single();

      if (fetchError || !existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document non trouvé' 
        });
      }

      // ✅ SUPPRIMER LE FICHIER DE SUPABASE STORAGE SI C'EST UN FICHIER
      if (existingDocument.contentType === 'file' && existingDocument.metadata) {
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

  // ✅ ROUTE : TOGGLE STATUT (SUPABASE)
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
        .eq('shopId', shop.id)
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
          isActive: body.isActive,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select('id, isActive, updated_at')
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
          isActive: updatedDocument.isActive,
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