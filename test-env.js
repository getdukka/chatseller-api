// test-env.js - Script de test des variables d'environnement
require('dotenv').config()

console.log('🔧 === TEST VARIABLES D\'ENVIRONNEMENT ===')
console.log('')

const requiredVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY', 
  'SUPABASE_ANON_KEY',
  'OPENAI_API_KEY',
  'RESEND_API_KEY'
]

let allOk = true

requiredVars.forEach(varName => {
  const value = process.env[varName]
  const status = value ? '✅' : '❌'
  const preview = value ? `${value.substring(0, 20)}...` : 'MANQUANTE'
  
  console.log(`${status} ${varName}: ${preview}`)
  
  if (!value) {
    allOk = false
  }
})

console.log('')
console.log(`📊 Résultat: ${allOk ? '✅ Toutes les variables sont définies' : '❌ Certaines variables manquent'}`)

if (!allOk) {
  console.log('')
  console.log('🔧 Actions recommandées:')
  console.log('1. Vérifiez que le fichier .env existe dans le dossier racine')
  console.log('2. Vérifiez qu\'il n\'y a pas de guillemets autour des valeurs')
  console.log('3. Redémarrez le serveur après modification')
}

// Test de chargement Supabase
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  console.log('')
  console.log('🧪 Test de création client Supabase...')
  
  try {
    const { createClient } = require('@supabase/supabase-js')
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    console.log('✅ Client Supabase créé avec succès')
  } catch (error) {
    console.log('❌ Erreur création client Supabase:', error.message)
  }
}