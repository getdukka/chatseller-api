// src/routes/billing.ts - VERSION CORRIGÉE AVEC AUTO-CRÉATION SHOP
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

// ✅ NOUVELLE FONCTION: Créer ou récupérer un shop
async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  fastify.log.info(`🔍 Recherche du shop pour l'utilisateur: ${user.id} (${user.email})`);
  
  try {
    // 1. Chercher d'abord par ID utilisateur
    let shop = await prisma.shop.findUnique({
      where: { id: user.id }
    });

    if (shop) {
      fastify.log.info(`✅ Shop trouvé par ID: ${shop.id}`);
      return shop;
    }

    // 2. Chercher par email
    shop = await prisma.shop.findUnique({
      where: { email: user.email }
    });

    if (shop) {
      fastify.log.info(`✅ Shop trouvé par email: ${shop.id}`);
      return shop;
    }

    // 3. Créer automatiquement le shop si il n'existe pas
    fastify.log.info(`🏗️ Création automatique du shop pour: ${user.email}`);
    
    const newShop = await prisma.shop.create({
      data: {
        id: user.id,
        name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Boutique',
        email: user.email,
        subscription_plan: 'free',
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
      }
    });

    fastify.log.info(`✅ Shop créé avec succès: ${newShop.id}`);
    return newShop;

  } catch (error) {
    fastify.log.error('❌ Erreur lors de la création/récupération du shop:', error);
    throw new Error('Impossible de créer ou récupérer le shop');
  }
}

export default async function billingRoutes(fastify: FastifyInstance) {
  
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

  // ✅ ROUTE : CRÉER UNE SESSION DE CHECKOUT STRIPE (CORRIGÉE)
  fastify.post('/create-checkout-session', async (request, reply) => {
    try {
      fastify.log.info('🚀 Début création session checkout');
      
      const body = createSubscriptionSchema.parse(request.body);
      const user = await verifySupabaseAuth(request);
      
      fastify.log.info(`👤 Utilisateur authentifié: ${user.id} (${user.email})`);
      
      // ✅ UTILISER LA NOUVELLE FONCTION CORRIGÉE
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        fastify.log.error('❌ Impossible de créer ou récupérer le shop');
        return reply.status(500).send({ error: 'Erreur lors de la récupération du shop' });
      }

      // ✅ VÉRIFIER SI DÉJÀ ABONNÉ
      if (shop.subscription_plan === 'professional') {
        fastify.log.info(`ℹ️ Utilisateur déjà abonné au plan: ${shop.subscription_plan}`);
        return reply.status(400).send({ error: 'Vous avez déjà un abonnement actif' });
      }

      const plan = STRIPE_PLANS[body.plan];
      if (!plan.stripePriceId) {
        fastify.log.error(`❌ Plan non disponible pour l'achat: ${body.plan}`);
        return reply.status(400).send({ error: 'Plan non disponible pour l\'achat' });
      }

      fastify.log.info(`💳 Création session Stripe pour le plan: ${body.plan} (${plan.stripePriceId})`);

      // ✅ CRÉER OU RÉCUPÉRER LE CUSTOMER STRIPE
      let customer;
      
      // Chercher si le customer existe déjà
      const existingCustomers = await stripe.customers.list({
        email: shop.email,
        limit: 1
      });

      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
        fastify.log.info(`✅ Customer Stripe existant trouvé: ${customer.id}`);
      } else {
        customer = await stripe.customers.create({
          email: shop.email,
          name: shop.name,
          metadata: {
            userId: shop.id,
            shopName: shop.name
          }
        });
        fastify.log.info(`✅ Nouveau customer Stripe créé: ${customer.id}`);
      }

      // ✅ CRÉER LA SESSION DE CHECKOUT
      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        payment_method_types: ['card'],
        line_items: [
          {
            price: plan.stripePriceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
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

      fastify.log.info(`✅ Session checkout créée avec succès: ${session.id}`);
      fastify.log.info(`🔗 URL de redirection: ${session.url}`);

      return { 
        success: true, 
        checkoutUrl: session.url,
        sessionId: session.id 
      };

    } catch (error: any) {
      fastify.log.error('❌ Create checkout session error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la création de la session de paiement',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : OBTENIR LE STATUT DE L'ABONNEMENT (CORRIGÉE)
  fastify.get('/subscription-status', async (request, reply) => {
    try {
      fastify.log.info('🔍 Récupération statut abonnement');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        fastify.log.error('❌ Shop non trouvé pour le statut');
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      fastify.log.info(`✅ Statut récupéré - Plan: ${shop.subscription_plan}, Actif: ${shop.is_active}`);

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
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ WEBHOOK STRIPE (CORRIGÉ)
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

        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, fastify);
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

  // ✅ FONCTIONS WEBHOOK CORRIGÉES
  async function handleCheckoutCompleted(session: Stripe.Checkout.Session, fastify: FastifyInstance) {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;

    if (!userId || !plan) {
      fastify.log.error('❌ Missing metadata in checkout session:', { userId, plan });
      return;
    }

    try {
      // ✅ METTRE À JOUR LE SHOP AVEC LE PLAN PAYÉ
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
      // ✅ REMETTRE LE SHOP EN PLAN GRATUIT
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

  async function handleSubscriptionUpdated(subscription: Stripe.Subscription, fastify: FastifyInstance) {
    const userId = subscription.metadata?.userId;

    if (!userId) {
      fastify.log.error('❌ Missing userId in subscription metadata');
      return;
    }

    try {
      const isActive = subscription.status === 'active';
      
      await prisma.shop.update({
        where: { id: userId },
        data: {
          is_active: isActive,
          updatedAt: new Date()
        }
      });

      fastify.log.info(`✅ Subscription updated for user ${userId}, status: ${subscription.status}`);
    } catch (error) {
      fastify.log.error('❌ Error updating shop subscription:', error);
    }
  }
}