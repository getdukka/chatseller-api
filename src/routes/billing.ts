// src/routes/billing.ts - VERSION DIAGNOSTIC PRISMA
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const prisma = new PrismaClient();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ✅ VERSION STRIPE CORRIGÉE
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil'
});

// ✅ CONFIGURATION DES PLANS
const STRIPE_PLANS = {
  starter: {
    name: 'Starter',
    price: 0,
    stripePriceId: null,
    features: ['3 jours gratuit', '1 agent IA', '10 documents'],
    limits: { conversations: 100, agents: 1, documents: 10 }
  },
  professional: {
    name: 'Professional', 
    price: 1400, // 14€ en centimes
    stripePriceId: process.env.STRIPE_PRICE_ID_PRO!,
    features: ['Conversations illimitées', '3 agents IA', 'Base illimitée'],
    limits: { conversations: -1, agents: 3, documents: -1 }
  },
  enterprise: {
    name: 'Enterprise',
    price: 0,
    stripePriceId: null,
    features: ['Tout du Pro', 'Agents illimités', 'White-label'],
    limits: { conversations: -1, agents: -1, documents: -1 }
  }
};

// ✅ SCHÉMAS DE VALIDATION
const createSubscriptionSchema = z.object({
  plan: z.enum(['professional']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

// ✅ HELPER: Vérifier l'auth Supabase
async function verifySupabaseAuth(request: any) {
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

// ✅ FONCTION DE DIAGNOSTIC PRISMA ULTRA-DÉTAILLÉE
async function diagnosticPrismaConnection(fastify: FastifyInstance) {
  fastify.log.info('🔗 === DIAGNOSTIC PRISMA CONNECTION ===');
  
  // 1. Vérifier les variables d'environnement
  fastify.log.info('📋 Variables d\'environnement:');
  fastify.log.info(`DATABASE_URL présent: ${process.env.DATABASE_URL ? 'OUI' : 'NON'}`);
  
  if (process.env.DATABASE_URL) {
    // Masquer le password pour les logs
    const dbUrl = process.env.DATABASE_URL;
    const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':***@');
    fastify.log.info(`DATABASE_URL: ${maskedUrl}`);
  }

  // 2. Test de connexion basique
  try {
    fastify.log.info('🔌 Test connexion basique...');
    const result = await prisma.$queryRaw`SELECT 1 as test, NOW() as current_time`;
    fastify.log.info('✅ Connexion basique réussie:', result);
  } catch (error: any) {
    fastify.log.error('❌ ERREUR connexion basique:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    return { success: false, error: 'Connexion basique échoue', details: error };
  }

  // 3. Test de lecture de la table shops
  try {
    fastify.log.info('📊 Test lecture table shops...');
    const shopCount = await prisma.shop.count();
    fastify.log.info(`✅ Nombre de shops: ${shopCount}`);
    
    // Lister les shops existants
    const shops = await prisma.shop.findMany({
      select: { id: true, name: true, email: true, subscription_plan: true }
    });
    fastify.log.info('📋 Shops existants:', shops);
    
  } catch (error: any) {
    fastify.log.error('❌ ERREUR lecture table shops:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    return { success: false, error: 'Lecture table shops échoue', details: error };
  }

  // 4. Test de création simple
  try {
    fastify.log.info('🧪 Test création temporaire...');
    const testId = 'test-' + Date.now();
    const testEmail = 'test-' + Date.now() + '@example.com';
    
    const testShop = await prisma.shop.create({
      data: {
        id: testId,
        name: 'Test Shop',
        email: testEmail,
        subscription_plan: 'free',
        is_active: true
      }
    });
    
    fastify.log.info('✅ Création test réussie:', testShop.id);
    
    // Supprimer le shop de test
    await prisma.shop.delete({ where: { id: testId } });
    fastify.log.info('✅ Suppression test réussie');
    
  } catch (error: any) {
    fastify.log.error('❌ ERREUR création/suppression test:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    return { success: false, error: 'Test création échoue', details: error };
  }

  fastify.log.info('🎉 === DIAGNOSTIC PRISMA COMPLET : TOUT OK ===');
  return { success: true };
}

// ✅ NOUVELLE FONCTION: Créer ou récupérer un shop (VERSION SIMPLIFIÉE)
async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  fastify.log.info(`🔍 Recherche du shop pour l'utilisateur: ${user.id} (${user.email})`);
  
  try {
    // 0. Diagnostic Prisma complet
    const diagnostic = await diagnosticPrismaConnection(fastify);
    if (!diagnostic.success) {
      throw new Error(`Diagnostic Prisma échoue: ${diagnostic.error}`);
    }

    // 1. Chercher d'abord par ID utilisateur
    fastify.log.info(`🔍 Recherche par ID: ${user.id}`);
    
    let shop = await prisma.shop.findUnique({
      where: { id: user.id }
    });

    if (shop) {
      fastify.log.info(`✅ Shop trouvé par ID: ${shop.id} - ${shop.name}`);
      return shop;
    }

    // 2. Chercher par email
    fastify.log.info(`🔍 Recherche par email: ${user.email}`);
    
    shop = await prisma.shop.findUnique({
      where: { email: user.email }
    });

    if (shop) {
      fastify.log.info(`✅ Shop trouvé par email: ${shop.id} - ${shop.name}`);
      return shop;
    }

    // 3. Créer automatiquement le shop
    fastify.log.info(`🏗️ Création automatique du shop`);
    
    const shopData = {
      id: user.id,
      name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Boutique',
      email: user.email,
      subscription_plan: 'free' as const,
      is_active: true,
      widget_config: {
        theme: "modern",
        language: "fr", 
        position: "bottom-right",
        buttonText: "Parler au vendeur",
        primaryColor: "#3B82F6"
      },
      agent_config: {
        name: "Assistant ChatSeller",
        avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
        upsellEnabled: false,
        welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
        collectPaymentMethod: true
      }
    };

    fastify.log.info(`📝 Données shop à créer:`, shopData);

    const newShop = await prisma.shop.create({
      data: shopData
    });

    fastify.log.info(`✅ Shop créé avec succès: ${newShop.id} - ${newShop.name}`);
    return newShop;

  } catch (error: any) {
    fastify.log.error('❌ ERREUR GLOBALE dans getOrCreateShop:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack,
      userId: user.id,
      userEmail: user.email
    });
    throw new Error(`Impossible de créer ou récupérer le shop: ${error.message}`);
  }
}

export default async function billingRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE DE TEST PRISMA
  fastify.get('/test-prisma', async (request, reply) => {
    try {
      const diagnostic = await diagnosticPrismaConnection(fastify);
      return { success: true, diagnostic };
    } catch (error: any) {
      fastify.log.error('❌ Test Prisma error:', error);
      return reply.status(500).send({ 
        error: 'Erreur test Prisma', 
        details: error.message 
      });
    }
  });

  // ✅ ROUTE : OBTENIR LES PLANS DISPONIBLES (PUBLIC)
  fastify.get('/plans', async (request, reply) => {
    try {
      const plans = Object.entries(STRIPE_PLANS).map(([key, plan]) => ({
        id: key,
        name: plan.name,
        price: plan.price,
        priceFormatted: plan.price === 0 ? 'Gratuit' : `${plan.price / 100}€`,
        features: plan.features,
        limits: plan.limits
      }));

      return { success: true, plans };
    } catch (error) {
      fastify.log.error('Get plans error:', error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération des plans' });
    }
  });

  // ✅ ROUTE : CRÉER UNE SESSION DE CHECKOUT STRIPE (VERSION SIMPLIFIÉE)
  fastify.post('/create-checkout-session', async (request, reply) => {
    try {
      fastify.log.info('🚀 Début création session checkout');
      
      const body = createSubscriptionSchema.parse(request.body);
      const user = await verifySupabaseAuth(request);
      
      fastify.log.info(`👤 Utilisateur authentifié: ${user.id} (${user.email})`);
      
      // ✅ UTILISER LA NOUVELLE FONCTION
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(500).send({ error: 'Erreur lors de la récupération du shop' });
      }

      // ✅ VÉRIFIER SI DÉJÀ ABONNÉ
      if (shop.subscription_plan === 'professional') {
        return reply.status(400).send({ error: 'Vous avez déjà un abonnement actif' });
      }

      const plan = STRIPE_PLANS[body.plan];
      if (!plan.stripePriceId) {
        return reply.status(400).send({ error: 'Plan non disponible pour l\'achat' });
      }

      // ✅ CRÉER CUSTOMER STRIPE
      let customer;
      const existingCustomers = await stripe.customers.list({
        email: shop.email,
        limit: 1
      });

      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
      } else {
        customer = await stripe.customers.create({
          email: shop.email,
          name: shop.name,
          metadata: {
            userId: shop.id,
            shopName: shop.name
          }
        });
      }

      // ✅ CRÉER SESSION CHECKOUT
      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        payment_method_types: ['card'],
        line_items: [
          {
            price: plan.stripePriceId,
            quantity: 1,
          },
        ],
        mode: 'subscription' as const,
        success_url: body.successUrl,
        cancel_url: body.cancelUrl,
        metadata: {
          userId: shop.id,
          plan: body.plan,
          shopEmail: shop.email
        },
        subscription_data: {
          metadata: {
            userId: shop.id,
            plan: body.plan,
            shopEmail: shop.email
          }
        }
      });

      fastify.log.info(`✅ Session checkout créée: ${session.id}`);

      return { 
        success: true, 
        checkoutUrl: session.url,
        sessionId: session.id 
      };

    } catch (error: any) {
      fastify.log.error('❌ Create checkout session error:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        name: error.name
      });
      
      return reply.status(500).send({
        error: 'Erreur lors de la création de la session de paiement',
        details: error.message
      });
    }
  });

  // ✅ ROUTE : OBTENIR LE STATUT DE L'ABONNEMENT
  fastify.get('/subscription-status', async (request, reply) => {
    try {
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      return {
        success: true,
        subscription: {
          plan: shop.subscription_plan,
          status: shop.is_active ? 'active' : 'inactive',
          isActive: shop.is_active,
          shopId: shop.id,
          shopName: shop.name
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get subscription status error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({ 
        error: 'Erreur lors de la récupération du statut',
        details: error.message
      });
    }
  });

  // ✅ WEBHOOK STRIPE (SIMPLIFIÉ)
  fastify.post('/webhook', async (request, reply) => {
    try {
      const signature = request.headers['stripe-signature'] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(
          request.body as string,
          signature,
          webhookSecret
        );
      } catch (err: any) {
        fastify.log.error('❌ Webhook signature verification failed:', err.message);
        return reply.status(400).send({ error: 'Webhook signature verification failed' });
      }

      fastify.log.info(`📧 Stripe webhook reçu: ${event.type}`);

      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, fastify);
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionCanceled(event.data.object as Stripe.Subscription, fastify);
          break;

        default:
          fastify.log.info(`ℹ️ Unhandled event type: ${event.type}`);
      }

      return { received: true };

    } catch (error) {
      fastify.log.error('❌ Webhook processing error:', error);
      return reply.status(500).send({ error: 'Erreur lors du traitement du webhook' });
    }
  });

  // ✅ FONCTIONS WEBHOOK
  async function handleCheckoutCompleted(session: Stripe.Checkout.Session, fastify: FastifyInstance) {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;

    if (!userId || !plan) {
      fastify.log.error('❌ Missing metadata in checkout session:', { userId, plan });
      return;
    }

    try {
      await prisma.shop.update({
        where: { id: userId },
        data: {
          subscription_plan: plan,
          is_active: true,
          updatedAt: new Date()
        }
      });

      fastify.log.info(`✅ Subscription activated for user ${userId}, plan: ${plan}`);
    } catch (error) {
      fastify.log.error('❌ Error updating shop subscription:', error);
    }
  }

  async function handleSubscriptionCanceled(subscription: Stripe.Subscription, fastify: FastifyInstance) {
    const userId = subscription.metadata?.userId;

    if (!userId) {
      fastify.log.error('❌ Missing userId in subscription metadata');
      return;
    }

    try {
      await prisma.shop.update({
        where: { id: userId },
        data: {
          subscription_plan: 'free',
          is_active: false,
          updatedAt: new Date()
        }
      });

      fastify.log.info(`✅ Subscription canceled for user ${userId}`);
    } catch (error) {
      fastify.log.error('❌ Error canceling shop subscription:', error);
    }
  }
}