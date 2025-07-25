// src/routes/billing.ts - VERSION CORRIGÉE
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
      const body = createSubscriptionSchema.parse(request.body);
      const user = await verifySupabaseAuth(request);
      
      // ✅ UTILISER LE CHAMP CORRECT DU SCHÉMA PRISMA
      const shop = await prisma.shop.findUnique({
        where: { id: user.id }
      });

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      // ✅ UTILISER subscription_plan (snake_case comme dans le schéma)
      if (shop.subscription_plan === 'professional') {
        return reply.status(400).send({ error: 'Vous avez déjà un abonnement actif' });
      }

      const plan = STRIPE_PLANS[body.plan];
      if (!plan.stripePriceId) {
        return reply.status(400).send({ error: 'Plan non disponible pour l\'achat' });
      }

      // ✅ CRÉER TOUJOURS UN NOUVEAU CUSTOMER (simplifié)
      const customer = await stripe.customers.create({
        email: shop.email,
        name: shop.name,
        metadata: {
          userId: shop.id,
          shopName: shop.name
        }
      });

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
          plan: body.plan
        },
        subscription_data: {
          metadata: {
            userId: shop.id,
            plan: body.plan
          }
        }
      });

      return { 
        success: true, 
        checkoutUrl: session.url,
        sessionId: session.id 
      };

    } catch (error: any) {
      fastify.log.error('Create checkout session error:', error);
      
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
        error: 'Erreur lors de la création de la session de paiement'
      });
    }
  });

  // ✅ ROUTE : OBTENIR LE STATUT DE L'ABONNEMENT (CORRIGÉE)
  fastify.get('/subscription-status', async (request, reply) => {
    try {
      const user = await verifySupabaseAuth(request);

      const shop = await prisma.shop.findUnique({
        where: { id: user.id }
      });

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      // ✅ UTILISER LES CHAMPS CORRECTS DU SCHÉMA
      return {
        success: true,
        subscription: {
          plan: shop.subscription_plan, // ✅ snake_case
          status: shop.is_active ? 'active' : 'inactive', // ✅ snake_case
          isActive: shop.is_active,
          stripeSubscription: null
        }
      };

    } catch (error: any) {
      fastify.log.error('Get subscription status error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({ error: 'Erreur lors de la récupération du statut' });
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
        fastify.log.error('Webhook signature verification failed:', err.message);
        return reply.status(400).send({ error: 'Webhook signature verification failed' });
      }

      fastify.log.info('Stripe webhook received:', event.type);

      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionCanceled(event.data.object as Stripe.Subscription);
          break;

        default:
          fastify.log.info('Unhandled event type:', event.type);
      }

      return { received: true };

    } catch (error) {
      fastify.log.error('Webhook processing error:', error);
      return reply.status(500).send({ error: 'Erreur lors du traitement du webhook' });
    }
  });

  // ✅ FONCTIONS WEBHOOK CORRIGÉES
  async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;

    if (!userId || !plan) {
      fastify.log.error('Missing metadata in checkout session');
      return;
    }

    // ✅ UTILISER LES CHAMPS CORRECTS
    await prisma.shop.update({
      where: { id: userId },
      data: {
        subscription_plan: plan, // ✅ snake_case
        is_active: true, // ✅ snake_case
        updatedAt: new Date()
      }
    });

    fastify.log.info(`Subscription activated for user ${userId}, plan: ${plan}`);
  }

  async function handleSubscriptionCanceled(subscription: Stripe.Subscription) {
    const userId = subscription.metadata?.userId;

    if (!userId) {
      fastify.log.error('Missing userId in subscription metadata');
      return;
    }

    // ✅ REMETTRE LE SHOP EN PLAN GRATUIT AVEC CHAMPS CORRECTS
    await prisma.shop.update({
      where: { id: userId },
      data: {
        subscription_plan: 'free', // ✅ snake_case
        is_active: false, // ✅ snake_case
        updatedAt: new Date()
      }
    });

    fastify.log.info(`Subscription canceled for user ${userId}`);
  }
}