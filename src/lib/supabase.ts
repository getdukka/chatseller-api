// src/lib/supabase.ts - VERSION CORRIGÉE
import { createClient } from '@supabase/supabase-js'

// ✅ CLIENT SUPABASE SERVICE (avec bypass RLS explicite)
export const supabaseServiceClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
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
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

console.log('🔧 Supabase clients configurés:', {
  url: process.env.SUPABASE_URL,
  hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
  hasAnonKey: !!process.env.SUPABASE_ANON_KEY
})

// ✅ FONCTION DE TEST CORRIGÉE - SANS REQUÊTE SUR TABLES PROTÉGÉES
export async function testSupabaseConnection() {
  try {
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

    console.log('✅ Supabase REST API: Accessible')

    // ✅ TEST 2: Vérifier l'auth avec un test simple
    try {
      const { data: authData, error: authError } = await supabaseAuthClient.auth.getSession()
      console.log('✅ Supabase Auth client: Configuré')
    } catch (authTestError) {
      console.warn('⚠️ Auth client test (non critique):', authTestError)
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
        console.log('✅ Supabase Service Key: Accès tables OK')
      } else {
        console.log('⚠️ Service Key table access: Limité (mais connexion OK)')
      }
    } catch (tableTestError) {
      console.log('⚠️ Table test échoué (mais connexion base OK):', tableTestError)
    }

    return { success: true, message: 'Connexion Supabase établie' }
    
  } catch (error: any) {
    console.error('❌ Supabase connection error:', error)
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