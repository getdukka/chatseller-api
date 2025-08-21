// scripts/dev.js - Script de développement avec chargement .env
const { spawn } = require('child_process')
const path = require('path')

// Charger dotenv avant tout
require('dotenv').config()

console.log('🔧 === SCRIPT DE DÉVELOPPEMENT CHATSELLER ===')
console.log('📁 Dossier:', process.cwd())
console.log('📄 .env chargé')

// Vérifier les variables critiques
const criticalVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'OPENAI_API_KEY']
let allOk = true

criticalVars.forEach(varName => {
  const value = process.env[varName]
  const status = value ? '✅' : '❌'
  console.log(`${status} ${varName}: ${value ? value.substring(0, 20) + '...' : 'MANQUANTE'}`)
  if (!value) allOk = false
})

if (!allOk) {
  console.error('❌ Certaines variables d\'environnement manquent!')
  console.error('💡 Vérifiez que le fichier .env existe et contient les bonnes valeurs')
  process.exit(1)
}

console.log('✅ Variables d\'environnement validées')
console.log('🚀 Démarrage du serveur...')
console.log('')

// Démarrer tsx avec les variables déjà chargées
const child = spawn('npx', ['tsx', 'watch', 'src/server.ts'], {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd()
})

child.on('error', (error) => {
  console.error('❌ Erreur lors du démarrage:', error)
  process.exit(1)
})

child.on('exit', (code) => {
  console.log(`🛑 Serveur arrêté avec le code: ${code}`)
  process.exit(code)
})