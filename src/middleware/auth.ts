// src/middleware/auth.ts
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

// ✅ MIDDLEWARE D'AUTHENTIFICATION SUPABASE SEULEMENT
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization
    
    if (!authHeader) {
      console.log('❌ [AUTH] Aucun header Authorization')
      return reply.status(401).send({
        success: false,
        error: 'Token d\'authentification manquant',
        code: 'MISSING_AUTH_HEADER'
      })
    }
    
    if (!authHeader.startsWith('Bearer ')) {
      console.log('❌ [AUTH] Format Authorization invalide')
      return reply.status(401).send({
        success: false,
        error: 'Format de token invalide',
        code: 'INVALID_AUTH_FORMAT'
      })
    }

    const token = authHeader.replace('Bearer ', '').trim()
    
    if (!token || token.length < 10) {
      console.log('❌ [AUTH] Token vide ou trop court')
      return reply.status(401).send({
        success: false,
        error: 'Token invalide',
        code: 'INVALID_TOKEN'
      })
    }

    // ✅ VALIDER LE TOKEN AVEC SUPABASE + TIMEOUT
    const authPromise = supabaseAuthClient.auth.getUser(token)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Auth timeout')), 10000)
    )
    
    const { data: { user }, error } = await Promise.race([
      authPromise,
      timeoutPromise
    ]) as any
    
    if (error) {
      console.log('❌ [AUTH] Erreur Supabase:', error.message)
      return reply.status(401).send({
        success: false,
        error: 'Token d\'authentification invalide',
        code: 'SUPABASE_AUTH_ERROR',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    }
    
    if (!user) {
      console.log('❌ [AUTH] Aucun utilisateur trouvé')
      return reply.status(401).send({
        success: false,
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      })
    }

    if (!user.email) {
      console.log('❌ [AUTH] Email utilisateur manquant')
      return reply.status(401).send({
        success: false,
        error: 'Données utilisateur incomplètes',
        code: 'INCOMPLETE_USER_DATA'
      })
    }

    // ✅ AJOUTER L'UTILISATEUR À LA REQUÊTE
    request.user = {
      id: user.id,
      email: user.email,
      shopId: user.id, // Dans ChatSeller, shopId = userId
      role: user.role || 'user',
      ...user.user_metadata
    }

    console.log('✅ [AUTH] Utilisateur authentifié:', user.email)

  } catch (error: any) {
    console.error('❌ [AUTH] Erreur inattendue:', error)
    
    if (error.message === 'Auth timeout') {
      return reply.status(408).send({
        success: false,
        error: 'Timeout d\'authentification',
        code: 'AUTH_TIMEOUT'
      })
    }
    
    return reply.status(500).send({
      success: false,
      error: 'Erreur interne d\'authentification',
      code: 'INTERNAL_AUTH_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}

// ✅ MIDDLEWARE OPTIONNEL SUPABASE SEULEMENT
export async function optionalAuthenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return
    }

    const token = authHeader.replace('Bearer ', '').trim()
    
    if (!token || token.length < 10) {
      return
    }

    try {
      const authPromise = supabaseAuthClient.auth.getUser(token)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Auth timeout')), 5000)
      )
      
      const { data: { user }, error } = await Promise.race([
        authPromise,
        timeoutPromise
      ]) as any
      
      if (!error && user && user.email) {
        request.user = {
          id: user.id,
          email: user.email,
          shopId: user.id,
          role: user.role || 'user',
          ...user.user_metadata
        }
        console.log('✅ [AUTH] Utilisateur authentifié (optionnel):', user.email)
      }
    } catch (authError) {
      console.warn('⚠️ [AUTH] Erreur auth optionnelle (ignorée):', authError)
    }

  } catch (error: any) {
    console.warn('⚠️ [AUTH] Erreur middleware optionnel (ignorée):', error.message)
  }
}

// ✅ HELPER : Vérifier si l'utilisateur est admin
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.status(401).send({
      success: false,
      error: 'Authentification requise',
      code: 'AUTHENTICATION_REQUIRED'
    })
    return
  }
  
  if (request.user.role !== 'admin') {
    await reply.status(403).send({
      success: false,
      error: 'Droits administrateur requis',
      code: 'ADMIN_REQUIRED'
    })
    return
  }
}

// ✅ HELPER : Vérifier si l'utilisateur possède un shop
export async function requireShopOwner(request: FastifyRequest, reply: FastifyReply, shopId: string): Promise<void> {
  if (!request.user) {
    await reply.status(401).send({
      success: false,
      error: 'Authentification requise',
      code: 'AUTHENTICATION_REQUIRED'
    })
    return
  }
  
  if (request.user.shopId !== shopId && request.user.role !== 'admin') {
    await reply.status(403).send({
      success: false,
      error: 'Accès non autorisé à cette boutique',
      code: 'SHOP_ACCESS_DENIED'
    })
    return
  }
}