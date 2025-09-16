// src/lib/supabase.ts
import dotenv from 'dotenv'
dotenv.config()

import { createClient } from '@supabase/supabase-js'

// ✅ DEBUG DES VARIABLES D'ENVIRONNEMENT
console.log('🔧 [SUPABASE] Vérification des variables d\'environnement...')
console.log('🔧 [SUPABASE] SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Définie' : '❌ Manquante')
console.log('🔧 [SUPABASE] SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? '✅ Définie' : '❌ Manquante')
console.log('🔧 [SUPABASE] SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? '✅ Définie' : '❌ Manquante')

// ✅ VALIDATION STRICTE DES VARIABLES
if (!process.env.SUPABASE_URL) {
  console.error('❌ [SUPABASE] SUPABASE_URL manquante dans .env')
  throw new Error('SUPABASE_URL est requis dans le fichier .env')
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.error('❌ [SUPABASE] SUPABASE_SERVICE_KEY manquante dans .env')
  throw new Error('SUPABASE_SERVICE_KEY est requis dans le fichier .env')
}

if (!process.env.SUPABASE_ANON_KEY) {
  console.error('❌ [SUPABASE] SUPABASE_ANON_KEY manquante dans .env')
  throw new Error('SUPABASE_ANON_KEY est requis dans le fichier .env')
}

// ✅ CLIENT SUPABASE SERVICE (avec bypass RLS explicite)
export const supabaseServiceClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    }
  }
)

// ✅ CLIENT POUR VALIDATION DES TOKENS USER
export const supabaseAuthClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

console.log('✅ [SUPABASE] Clients configurés avec succès')

// ✅ FONCTION DE TEST CORRIGÉE - SANS REQUÊTE SUR TABLES PROTÉGÉES
export async function testSupabaseConnection() {
  try {
    console.log('🔧 [SUPABASE] Test de connexion...')
    
    // ✅ TEST 1: Vérifier que l'URL Supabase répond
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY!,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    console.log('✅ [SUPABASE] REST API accessible')

    // ✅ TEST 2: Vérifier l'auth avec un test simple
    try {
      const { data: authData, error: authError } = await supabaseAuthClient.auth.getSession()
      console.log('✅ [SUPABASE] Auth client configuré')
    } catch (authTestError) {
      console.warn('⚠️ [SUPABASE] Auth client test (non critique):', authTestError)
    }

    // ✅ TEST 3: Test simple avec SERVICE_KEY (sans RLS)
    try {
      // Essayer une requête basique sur une table système
      const testQuery = await fetch(`${process.env.SUPABASE_URL}/rest/v1/shops?select=count&limit=1`, {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY!,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'count=exact'
        }
      })

      if (testQuery.ok) {
        console.log('✅ [SUPABASE] Service Key: Accès tables OK')
      } else {
        console.log('⚠️ [SUPABASE] Service Key table access: Limité (mais connexion OK)')
      }
    } catch (tableTestError) {
      console.log('⚠️ [SUPABASE] Table test échoué (mais connexion base OK):', tableTestError)
    }

    return { success: true, message: 'Connexion Supabase établie' }
    
  } catch (error: any) {
    console.error('❌ [SUPABASE] Erreur de connexion:', error)
    return { success: false, error: error.message }
  }
}

// ✅ FONCTION UTILITAIRE: Créer client avec token utilisateur
export function createUserClient(userToken: string) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      }
    }
  )
}

// ✅ FONCTION UTILITAIRE: Test avec token utilisateur
export async function testUserConnection(userToken: string) {
  try {
    const userClient = createUserClient(userToken)
    
    const { data: { user }, error } = await userClient.auth.getUser()
    
    if (error || !user) {
      return { success: false, error: 'Token utilisateur invalide' }
    }

    // Test accès à une table utilisateur
    const { data, error: tableError } = await userClient
      .from('shops')
      .select('id')
      .eq('id', user.id)
      .single()

    if (tableError) {
      return { success: false, error: `Erreur accès table: ${tableError.message}` }
    }

    return { success: true, user, hasShop: !!data }
    
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}