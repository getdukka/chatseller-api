// src/routes/knowledge-base.ts - VERSION PRODUCTION CORRIGÉE SANS DÉPENDANCES COMPLEXES
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

// ✅ CONFIGURATION DES LIMITES PAR PLAN
const PLAN_LIMITS = {
  free: { documents: 10, fileSize: 5 * 1024 * 1024 }, // 5MB
  starter: { documents: 10, fileSize: 10 * 1024 * 1024 }, // 10MB
  pro: { documents: 50, fileSize: 25 * 1024 * 1024 }, // 25MB
  enterprise: { documents: -1, fileSize: 100 * 1024 * 1024 } // Illimité, 100MB par fichier
};

// ✅ INTERFACES COMPLÈTES
interface KnowledgeBaseDocument {
  id: string;
  shopId: string;
  title: string;
  content: string;
  contentType: 'manual' | 'file' | 'url' | 'website';
  sourceFile: string | null;
  sourceUrl: string | null;
  metadata: Prisma.JsonValue;
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  agents?: any[];
}

interface Shop {
  id: string;
  name: string;
  email: string;
  subscription_plan: string;
  is_active: boolean;
  createdAt: Date;
  trial_ends_at?: Date | null;
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
  [key: string]: any;
}

// ✅ CRÉER UNE INSTANCE PRISMA
let prisma: PrismaClient;

try {
  prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    }
  });
} catch (error) {
  console.error('❌ ERREUR lors de l\'initialisation de Prisma:', error);
  throw error;
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Token invalide');
  }
  
  return user;
}

// ✅ HELPER: Récupérer shop avec vérification plan et essai
async function getShopWithPlanCheck(user: any): Promise<{ shop: Shop; canAccess: boolean; reason?: string }> {
  try {
    await prisma.$connect();
    
    const shop = await prisma.shop.findUnique({
      where: { id: user.id }
    }) as Shop | null;

    if (!shop) {
      await prisma.$disconnect();
      return { shop: null as any, canAccess: false, reason: 'Shop non trouvé' };
    }

    // ✅ VÉRIFIER SI L'ESSAI GRATUIT EST EXPIRÉ
    const now = new Date();
    const isTrialExpired = shop.trial_ends_at && now > shop.trial_ends_at;
    const isPaidPlan = ['starter', 'pro', 'enterprise'].includes(shop.subscription_plan);

    if (isTrialExpired && !isPaidPlan) {
      await prisma.$disconnect();
      return { 
        shop, 
        canAccess: false, 
        reason: 'Essai gratuit expiré. Passez à un plan payant pour accéder à la base de connaissances.' 
      };
    }

    if (!shop.is_active) {
      await prisma.$disconnect();
      return { 
        shop, 
        canAccess: false, 
        reason: 'Compte désactivé' 
      };
    }

    await prisma.$disconnect();
    return { shop, canAccess: true };

  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}

// ✅ HELPER: Vérifier les limites du plan
async function checkPlanLimits(shopId: string, plan: string): Promise<{ 
  canAdd: boolean; 
  currentCount: number; 
  limit: number; 
  reason?: string 
}> {
  const planConfig = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;
  
  await prisma.$connect();
  
  const currentCount = await prisma.knowledgeBase.count({
    where: { shopId }
  });
  
  await prisma.$disconnect();

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

// ✅ HELPER: Extraire contenu d'une URL (VERSION SIMPLIFIÉE)
async function extractContentFromUrl(url: string): Promise<{ title: string; content: string; metadata: SafeMetadata }> {
  try {
    // Version simplifiée - en production, utiliser un service robuste
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Extraction basique du titre
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Document extrait';
    
    // Extraction basique du contenu
    const contentMatch = html
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<style[^>]*>.*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 5000);
    
    const metadata: SafeMetadata = {
      extractedAt: new Date().toISOString(),
      sourceUrl: url,
      wordCount: contentMatch.split(' ').length,
      extractionMethod: 'basic'
    };
    
    return { title, content: contentMatch, metadata };
    
  } catch (error: any) {
    throw new Error(`Erreur lors de l'extraction du contenu: ${error.message}`);
  }
}

// ✅ HELPER: Créer métadonnées sécurisées
function createSafeMetadata(base: SafeMetadata = {}): Prisma.InputJsonObject {
  return {
    ...base,
    createdAt: new Date().toISOString()
  } as Prisma.InputJsonObject;
}

// ✅ HELPER: Merger métadonnées existantes
function mergeSafeMetadata(existing: Prisma.JsonValue, updates: SafeMetadata): Prisma.InputJsonObject {
  const existingMeta = (existing as SafeMetadata) || {};
  return {
    ...existingMeta,
    ...updates,
    lastModified: new Date().toISOString()
  } as Prisma.InputJsonObject;
}

export default async function knowledgeBaseRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE : LISTE DES DOCUMENTS AVEC RESTRICTIONS PLAN
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

      await prisma.$connect();
      
      const documents = await prisma.knowledgeBase.findMany({
        where: { shopId: shop.id },
        include: {
          agents: {
            include: {
              agent: {
                select: {
                  id: true,
                  name: true,
                  isActive: true
                }
              }
            }
          }
        },
        orderBy: { updatedAt: 'desc' }
      });

      await prisma.$disconnect();

      // ✅ OBTENIR LES LIMITES DU PLAN
      const planLimits = await checkPlanLimits(shop.id, shop.subscription_plan);

      const formattedDocuments = documents.map((doc: any) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        contentType: doc.contentType,
        sourceFile: doc.sourceFile,
        sourceUrl: doc.sourceUrl,
        tags: Array.isArray(doc.tags) ? doc.tags : [],
        isActive: doc.isActive,
        metadata: doc.metadata || {},
        linkedAgents: doc.agents ? doc.agents.map((link: any) => link.agent) : [],
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString()
      }));

      return {
        success: true,
        data: formattedDocuments,
        meta: {
          total: documents.length,
          activeCount: documents.filter(doc => doc.isActive).length,
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

  // ✅ ROUTE : CRÉER UN DOCUMENT MANUEL
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

      await prisma.$connect();

      const metadata = createSafeMetadata({
        wordCount: body.content.split(' ').length,
        createdManually: true,
        contentType: body.contentType
      });

      const newDocument = await prisma.knowledgeBase.create({
        data: {
          shopId: shop.id,
          title: body.title,
          content: body.content,
          contentType: body.contentType,
          sourceFile: body.sourceFile || null,
          sourceUrl: body.sourceUrl || null,
          tags: body.tags,
          isActive: body.isActive,
          metadata: metadata
        },
        include: {
          agents: {
            include: {
              agent: {
                select: {
                  id: true,
                  name: true,
                  isActive: true
                }
              }
            }
          }
        }
      });

      await prisma.$disconnect();

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
          createdAt: newDocument.createdAt.toISOString(),
          updatedAt: newDocument.updatedAt.toISOString()
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

  // ✅ ROUTE : EXTRAIRE CONTENU D'UNE URL
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

      await prisma.$connect();

      const newDocument = await prisma.knowledgeBase.create({
        data: {
          shopId: shop.id,
          title: body.title || title,
          content: content,
          contentType: 'url',
          sourceFile: null,
          sourceUrl: body.url,
          tags: [],
          isActive: true,
          metadata: createSafeMetadata(metadata)
        }
      });

      await prisma.$disconnect();

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
          createdAt: newDocument.createdAt.toISOString(),
          updatedAt: newDocument.updatedAt.toISOString()
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

  // ✅ ROUTE : OBTENIR UN DOCUMENT
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

      await prisma.$connect();

      const document = await prisma.knowledgeBase.findFirst({
        where: { 
          id,
          shopId: shop.id 
        },
        include: {
          agents: {
            include: {
              agent: {
                select: {
                  id: true,
                  name: true,
                  isActive: true
                }
              }
            }
          }
        }
      });

      if (!document) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document non trouvé' 
        });
      }

      await prisma.$disconnect();

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
          linkedAgents: document.agents ? document.agents.map((link: any) => link.agent) : [],
          createdAt: document.createdAt.toISOString(),
          updatedAt: document.updatedAt.toISOString()
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

  // ✅ ROUTE : METTRE À JOUR UN DOCUMENT
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

      await prisma.$connect();

      const existingDocument = await prisma.knowledgeBase.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document non trouvé' 
        });
      }

      const updateData: any = {
        updatedAt: new Date()
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

      const updatedDocument = await prisma.knowledgeBase.update({
        where: { id },
        data: updateData
      });

      await prisma.$disconnect();

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
          createdAt: updatedDocument.createdAt.toISOString(),
          updatedAt: updatedDocument.updatedAt.toISOString()
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

  // ✅ ROUTE : SUPPRIMER UN DOCUMENT
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

      await prisma.$connect();

      const existingDocument = await prisma.knowledgeBase.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document non trouvé' 
        });
      }

      await prisma.knowledgeBase.delete({
        where: { id }
      });

      await prisma.$disconnect();

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

  // ✅ ROUTE : TOGGLE STATUT
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

      await prisma.$connect();

      const existingDocument = await prisma.knowledgeBase.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingDocument) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Document non trouvé' 
        });
      }

      const updatedDocument = await prisma.knowledgeBase.update({
        where: { id },
        data: { 
          isActive: body.isActive,
          updatedAt: new Date()
        }
      });

      await prisma.$disconnect();

      fastify.log.info(`✅ Statut document KB modifié: ${id} -> ${body.isActive ? 'actif' : 'inactif'}`);

      return {
        success: true,
        data: {
          id: updatedDocument.id,
          isActive: updatedDocument.isActive,
          updatedAt: updatedDocument.updatedAt.toISOString()
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