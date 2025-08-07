// src/middleware/auth.ts (REMPLACER LE CONTENU)
import { FastifyRequest, FastifyReply } from 'fastify'
import { supabaseAuthClient } from '../lib/supabase'

// ✅ INTERFACE USER AUTHENTIFIÉ
interface AuthenticatedUser {
  id: string
  email?: string
  shopId: string
  [key: string]: any
}

// ✅ EXTENSION FASTIFY REQUEST
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser
  }
}

// ✅ MIDDLEWARE D'AUTHENTIFICATION CORRIGÉ
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ [AUTH] Token manquant ou format incorrect')
      return reply.status(401).send({
        success: false,
        error: 'Token d\'authentification manquant'
      })
    }

    const token = authHeader.replace('Bearer ', '')

    // ✅ VALIDER LE TOKEN AVEC SUPABASE
    const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token)
    
    if (error || !user) {
      console.log('❌ [AUTH] Token invalide:', error?.message)
      return reply.status(401).send({
        success: false,
        error: 'Token d\'authentification invalide'
      })
    }

    // ✅ AJOUTER L'UTILISATEUR À LA REQUÊTE
    request.user = {
      id: user.id,
      email: user.email,
      shopId: user.id, // Dans ChatSeller, shopId = userId
      ...user.user_metadata
    }

    console.log('✅ [AUTH] Utilisateur authentifié:', user.email)

  } catch (error: any) {
    console.error('❌ [AUTH] Erreur authentification:', error)
    return reply.status(401).send({
      success: false,
      error: 'Erreur d\'authentification'
    })
  }
}

// ✅ MIDDLEWARE OPTIONNEL (pour routes publiques avec auth facultative)
export async function optionalAuthenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Pas d'auth requise, continuer sans utilisateur
      return
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token)
    
    if (!error && user) {
      request.user = {
        id: user.id,
        email: user.email,
        shopId: user.id,
        ...user.user_metadata
      }
      console.log('✅ [AUTH] Utilisateur authentifié (optionnel):', user.email)
    }

  } catch (error) {
    console.warn('⚠️ [AUTH] Erreur auth optionnelle (ignorée):', error)
    // Ignorer les erreurs pour l'auth optionnelle
  }
}